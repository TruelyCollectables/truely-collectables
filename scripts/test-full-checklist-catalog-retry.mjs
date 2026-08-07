import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const catalogUrl = "https://example.supabase.co/rest/v1/checklist_source_catalog?on_conflict=source_url";
const otherUrl = "https://example.supabase.co/rest/v1/other_table";

if (process.env.CATALOG_RETRY_EXHAUST_CHILD === "1") {
  process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS = "3";
  process.env.MASTER_CHECKLIST_CATALOG_RETRY_BASE_MS = "1";
  let attempts = 0;
  globalThis.fetch = async (input) => {
    const url = String(input?.url || input || "");
    if (!url.includes("/rest/v1/checklist_source_catalog")) {
      throw new Error("exhaustion child received a non-catalog request");
    }
    attempts += 1;
    return new Response("<html>Web server is down</html>", { status: 521 });
  };
  await import("./checklist-catalog-retry-prepatch.mjs");
  await globalThis.fetch(catalogUrl, { method: "POST", body: "{}" });
  throw new Error(`Persistent 521 unexpectedly returned after ${attempts} attempt(s).`);
}

process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS = "4";
process.env.MASTER_CHECKLIST_CATALOG_RETRY_BASE_MS = "1";
process.env.MASTER_CHECKLIST_OUTPUT = "/tmp/nonexistent-checklist-retry-test-output.json";

let scenario = "network";
let otherScenario = "throw";
let catalogAttempts = 0;
let otherAttempts = 0;
globalThis.fetch = async (input) => {
  const url = String(input?.url || input || "");
  if (url.includes("/rest/v1/checklist_source_catalog")) {
    catalogAttempts += 1;
    if (scenario === "network") {
      if (catalogAttempts < 3) throw new TypeError("fetch failed");
      return new Response("{}", { status: 201 });
    }
    if (scenario === "cloudflare-521") {
      if (catalogAttempts < 3) return new Response("<html>Web server is down</html>", { status: 521 });
      return new Response("{}", { status: 201 });
    }
    if (scenario === "permanent-400") {
      return new Response('{"message":"bad request"}', { status: 400 });
    }
    throw new Error(`Unknown test scenario: ${scenario}`);
  }

  otherAttempts += 1;
  if (otherScenario === "cloudflare-521") {
    return new Response("<html>Web server is down</html>", { status: 521 });
  }
  throw new TypeError("other fetch failed");
};

await import("./checklist-catalog-retry-prepatch.mjs");

let response = await globalThis.fetch(catalogUrl, { method: "POST", body: "{}" });
assert.equal(response.status, 201);
assert.equal(catalogAttempts, 3, "Transient network failures must retry only the catalog request.");

scenario = "cloudflare-521";
catalogAttempts = 0;
response = await globalThis.fetch(catalogUrl, { method: "POST", body: "{}" });
assert.equal(response.status, 201);
assert.equal(catalogAttempts, 3, "Observed Cloudflare 521 origin-down responses must retry the idempotent catalog upsert.");

scenario = "permanent-400";
catalogAttempts = 0;
response = await globalThis.fetch(catalogUrl, { method: "POST", body: "{}" });
assert.equal(response.status, 400);
assert.equal(catalogAttempts, 1, "Permanent catalog request errors must not be hidden behind transport retries.");

await assert.rejects(
  () => globalThis.fetch(otherUrl, { method: "POST" }),
  /other fetch failed/,
);
assert.equal(otherAttempts, 1, "Non-catalog thrown failures must never be retried by the catalog wrapper.");

otherScenario = "cloudflare-521";
otherAttempts = 0;
response = await globalThis.fetch(otherUrl, { method: "POST" });
assert.equal(response.status, 521);
assert.equal(otherAttempts, 1, "Non-catalog HTTP 521 responses must never be retried by the catalog wrapper.");

const exhaustOutput = `/tmp/checklist-catalog-521-exhaust-${process.pid}.json`;
if (existsSync(exhaustOutput)) unlinkSync(exhaustOutput);
const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
  env: {
    ...process.env,
    CATALOG_RETRY_EXHAUST_CHILD: "1",
    MASTER_CHECKLIST_OUTPUT: exhaustOutput,
  },
  encoding: "utf8",
});
assert.equal(child.status, 74, `Persistent catalog 521 must terminate fail-closed with exit 74. stderr=${child.stderr}`);
assert.equal(existsSync(exhaustOutput), true, "Persistent catalog 521 must leave a failure receipt.");
const exhaustReceipt = JSON.parse(readFileSync(exhaustOutput, "utf8"));
assert.equal(exhaustReceipt.schema, "tcos.checklist.masterArchiveBatchFailure.v1");
assert.equal(exhaustReceipt.status, "failed_before_complete_receipt");
assert.equal(exhaustReceipt.exitCode, 74);
assert.equal(exhaustReceipt.retryEvents.at(-1)?.kind, "http-exhausted");
assert.match(exhaustReceipt.retryEvents.at(-1)?.detail || "", /HTTP 521/);
unlinkSync(exhaustOutput);

console.log(JSON.stringify({
  status: "passed",
  networkRetryAttempts: 3,
  cloudflare521RecoveryAttempts: 3,
  persistentCloudflare521ExitCode: child.status,
  permanent400Attempts: catalogAttempts,
  nonCatalog521Attempts: otherAttempts,
}));
