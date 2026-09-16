import assert from "node:assert/strict";
import { isInstaCompPublicationIdentityConfirmed } from "../src/lib/instacomp-publication-identity";

const registryReceipt = {
  status: "identified",
  source: "checklist_registry",
  registryIdentityId: "registry-123",
  registryFingerprintSha256: "a".repeat(64),
  checkedAt: "2026-09-15T20:00:00.000Z",
  lockedFields: {
    year: "2025",
    manufacturer: "Panini",
    cardNumber: "122",
    player: "Sonia Citron",
  },
};

const macExactReceipt = {
  identityComplete: true,
  trustedForIdentity: true,
  identitySource: "mac_checklist_registry_exact",
  checklistIdentity: {
    status: "exact_match",
    identityId: "registry-legacy-123",
    fingerprintSha256: "b".repeat(64),
  },
};

assert.equal(isInstaCompPublicationIdentityConfirmed({ instacomp: { manualIdentityLocked: true } }), true);
assert.equal(isInstaCompPublicationIdentityConfirmed({ instacomp: { humanVerified: true } }), true);
assert.equal(isInstaCompPublicationIdentityConfirmed({ seller_review: { identity_confirmed: true } }), true);
assert.equal(isInstaCompPublicationIdentityConfirmed({ instacomp: { checklistIdentity: registryReceipt } }), true);
assert.equal(isInstaCompPublicationIdentityConfirmed({ instacomp: macExactReceipt }), true);
assert.equal(
  isInstaCompPublicationIdentityConfirmed({
    instacomp: { ...macExactReceipt, trustedForIdentity: false },
  }),
  false,
);
assert.equal(
  isInstaCompPublicationIdentityConfirmed({
    instacomp: {
      ...macExactReceipt,
      checklistIdentity: { ...macExactReceipt.checklistIdentity, fingerprintSha256: null },
    },
  }),
  false,
);
assert.equal(
  isInstaCompPublicationIdentityConfirmed({
    instacomp: { checklistIdentity: { ...registryReceipt, registryFingerprintSha256: null } },
  }),
  false,
);
assert.equal(
  isInstaCompPublicationIdentityConfirmed({
    instacomp: { checklistIdentity: { ...registryReceipt, status: "review_required" } },
  }),
  false,
);
assert.equal(isInstaCompPublicationIdentityConfirmed({ instacomp: {} }), false);

console.log("PASS KINGMAKER publication identity regressions");
