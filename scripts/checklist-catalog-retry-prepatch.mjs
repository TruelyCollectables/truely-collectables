import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const originalFetch = globalThis.fetch.bind(globalThis);
const MAX_ATTEMPTS = Math.max(2, Math.min(12, Number(process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS || 10)));
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

function requestPath(input) {
  try {
    return new URL(urlString(input)).pathname;
  } catch {
    return "";
  }
}

function isCatalogRequest(input) {
  return requestPath(input).includes("/rest/v1/checklist_source_catalog");
}

function isStorageRequest(input) {
  const path = requestPath(input);
  return path.includes("/storage/v1/bucket") || path.includes("/storage/v1/object");
}

function isProtectedRetryRequest(input) {
  return isCatalogRequest(input) || isStorageRequest(input);
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504, 520, 521].includes(Number(status));
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

function fatalProtectedTransport(kind, detail) {
  record(kind, MAX_ATTEMPTS, detail);
  process.exit(74);
}

async function responseLooksConnectionSaturated(response) {
  if (!response || response.ok) return false;
  try {
    const text = await response.clone().text();
    return /too many connections|connection.*pool|database.*connections/i.test(text);
  } catch {
    return false;
  }
}

globalThis.fetch = async function checklistProtectedRetryFetch(input, init) {
  if (!isProtectedRetryRequest(input)) return originalFetch(input, init);

  const catalogRequest = isCatalogRequest(input);
  let lastResponse = null;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await originalFetch(retryInput(input), init);
      lastResponse = response;
      const saturated = await responseLooksConnectionSaturated(response);
      if (!isRetryableStatus(response.status) && !saturated) return response;

      const detail = `HTTP ${response.status}${saturated ? " database-connection-saturation" : ""}`;
      if (attempt === MAX_ATTEMPTS) {
        if (catalogRequest) {
          record("catalog-deferred", attempt, detail);
          return response;
        }
        fatalProtectedTransport("http-exhausted", detail);
      }
      record(catalogRequest ? "catalog-http" : "storage-http", attempt, detail);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_ATTEMPTS) {
        if (catalogRequest) {
          record("catalog-deferred-network", attempt, message);
          throw error;
        }
        fatalProtectedTransport("network-exhausted", message);
      }
      record(catalogRequest ? "catalog-network" : "storage-network", attempt, message);
    }

    const delay = Math.min(30_000, BASE_DELAY_MS * 2 ** (attempt - 1));
    await sleep(delay);
  }

  if (catalogRequest) {
    if (lastResponse) return lastResponse;
    throw lastError || new Error("Checklist catalog request exhausted retry loop.");
  }
  fatalProtectedTransport("unexpected-exhaustion", "Protected checklist request left retry loop unexpectedly.");
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
        retryEvents: retryEvents.slice(-100),
      }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Never mask the original process failure.
  }
});
