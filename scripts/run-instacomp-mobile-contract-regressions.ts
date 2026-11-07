import assert from "node:assert/strict";
import {
  INSTACOMP_API_VERSION,
  INSTACOMP_CONTRACT,
  instaCompEnvelope,
  instaCompResponseHeaders,
  parseVerifiedBatchRequest,
  parseVerifiedPricingRequest,
} from "../src/lib/instacomp-api-contract";
import {
  ChecklistIdentityRequiredError,
  runVerifiedInstaCompPricing,
  runVerifiedInstaCompPricingBatch,
} from "../src/lib/instacomp-verified-pricing-client";

async function main() {
  const single = parseVerifiedPricingRequest(
    {
      inventoryItemId: " item-1 ",
      aiCouncilTier: "adaptive",
      forceIdentityRescan: true,
    },
    "mobile-request-0001",
  );
  assert.equal(single.inventoryItemId, "item-1");
  assert.equal(single.requestId, "mobile-request-0001");
  assert.equal(single.forceIdentityRescan, true);

  const batch = parseVerifiedBatchRequest(
    {
      inventoryItemIds: ["one", "one", "two", "", "three"],
    },
    "batch-request-0001",
    2,
  );
  assert.deepEqual(batch.inventoryItemIds, ["one", "two"]);
  assert.equal(batch.requestId, "batch-request-0001");

  const headers = instaCompResponseHeaders({
    requestId: single.requestId,
    checklistVerified: true,
    registryIdentityId: "registry-123",
    mobileSurface: true,
  });
  assert.equal(headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(headers.get("x-instacomp-api-version"), INSTACOMP_API_VERSION);
  assert.equal(headers.get("x-instacomp-contract"), INSTACOMP_CONTRACT);
  assert.equal(headers.get("x-instacomp-request-id"), single.requestId);
  assert.equal(headers.get("x-instacomp-checklist-verified"), "true");
  assert.equal(headers.get("x-instacomp-mobile-api"), "v1");

  const envelope = instaCompEnvelope({
    requestId: single.requestId,
    durationMs: 12.4,
    payload: { success: true },
  });
  assert.equal(envelope.contract, INSTACOMP_CONTRACT);
  assert.equal(envelope.durationMs, 12);

  let singleUrl = "";
  const success = await runVerifiedInstaCompPricing({
    inventoryItemId: "item-1",
    baseUrl: "https://example.test/",
    surface: "mobile",
    requestId: "mobile-request-0002",
    fetchImpl: async (input, init) => {
      singleUrl = String(input);
      const requestHeaders = new Headers(init?.headers);
      assert.equal(requestHeaders.get("idempotency-key"), "mobile-request-0002");
      return Response.json(
        {
          success: true,
          requestId: "mobile-request-0002",
          identity: {
            status: "identified",
            source: "checklist_registry",
            aiIdentificationRequired: false,
            registryIdentityId: "registry-123",
            registryFingerprintSha256: "fingerprint-123",
            lockedFields: {},
            reasons: [],
          },
        },
        {
          headers: {
            "x-instacomp-request-id": "mobile-request-0002",
            "x-instacomp-checklist-verified": "true",
          },
        },
      );
    },
  });
  assert.equal(singleUrl, "https://example.test/api/mobile/v1/instacomp/price");
  assert.equal(success.requestId, "mobile-request-0002");

  await assert.rejects(
    () =>
      runVerifiedInstaCompPricing({
        inventoryItemId: "item-review",
        surface: "web",
        requestId: "web-request-0001",
        fetchImpl: async () =>
          Response.json(
            {
              success: false,
              code: "CHECKLIST_IDENTITY_REQUIRED",
              requestId: "web-request-0001",
              error: "Registry review required.",
              identity: null,
            },
            { status: 409 },
          ),
      }),
    (error: unknown) => {
      assert(error instanceof ChecklistIdentityRequiredError);
      assert.equal(error.requestId, "web-request-0001");
      return true;
    },
  );

  let batchUrl = "";
  const batchResult = await runVerifiedInstaCompPricingBatch({
    inventoryItemIds: ["one", "two", "two"],
    baseUrl: "https://example.test",
    surface: "mobile",
    requestId: "mobile-batch-0001",
    fetchImpl: async (input, init) => {
      batchUrl = String(input);
      const sent = JSON.parse(String(init?.body || "{}"));
      assert.deepEqual(sent.inventoryItemIds, ["one", "two"]);
      return Response.json(
        {
          success: false,
          requestId: "mobile-batch-0001",
          completed: 1,
          failed: 1,
          results: [
            {
              inventoryItemId: "one",
              requestId: "mobile-batch-0001:1",
              ok: true,
              status: 200,
              payload: { success: true, requestId: "mobile-batch-0001:1" },
            },
            {
              inventoryItemId: "two",
              requestId: "mobile-batch-0001:2",
              ok: false,
              status: 409,
              payload: {
                success: false,
                requestId: "mobile-batch-0001:2",
                code: "CHECKLIST_IDENTITY_REQUIRED",
                error: "Review required.",
              },
            },
          ],
        },
        { status: 207 },
      );
    },
  });
  assert.equal(batchUrl, "https://example.test/api/mobile/v1/instacomp/batch");
  assert.equal(batchResult.completed, 1);
  assert.equal(batchResult.failed, 1);
  assert.equal(batchResult.results[1].ok, false);
  if (!batchResult.results[1].ok) {
    assert(batchResult.results[1].error instanceof ChecklistIdentityRequiredError);
  }

  console.log("InstaComp web/Mobile versioned request and receipt contract passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
