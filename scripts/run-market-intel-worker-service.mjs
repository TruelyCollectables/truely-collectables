import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(scriptDirectory, "run-market-intel-external-worker.ts");
const intervalMinutes = clampNumber(
  process.env.MARKET_INTEL_WORKER_INTERVAL_MINUTES,
  15,
  5,
  1440,
);
const workerName =
  String(process.env.MARKET_INTEL_WORKER_NAME || "tcos-market-intel-worker").trim() ||
  "tcos-market-intel-worker";

let stopping = false;
let activeChild = null;

function clampNumber(raw, fallback, minimum, maximum) {
  const parsed = Number(raw ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function log(event, details = {}) {
  console.log(
    JSON.stringify({
      workerService: "tcos.marketIntel.workerService.v1",
      workerName,
      event,
      at: new Date().toISOString(),
      ...details,
    }),
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function runCycle() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    log("cycle_started");

    activeChild = spawn(
      process.execPath,
      ["--import", "tsx", workerPath],
      {
        cwd: path.resolve(scriptDirectory, ".."),
        env: process.env,
        stdio: "inherit",
      },
    );

    activeChild.once("error", (error) => {
      activeChild = null;
      log("cycle_failed_to_start", { error: error.message });
      resolve({ success: false, durationMs: Date.now() - startedAt });
    });

    activeChild.once("exit", (code, signal) => {
      activeChild = null;
      const success = code === 0;
      log(success ? "cycle_completed" : "cycle_failed", {
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt,
      });
      resolve({ success, durationMs: Date.now() - startedAt });
    });
  });
}

function requestStop(signal) {
  if (stopping) return;
  stopping = true;
  log("shutdown_requested", { signal });
  if (activeChild && !activeChild.killed) {
    activeChild.kill("SIGTERM");
  }
}

process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));

log("service_started", { intervalMinutes });

while (!stopping) {
  const cycle = await runCycle();
  if (stopping) break;

  const normalDelay = intervalMinutes * 60_000;
  const failureFloor = 60_000;
  const delayMs = cycle.success ? normalDelay : Math.max(failureFloor, normalDelay);
  log("sleeping", { delayMs, nextCycleMinutes: Math.round(delayMs / 60_000) });
  await wait(delayMs);
}

log("service_stopped");
