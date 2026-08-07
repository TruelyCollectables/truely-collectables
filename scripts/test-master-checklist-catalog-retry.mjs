import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "checklist-catalog-retry-"));
process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS = "4";
process.env.MASTER_CHECKLIST_CATALOG_RETRY_BASE_MS = "1";
process.env.MASTER_CHECKLIST_OUTPUT = join(temp, "failure.json");
process.env.MASTER_CHECKLIST_BATCH_INDEX = "7";

let catalogAttempts = 0;
let otherAttempts = 0;
globalThis.fetch = async (input) => {
  const url = String(input?.url || input || "");
  if (url.includes("/rest/v1/checklist_source_catalog")) {
    catalogAttempts += 1;
    if (catalogAttempts < 3) throw new TypeError("fetch failed");
    return new Response("{}", { status: 201 });
  }
  otherAttempts += 1;
  throw new TypeError("other fetch failed");
};

await import("./master-checklist-archive/catalog-retry-prepatch.mjs");

const catalogResponse = await globalThis.fetch(
  "https://example.supabase.co/rest/v1/checklist_source_catalog?on_conflict=source_url",
  { method: "POST", body: "{}" },
);
assert.equal(catalogResponse.status, 201);
assert.equal(catalogAttempts, 3, "catalog request should retry transient network failures");

await assert.rejects(
  () => globalThis.fetch("https://example.supabase.co/rest/v1/other_table", { method: "POST" }),
  /other fetch failed/,
);
assert.equal(otherAttempts, 1, "non-catalog requests must never be retried by this patch");

rmSync(temp, { recursive: true, force: true });
console.log(JSON.stringify({ status: "passed", catalogAttempts, otherAttempts }));
