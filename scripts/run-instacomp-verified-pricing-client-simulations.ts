import assert from "node:assert/strict";
import {
  ChecklistIdentityRequiredError,
  runVerifiedInstaCompPricing,
  runVerifiedInstaCompPricingBatch,
} from "../src/lib/instacomp-verified-pricing-client";

const successFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  assert.equal(body.inventoryItemId, "inventory-1");
  return new Response(
    JSON.stringify({
      success: true,
      suggestedPrice: 24.99,
      pricingStatus: "suggested_from_reliable_sold_comps",
      reliableSoldCompCount: 3,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

const success = await runVerifiedInstaCompPricing({
  inventoryItemId: "inventory-1",
  fetchImpl: successFetch,
});
assert.equal(success.success, true);
assert.equal(success.suggestedPrice, 24.99);

const blockedFetch: typeof fetch = async () =>
  new Response(
    JSON.stringify({
      success: false,
      code: "CHECKLIST_IDENTITY_REQUIRED",
      error: "Checklist Registry identity must be resolved before marketplace comps can run.",
      identity: {
        status: "review_required",
        source: "checklist_registry",
        aiIdentificationRequired: true,
        registryIdentityId: null,
        registryFingerprintSha256: null,
        lockedFields: {},
        reasons: ["multiple_checklist_variants_match"],
      },
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );

await assert.rejects(
  () =>
    runVerifiedInstaCompPricing({
      inventoryItemId: "inventory-2",
      fetchImpl: blockedFetch,
    }),
  (error: unknown) => {
    assert.ok(error instanceof ChecklistIdentityRequiredError);
    assert.equal(error.status, 409);
    assert.deepEqual(error.identity?.reasons, ["multiple_checklist_variants_match"]);
    return true;
  },
);

const batchFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body || "{}"));
  if (body.inventoryItemId === "blocked") return blockedFetch(_input, init);
  return new Response(
    JSON.stringify({ success: true, suggestedPrice: 10 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

const progress: number[] = [];
const batch = await runVerifiedInstaCompPricingBatch({
  inventoryItemIds: ["one", "blocked", "one", "two"],
  fetchImpl: batchFetch,
  concurrency: 2,
  onProgress: ({ completed }) => progress.push(completed),
});

assert.equal(batch.results.length, 3);
assert.equal(batch.completed, 3);
assert.equal(batch.failed, 1);
assert.deepEqual(progress.sort((a, b) => a - b), [1, 2, 3]);
assert.equal(batch.results.filter((result) => result.ok).length, 2);

console.log("InstaComp shared verified-pricing client simulations passed.");
