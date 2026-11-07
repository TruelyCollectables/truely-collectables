import assert from "node:assert/strict";
import {
  buildInstaCompScanPayload,
  evaluateInstaCompPublicationGate,
} from "../src/lib/instacomp-publication-gate";

function soldSale(id: string, itemId: string, price: number) {
  return {
    title: "2025 Panini Select WNBA #7 White Disco /75",
    itemPrice: price,
    shippingPrice: 0,
    price,
    priceIncludesShipping: true,
    currency: "USD",
    url: `https://www.ebay.com/itm/${itemId}`,
    source: "ebay_connected_receipt",
    sourceLabel: "Connected eBay receipt",
    sourceCategory: "sold",
    matchScore: 100,
    flags: [],
    saleId: id,
    saleVerified: true,
    finalPriceVerified: true,
    shippingVerified: true,
    soldAt: "2026-07-25T18:00:00.000Z",
    observedAt: "2026-08-02T19:00:00.000Z",
  };
}

const scanId = "00000000-0000-4000-8000-000000000111";
const ai = {
  player: "Sonia Citron",
  year: "2025",
  brand: "Panini",
  setName: "Select WNBA",
  cardNumber: "7",
  parallel: "White Disco Prizm",
  serialNumber: "12/75",
  team: "Washington Mystics",
  sport: "Basketball",
  isAuto: false,
  isRelic: false,
  confidence: 0.99,
};
const rawCompResults = {
  review: {
    identityReviewReasons: [],
    pricingReviewReasons: [],
    trustedForPricing: true,
  },
  catalogEvidence: {
    status: "catalog_confirmed",
    catalogConfirmed: true,
    actionPermissions: {
      publicListingClaimAllowed: true,
      autoPriceAllowed: true,
    },
    compIdentity: ai,
  },
  marketEvidence: {
    verifiedSoldComps: [
      soldSale("order-1:item-111111111111", "111111111111", 40),
      soldSale("order-2:item-222222222222", "222222222222", 50),
    ],
  },
};
const scanPayload = buildInstaCompScanPayload({
  scanId,
  rawAiResult: ai,
  rawCompResults,
});
const metadata = {
  pendingImport: {
    source: "pending_card_import",
    originalIdentity: ai,
  },
  cardIdentity: ai,
  instacomp: {
    status: "complete",
    version: "2.0",
    scanId,
    identityConfidence: 0.99,
    catalogConfirmed: true,
    reviewReasons: [],
    listingPrice: 59.99,
    decision: { action: "BUY", listPrice: 59.99 },
  },
};

const allowed = evaluateInstaCompPublicationGate({ metadata, scanPayload });
assert.equal(allowed.allowed, true);
assert.equal(allowed.gate?.verifiedSaleCount, 2);
assert.equal(allowed.listingPrice, 59.99);

const missingScan = evaluateInstaCompPublicationGate({
  metadata,
  scanPayload: null,
});
assert.equal(missingScan.allowed, false);
assert.ok(missingScan.reasons.includes("instacomp_scan_record_missing"));

const pending = evaluateInstaCompPublicationGate({
  metadata: {
    ...metadata,
    instacomp: { ...metadata.instacomp, status: "pending" },
  },
  scanPayload,
});
assert.equal(pending.allowed, false);
assert.ok(pending.reasons.includes("instacomp_scan_not_complete"));

const mismatchedScan = evaluateInstaCompPublicationGate({
  metadata,
  scanPayload: { ...scanPayload, scanId: crypto.randomUUID() },
});
assert.equal(mismatchedScan.allowed, false);
assert.ok(mismatchedScan.reasons.includes("instacomp_scan_record_mismatch"));

const tamperedPrice = evaluateInstaCompPublicationGate({
  metadata: {
    ...metadata,
    instacomp: { ...metadata.instacomp, listingPrice: 999.99 },
  },
  scanPayload,
});
assert.equal(tamperedPrice.allowed, false);
assert.ok(
  tamperedPrice.reasons.includes("stored_instacomp_price_receipt_mismatch"),
);

const reviewRequired = evaluateInstaCompPublicationGate({
  metadata: {
    ...metadata,
    instacomp: {
      ...metadata.instacomp,
      reviewReasons: ["operator_review_required"],
    },
  },
  scanPayload,
});
assert.equal(reviewRequired.allowed, false);
assert.ok(reviewRequired.reasons.includes("stored_instacomp_review_required"));

const oneSalePayload = buildInstaCompScanPayload({
  scanId,
  rawAiResult: ai,
  rawCompResults: {
    ...rawCompResults,
    marketEvidence: {
      verifiedSoldComps: [
        soldSale("order-1:item-111111111111", "111111111111", 40),
      ],
    },
  },
});
const oneSale = evaluateInstaCompPublicationGate({
  metadata,
  scanPayload: oneSalePayload,
});
assert.equal(oneSale.allowed, false);
assert.ok(
  oneSale.reasons.includes("insufficient_independent_verified_sales"),
);

const askingOnlyPayload = buildInstaCompScanPayload({
  scanId,
  rawAiResult: ai,
  rawCompResults: {
    ...rawCompResults,
    marketEvidence: {
      verifiedSoldComps: [],
      activeComps: [
        {
          title: "Active listing",
          price: 500,
          currency: "USD",
          url: "https://www.ebay.com/itm/333333333333",
          sourceCategory: "active",
        },
      ],
    },
  },
});
const askingOnly = evaluateInstaCompPublicationGate({
  metadata,
  scanPayload: askingOnlyPayload,
});
assert.equal(askingOnly.allowed, false);
assert.ok(
  askingOnly.reasons.includes("insufficient_independent_verified_sales"),
);

console.log("InstaComp publication boundary regressions passed (all assertions).");
