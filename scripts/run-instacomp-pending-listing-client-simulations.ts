import assert from "node:assert/strict";
import { applyPendingListingIdentity } from "../src/lib/instacomp-pending-listing-client";

const identified = applyPendingListingIdentity(
  { player: "Wrong Guess", cardNumber: "999" },
  {
    status: "identified",
    source: "checklist_registry",
    aiIdentificationRequired: false,
    registryIdentityId: "registry-identity-1",
    registryFingerprintSha256: "abc123",
    lockedFields: {
      year: "1989",
      manufacturer: "Topps",
      brand: "Topps",
      product: "Topps Baseball",
      setName: "Base Set",
      cardNumber: "15",
      player: "Canonical Player",
      team: "Example Team",
      sport: "Baseball",
      league: "MLB",
      parallel: "Base",
      variation: null,
      serialRun: null,
      isAuto: false,
      isRelic: false,
    },
    reasons: ["pending_listing_identity_locked_to_checklist_registry"],
  },
);

assert.equal(identified.canonicalFieldsLocked, true);
assert.equal(identified.canRunMarketplaceComps, true);
assert.equal(identified.canPublishListing, true);
assert.equal(identified.draft.player, "Canonical Player");
assert.equal(identified.draft.cardNumber, "15");
assert.equal(identified.draft.registryIdentityId, "registry-identity-1");
assert.deepEqual(identified.draft.identityReviewReasons, []);

const review = applyPendingListingIdentity(
  { player: "Unresolved Player", cardNumber: "15" },
  {
    status: "review_required",
    source: "checklist_registry",
    aiIdentificationRequired: true,
    registryIdentityId: null,
    registryFingerprintSha256: null,
    lockedFields: {
      year: null,
      manufacturer: null,
      brand: null,
      product: null,
      setName: null,
      cardNumber: null,
      player: null,
      team: null,
      sport: null,
      league: null,
      parallel: null,
      variation: null,
      serialRun: null,
      isAuto: null,
      isRelic: null,
    },
    reasons: ["multiple_checklist_variants_match"],
  },
);

assert.equal(review.canonicalFieldsLocked, false);
assert.equal(review.canRunMarketplaceComps, false);
assert.equal(review.canPublishListing, false);
assert.equal(review.draft.player, "Unresolved Player");
assert.equal(review.draft.identityStatus, "review_required");
assert.deepEqual(review.draft.identityReviewReasons, ["multiple_checklist_variants_match"]);

console.log("InstaComp pending-listing client simulations passed.");
