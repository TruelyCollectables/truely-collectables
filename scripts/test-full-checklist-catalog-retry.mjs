import assert from "node:assert/strict";

process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS = "4";
process.env.MASTER_CHECKLIST_CATALOG_RETRY_BASE_MS = "1";
process.env.MASTER_CHECKLIST_OUTPUT = "/tmp/nonexistent-checklist-retry-test-output.json";

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

await import("./checklist-catalog-retry-prepatch.mjs");

const response = await globalThis.fetch(
  "https://example.supabase.co/rest/v1/checklist_source_catalog?on_conflict=source_url",
  { method: "POST", body: "{}" },
);
assert.equal(response.status, 201);
assert.equal(catalogAttempts, 3);

await assert.rejects(
  () => globalThis.fetch("https://example.supabase.co/rest/v1/other_table", { method: "POST" }),
  /other fetch failed/,
);
assert.equal(otherAttempts, 1);

console.log(JSON.stringify({ status: "passed", catalogAttempts, otherAttempts }));
