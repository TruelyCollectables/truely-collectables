import assert from "node:assert/strict";
import {
  assertChecklistRegistryReceipt,
  checklistRegistryReceiptBlockers,
  readChecklistRegistryReceipt,
} from "../src/lib/instacomp-registry-receipt";

const lockedMetadata = {
  instacomp: {
    checklistIdentity: {
      status: "identified",
      source: "checklist_registry",
      registryIdentityId: "registry-123",
      registryFingerprintSha256: "fingerprint-abc",
      checkedAt: "2026-08-04T18:00:00.000Z",
      reasons: ["pending_listing_identity_locked_to_checklist_registry"],
      lockedFields: {
        year: "2024",
        manufacturer: "Topps",
        cardNumber: "125",
        player: "Example Player",
        parallel: "Gold",
      },
    },
  },
};

assert.deepEqual(checklistRegistryReceiptBlockers(lockedMetadata), []);
const receipt = assertChecklistRegistryReceipt(lockedMetadata);
assert.equal(receipt.status, "identified");
assert.equal(receipt.registryIdentityId, "registry-123");
assert.equal(receipt.registryFingerprintSha256, "fingerprint-abc");
assert.equal(receipt.lockedFields.player, "Example Player");

const missingReceipt = checklistRegistryReceiptBlockers({ instacomp: {} });
assert(missingReceipt.includes("checklist_identity_review_required"));
assert(missingReceipt.includes("missing_registry_identity_id"));
assert(missingReceipt.includes("missing_registry_fingerprint"));
assert(missingReceipt.includes("missing_registry_checked_at"));

const missingFingerprint = structuredClone(lockedMetadata);
delete (missingFingerprint.instacomp.checklistIdentity as Record<string, unknown>)
  .registryFingerprintSha256;
assert.deepEqual(checklistRegistryReceiptBlockers(missingFingerprint), [
  "missing_registry_fingerprint",
]);

const incompleteLockedFields = structuredClone(lockedMetadata);
delete (incompleteLockedFields.instacomp.checklistIdentity.lockedFields as Record<string, unknown>)
  .player;
assert.deepEqual(checklistRegistryReceiptBlockers(incompleteLockedFields), [
  "missing_locked_player",
]);

assert.throws(
  () => assertChecklistRegistryReceipt(missingFingerprint),
  (error: unknown) => {
    const typed = error as Error & { code?: string; blockers?: string[] };
    assert.equal(typed.code, "CHECKLIST_IDENTITY_REQUIRED");
    assert.deepEqual(typed.blockers, ["missing_registry_fingerprint"]);
    return true;
  },
);

const review = readChecklistRegistryReceipt({
  instacomp: {
    checklistIdentity: {
      status: "review_required",
      reasons: ["multiple_checklist_variants_match"],
    },
  },
});
assert.equal(review.status, "review_required");
assert.deepEqual(review.reasons, ["multiple_checklist_variants_match"]);

console.log("InstaComp publish-readiness simulations passed.");
