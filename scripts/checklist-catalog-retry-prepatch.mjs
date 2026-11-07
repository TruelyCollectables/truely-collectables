import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const originalFetch = globalThis.fetch.bind(globalThis);
const MAX_ATTEMPTS = Math.max(2, Math.min(10, Number(process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS || 8)));
const BASE_DELAY_MS = Math.max(1, Math.min(10_000, Number(process.env.MASTER_CHECKLIST_CATALOG_RETRY_BASE_MS || 750)));
const OUTPUT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_OUTPUT || ".checklist-discovery/master-archive-batch-unknown.json");
const startedAt = new Date().toISOString();
const retryEvents = [];

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function urlString(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || "";
}

function isCatalogRequest(input) {
  try {
    const url = new URL(urlString(input));
    return url.pathname.includes("/rest/v1/checklist_source_catalog");
  } catch {
    return false;
  }
}

function isRetryableStatus(status) {
  // 521 is Cloudflare's "Web server is down" response. Production emitted this
  // exact transport failure on 2026-08-07 after the Registry transaction had
  // completed but while the isolated source-catalog upsert was being recorded.
  // The catalog write is keyed by source_url and intentionally idempotent, so it
  // is safe to retry here. Do not broaden this to arbitrary 4xx/5xx responses:
  // schema, auth, validation, and other permanent failures must still fail fast.
  return [408, 425, 429, 500, 502, 503, 504, 521].includes(Number(status));
}

function retryInput(input) {
  if (typeof Request !== "undefined" && input instanceof Request) return input.clone();
  return input;
}

function record(kind, attempt, detail) {
  retryEvents.push({
    at: new Date().toISOString(),
    kind,
    attempt,
    detail: String(detail || "").slice(0, 300),
  });
}

function fatalCatalogTransport(kind, detail) {
  record(kind, MAX_ATTEMPTS, detail);
  process.exit(74);
}

globalThis.fetch = async function checklistCatalogRetryFetch(input, init) {
  if (!isCatalogRequest(input)) return originalFetch(input, init);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await originalFetch(retryInput(input), init);
      if (!isRetryableStatus(response.status)) return response;
      if (attempt === MAX_ATTEMPTS) fatalCatalogTransport("http-exhausted", `HTTP ${response.status}`);
      record("http", attempt, `HTTP ${response.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) fatalCatalogTransport("network-exhausted", message);
      record("network", attempt, message);
    }

    const delay = Math.min(15_000, BASE_DELAY_MS * 2 ** (attempt - 1));
    await sleep(delay);
  }

  fatalCatalogTransport("unexpected-exhaustion", "Checklist catalog request left retry loop unexpectedly.");
};

process.on("exit", (code) => {
  if (!code || existsSync(OUTPUT)) return;
  try {
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(
      OUTPUT,
      `${JSON.stringify({
        schema: "tcos.checklist.masterArchiveBatchFailure.v1",
        status: "failed_before_complete_receipt",
        startedAt,
        failedAt: new Date().toISOString(),
        exitCode: code,
        batchIndex: Number(process.env.MASTER_CHECKLIST_BATCH_INDEX || -1),
        masterRunId: "31100986894",
        retryEvents: retryEvents.slice(-50),
      }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Never mask the original process failure.
  }
});
