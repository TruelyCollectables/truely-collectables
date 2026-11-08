import assert from "node:assert/strict";
import {
  ChecklistIdentityRequiredError,
  runVerifiedInstaCompPricing,
  runVerifiedInstaCompPricingBatch,
} from "../src/lib/instacomp-verified-pricing-client";

async function main() {
  const successFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.inventoryItemId, "inventory-1");
    return Response.json({
      success: true,
      requestId: body.requestId,
      suggestedPrice: 24.99,
      pricingStatus: "suggested_from_reliable_sold_comps",
      reliableSoldCompCount: 3,
    });
  };

  const success = await runVerifiedInstaCompPricing({
    inventoryItemId: "inventory-1",
    requestId: "simulation-single-0001",
    fetchImpl: successFetch,
  });
  assert.equal(success.success, true);
  assert.equal(success.suggestedPrice, 24.99);
  assert.equal(success.requestId, "simulation-single-0001");

  const blockedFetch: typeof fetch = async () =>
    Response.json(
      {
        success: false,
        requestId: "simulation-blocked-0001",
        code: "CHECKLIST_IDENTITY_REQUIRED",
        error:
          "Checklist Registry identity must be resolved before marketplace comps can run.",
        identity: {
          status: "review_required",
          source: "checklist_registry",
          aiIdentificationRequired: true,
          registryIdentityId: null,
          registryFingerprintSha256: null,
          lockedFields: {},
          reasons: ["multiple_checklist_variants_match"],
        },
      },
      { status: 409 },
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
      assert.deepEqual(error.identity?.reasons, [
        "multiple_checklist_variants_match",
      ]);
      return true;
    },
  );

  const progress: number[] = [];
  const batch = await runVerifiedInstaCompPricingBatch({
    inventoryItemIds: ["one", "blocked", "one", "two"],
    requestId: "simulation-batch-0001",
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.deepEqual(body.inventoryItemIds, ["one", "blocked", "two"]);
      return Response.json(
        {
          success: false,
          requestId: body.requestId,
          completed: 2,
          failed: 1,
          results: [
            {
              inventoryItemId: "one",
              requestId: `${body.requestId}:1`,
              ok: true,
              status: 200,
              payload: {
                success: true,
                requestId: `${body.requestId}:1`,
                suggestedPrice: 10,
              },
            },
            {
              inventoryItemId: "blocked",
              requestId: `${body.requestId}:2`,
              ok: false,
              status: 409,
              payload: {
                success: false,
                requestId: `${body.requestId}:2`,
                code: "CHECKLIST_IDENTITY_REQUIRED",
                error: "Review required.",
              },
            },
            {
              inventoryItemId: "two",
              requestId: `${body.requestId}:3`,
              ok: true,
              status: 200,
              payload: {
                success: true,
                requestId: `${body.requestId}:3`,
                suggestedPrice: 10,
              },
            },
          ],
        },
        { status: 207 },
      );
    },
    onProgress: ({ completed }) => progress.push(completed),
  });

  assert.equal(batch.results.length, 3);
  assert.equal(batch.completed, 2);
  assert.equal(batch.failed, 1);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(batch.results.filter((result) => result.ok).length, 2);

  console.log("InstaComp shared verified-pricing client simulations passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
