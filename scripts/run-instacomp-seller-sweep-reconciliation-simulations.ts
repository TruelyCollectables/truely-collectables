import assert from "node:assert/strict";
import { valueSellerSweepCard } from "../src/lib/instacomp-seller-sweep-economics";
import type { SellerSweepCardCandidate } from "../src/lib/instacomp-seller-sweep-identify";
import {
  reconcileSellerSweepCandidates,
  sellerSweepPhysicalCardCount,
} from "../src/lib/instacomp-seller-sweep-reconcile";

function candidate(
  sourceImageUrl: string,
  overrides: Partial<SellerSweepCardCandidate> = {},
): SellerSweepCardCandidate {
  return {
    player: "Kiki Iriafen",
    year: "2025",
    brand: "Panini",
    setName: "Prizm WNBA",
    cardNumber: "149",
    parallel: "Blue Prizm",
    serialNumber: "12/199",
    isRookie: true,
    isAutograph: false,
    isRelic: false,
    isGraded: false,
    gradingCompany: null,
    grade: null,
    packagingState: "raw_card",
    confidence: 0.98,
    visibleEvidence: ["card number 149", "serial stamp 12/199"],
    sourceImageUrl,
    reviewRequired: false,
    reviewReasons: [],
    ...overrides,
  };
}

const repeatedAcrossPhotos = reconcileSellerSweepCandidates([
  candidate("https://example.test/front.jpg", {
    confidence: 0.82,
    reviewRequired: true,
    reviewReasons: ["candidate_confidence_below_90_percent"],
    visibleEvidence: ["player name visible"],
  }),
  candidate("https://example.test/back.jpg", {
    confidence: 0.98,
    visibleEvidence: ["card number 149", "serial stamp 12/199"],
  }),
]);

assert.equal(
  repeatedAcrossPhotos.length,
  1,
  "the same exact physical-card candidate across separate photos must not be valued twice",
);
assert.equal(repeatedAcrossPhotos[0].quantity, 1);
assert.equal(repeatedAcrossPhotos[0].confidence, 0.98);
assert.equal(repeatedAcrossPhotos[0].reviewRequired, false);
assert.deepEqual(repeatedAcrossPhotos[0].sourceImageUrls, [
  "https://example.test/front.jpg",
  "https://example.test/back.jpg",
]);
assert.equal(repeatedAcrossPhotos[0].reconciliation.observedCandidateCount, 2);
assert.equal(repeatedAcrossPhotos[0].reconciliation.crossImageDuplicatesCollapsed, 1);
assert.deepEqual(repeatedAcrossPhotos[0].visibleEvidence.sort(), [
  "card number 149",
  "player name visible",
  "serial stamp 12/199",
]);

const twoVisibleCopies = reconcileSellerSweepCandidates([
  candidate("https://example.test/group.jpg"),
  candidate("https://example.test/group.jpg"),
]);

assert.equal(twoVisibleCopies.length, 1);
assert.equal(twoVisibleCopies[0].quantity, 2);
assert.equal(twoVisibleCopies[0].reconciliation.maxVisibleInSingleImage, 2);
assert.equal(twoVisibleCopies[0].reviewRequired, true);
assert.ok(
  twoVisibleCopies[0].reviewReasons.includes(
    "duplicate_quantity_requires_visual_confirmation",
  ),
);

const duplicateValuation = valueSellerSweepCard({
  ...twoVisibleCopies[0],
  identityProof: {
    status: "verified_exact",
    exactIdentityConfirmed: true,
    checklistConfirmed: true,
    noConflictingEvidence: true,
  },
  verifiedCompletedSales: [
    {
      saleId: "ebay:one",
      price: 20,
      shipping: 5,
      soldAt: "2026-07-01T00:00:00.000Z",
      currency: "USD",
      sourceUrl: "https://www.ebay.com/itm/one",
      independentlyVerified: true,
      exactIdentityMatch: true,
      finalPriceConfirmed: true,
    },
    {
      saleId: "ebay:two",
      price: 25,
      shipping: 5,
      soldAt: "2026-07-02T00:00:00.000Z",
      currency: "USD",
      sourceUrl: "https://www.ebay.com/itm/two",
      independentlyVerified: true,
      exactIdentityMatch: true,
      finalPriceConfirmed: true,
    },
  ],
});
assert.equal(duplicateValuation.status, "review");
assert.equal(duplicateValuation.retailValue, 0);

const twoCopiesAcrossPhotos = reconcileSellerSweepCandidates([
  candidate("https://example.test/group.jpg"),
  candidate("https://example.test/group.jpg"),
  candidate("https://example.test/single.jpg"),
]);
assert.equal(twoCopiesAcrossPhotos[0].quantity, 2);
assert.equal(twoCopiesAcrossPhotos[0].reconciliation.observedCandidateCount, 3);
assert.equal(twoCopiesAcrossPhotos[0].reconciliation.crossImageDuplicatesCollapsed, 1);
assert.equal(sellerSweepPhysicalCardCount(twoCopiesAcrossPhotos), 2);
assert.equal(sellerSweepPhysicalCardCount([{ quantity: 999 }]), 100);
assert.equal(sellerSweepPhysicalCardCount(null), 0);

const distinctSerials = reconcileSellerSweepCandidates([
  candidate("https://example.test/group.jpg", { serialNumber: "12/199" }),
  candidate("https://example.test/group.jpg", { serialNumber: "88/199" }),
]);
assert.equal(
  distinctSerials.length,
  2,
  "different visible serial numerators are different physical cards",
);
assert.ok(distinctSerials.every((card) => card.quantity === 1));

const delimiterSensitiveSerials = reconcileSellerSweepCandidates([
  candidate("https://example.test/group.jpg", { serialNumber: "12/199" }),
  candidate("https://example.test/group.jpg", { serialNumber: "1/2199" }),
]);
assert.equal(
  delimiterSensitiveSerials.length,
  2,
  "serial punctuation must remain identity-significant during reconciliation",
);

console.log("Seller Sweep photo reconciliation simulations passed.");
