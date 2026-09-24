import assert from "node:assert/strict";
import {
  buildKingmakerListingReadiness,
} from "../src/lib/kingmaker-listing-readiness";
import {
  checklistRegistryReceiptBlockers,
} from "../src/lib/instacomp-registry-receipt";

const exactMetadata = {
  instacomp: {
    checklistIdentity: {
      status: "exact_match",
      identityId: "registry-1",
      fingerprintSha256: "abc123",
      checkedAt: "2026-09-24T12:00:00.000Z",
    },
    identityExactAudit: {
      status: "exact_match",
      identityId: "registry-1",
      fingerprintSha256: "abc123",
      auditedAt: "2026-09-24T12:00:00.000Z",
    },
    ai: {
      registryIdentityId: "registry-1",
      year: "1995",
      manufacturer: "Cardz",
      cardNumber: "29",
      player: "Stunning Steve Austin",
    },
    priceGuideStatus: "live",
    priceGuideCheckedAt: "2026-09-24T12:05:00.000Z",
    priceGuide: {
      period: "1 year",
      identityVerified: true,
      capturedAt: "2026-09-24T12:05:00.000Z",
    },
  },
};

assert.deepEqual(checklistRegistryReceiptBlockers(exactMetadata), []);

const ready = buildKingmakerListingReadiness({
  metadata: exactMetadata,
  frontImageUrl: "https://example.com/front.jpg",
  backImageUrl: "https://example.com/back.jpg",
  condition: "Near Mint or Better",
  quantity: 1,
  acquisitionSource: "Misc",
  duplicateDecisionRequired: false,
  websitePrice: 14.99,
  ebayPrice: 16.99,
  mercariPrice: 16.99,
  ebayCardCondition: "Near mint or better",
  graded: false,
});
assert.equal(ready.ready, true);
assert.equal(ready.websiteReady, true);
assert.equal(ready.ebayReady, true);

const noMatch = structuredClone(exactMetadata);
noMatch.instacomp.priceGuideStatus = "no_matches";
delete (noMatch.instacomp as any).priceGuide;
const noMatchReady = buildKingmakerListingReadiness({
  metadata: noMatch,
  frontImageUrl: "https://example.com/front.jpg",
  backImageUrl: "https://example.com/back.jpg",
  condition: "Near Mint or Better",
  quantity: 1,
  acquisitionSource: "eBay",
  duplicateDecisionRequired: false,
  websitePrice: 9.99,
  ebayPrice: 11.99,
  mercariPrice: 11.99,
  ebayCardCondition: "Near mint or better",
});
assert.equal(noMatchReady.coreReady, true);

const duplicateBlocked = buildKingmakerListingReadiness({
  metadata: exactMetadata,
  frontImageUrl: "https://example.com/front.jpg",
  backImageUrl: "https://example.com/back.jpg",
  condition: "Near Mint or Better",
  quantity: 1,
  acquisitionSource: "eBay",
  duplicateDecisionRequired: true,
  websitePrice: 9.99,
  ebayPrice: 11.99,
  mercariPrice: 11.99,
  ebayCardCondition: "Near mint or better",
});
assert.equal(duplicateBlocked.coreReady, false);
assert.ok(duplicateBlocked.blockers.includes("duplicate_decision_required"));

const missingAcquisition = buildKingmakerListingReadiness({
  metadata: exactMetadata,
  frontImageUrl: "https://example.com/front.jpg",
  backImageUrl: "https://example.com/back.jpg",
  condition: "Near Mint or Better",
  quantity: 1,
  acquisitionSource: null,
  duplicateDecisionRequired: false,
  websitePrice: 9.99,
  ebayPrice: 11.99,
  mercariPrice: 11.99,
  ebayCardCondition: "Near mint or better",
});
assert.ok(missingAcquisition.blockers.includes("missing_acquisition_source"));

const duplicateImages = buildKingmakerListingReadiness({
  metadata: exactMetadata,
  frontImageUrl: "https://example.com/same.jpg",
  backImageUrl: "https://example.com/same.jpg",
  condition: "Near Mint or Better",
  quantity: 1,
  acquisitionSource: "Mercari",
  duplicateDecisionRequired: false,
  websitePrice: 9.99,
  ebayPrice: 11.99,
  mercariPrice: 11.99,
  ebayCardCondition: "Near mint or better",
});
assert.ok(duplicateImages.blockers.includes("duplicate_front_back_image"));

console.log("Kingmaker listing pipeline regressions PASSED");
