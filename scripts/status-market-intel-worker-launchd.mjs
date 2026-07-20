import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LABEL = "com.truelycollectables.market-intel-worker";
const json = process.argv.includes("--json");
const uid = process.getuid?.();
if (process.platform !== "darwin" || uid === undefined) {
  throw new Error("This status command is only available on macOS.");
}

const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logDirectory = path.join(os.homedir(), "Library", "Logs", "TCOS-Market-Intel");
const stdoutPath = path.join(logDirectory, "worker.stdout.log");
const stderrPath = path.join(logDirectory, "worker.stderr.log");
const target = `gui/${uid}/${LABEL}`;
const result = spawnSync("launchctl", ["print", target], { encoding: "utf8" });
const loaded = result.status === 0;
const details = loaded ? parseLaunchctl(result.stdout) : {};
const payload = {
  label: LABEL,
  installed: fs.existsSync(plistPath),
  loaded,
  target,
  plistPath,
  state: details.state || null,
  lastExitCode: details.lastExitCode,
  pid: details.pid,
  stdoutPath,
  stderrPath,
  recentStdout: tail(stdoutPath, 12),
  recentStderr: tail(stderrPath, 12),
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`TCOS Market Intel worker: ${loaded ? "LOADED" : "NOT LOADED"}`);
  console.log(`Plist: ${payload.installed ? plistPath : "not installed"}`);
  console.log(`State: ${payload.state || "unknown"}`);
  console.log(`PID: ${payload.pid ?? "not running between cycles"}`);
  console.log(`Last exit code: ${payload.lastExitCode ?? "unknown"}`);
  console.log(`Logs: ${stdoutPath}`);
  if (payload.recentStdout.length) {
    console.log("\nRecent worker output:");
    console.log(payload.recentStdout.join("\n"));
  }
  if (payload.recentStderr.length) {
    console.log("\nRecent worker errors:");
    console.log(payload.recentStderr.join("\n"));
  }
}

function parseLaunchctl(value) {
  const state = value.match(/\bstate\s*=\s*([^\n]+)/)?.[1]?.trim() || null;
  const pidRaw = value.match(/\bpid\s*=\s*(\d+)/)?.[1];
  const exitRaw = value.match(/\blast exit code\s*=\s*(-?\d+)/i)?.[1];
  return {
    state,
    pid: pidRaw ? Number(pidRaw) : null,
    lastExitCode: exitRaw ? Number(exitRaw) : null,
  };
}

function tail(filePath, count) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count);
}
