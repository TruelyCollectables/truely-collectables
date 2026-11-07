import assert from "node:assert/strict";

process.env.MASTER_CHECKLIST_CATALOG_RETRY_ATTEMPTS = "4";
process.env.MASTER_CHECKLIST_CATALOG_RETRY_BASE_MS = "1";
process.env.MASTER_CHECKLIST_OUTPUT = "/tmp/nonexistent-checklist-retry-test-output.json";

let scenario = "network";
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
  throw new TypeError("other fetch failed");
};

await import("./checklist-catalog-retry-prepatch.mjs");

let response = await globalThis.fetch(
  "https://example.supabase.co/rest/v1/checklist_source_catalog?on_conflict=source_url",
  { method: "POST", body: "{}" },
);
assert.equal(response.status, 201);
assert.equal(catalogAttempts, 3, "Transient network failures must retry only the catalog request.");

scenario = "cloudflare-521";
catalogAttempts = 0;
response = await globalThis.fetch(
  "https://example.supabase.co/rest/v1/checklist_source_catalog?on_conflict=source_url",
  { method: "POST", body: "{}" },
);
assert.equal(response.status, 201);
assert.equal(catalogAttempts, 3, "Observed Cloudflare 521 origin-down responses must retry the idempotent catalog upsert.");

scenario = "permanent-400";
catalogAttempts = 0;
response = await globalThis.fetch(
  "https://example.supabase.co/rest/v1/checklist_source_catalog?on_conflict=source_url",
  { method: "POST", body: "{}" },
);
assert.equal(response.status, 400);
assert.equal(catalogAttempts, 1, "Permanent catalog request errors must not be hidden behind transport retries.");

await assert.rejects(
  () => globalThis.fetch("https://example.supabase.co/rest/v1/other_table", { method: "POST" }),
  /other fetch failed/,
);
assert.equal(otherAttempts, 1, "Non-catalog requests must never be retried by the catalog wrapper.");

console.log(JSON.stringify({
  status: "passed",
  networkRetryAttempts: 3,
  cloudflare521RetryAttempts: 3,
  permanent400Attempts: catalogAttempts,
  otherAttempts,
}));
