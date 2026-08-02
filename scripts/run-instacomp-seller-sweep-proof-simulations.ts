import assert from "node:assert/strict";
import {
  findExactSellerSweepMarketIdentity,
  sellerSweepVerifiedReceiptSales,
} from "../src/lib/instacomp-seller-sweep-proof-core";
import type { SellerSweepCardCandidate } from "../src/lib/instacomp-seller-sweep-identify";
import type { RegistryMatch } from "../src/lib/instacomp-learning-server";

const card: SellerSweepCardCandidate = {
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
  sourceImageUrl: "https://example.test/card.jpg",
  reviewRequired: false,
  reviewReasons: [],
};

const registryMatch: RegistryMatch = {
  identityId: "registry-identity",
  fingerprintSha256: "a".repeat(64),
  sourceLabel: "InstaComp Checklist Registry",
  score: 100,
  manufacturer: "Panini",
  brand: "Panini",
  product: "Prizm WNBA",
  player: "Kiki Iriafen",
  year: "2025",
  setName: "Base Set",
  cardNumber: "149",
  parallel: "Blue Prizm",
  variation: null,
  serialRun: 199,
  team: "Washington Mystics",
  sport: "Basketball",
  league: "WNBA",
  languageCode: null,
  configurationExclusivity: null,
  isAuto: false,
  isRelic: false,
  matchedEvidence: ["unique exact registry match"],
};

const identity = {
  id: "market-identity",
  collectible_type: "sports_card",
  season_year: "2025",
  manufacturer: "Panini",
  brand: "Panini",
  product_line: "Prizm WNBA",
  set_name: "Base Set",
  insert_name: null,
  card_number: "149",
  parallel_name: "Blue Prizm",
  variation_name: null,
  serial_numbered_to: 199,
  autograph: false,
  memorabilia: false,
  condition_type: "raw",
  grading_company: null,
  grade: null,
  identity_confidence: 100,
};

assert.equal(
  findExactSellerSweepMarketIdentity({ card, registryMatch, rows: [identity] })?.id,
  identity.id,
);
assert.equal(
  findExactSellerSweepMarketIdentity({
    card,
    registryMatch,
    rows: [identity, { ...identity, id: "duplicate-identity" }],
  }),
  null,
  "ambiguous Market Intel identities must fail closed",
);
assert.equal(
  findExactSellerSweepMarketIdentity({
    card,
    registryMatch,
    rows: [{ ...identity, autograph: true }],
  }),
  null,
  "autograph mismatch must fail closed",
);

const verifiedMetadata = {
  currency: "USD",
  verified_from: "connected_ebay_buyer_order",
  connected_buyer_order_verified: true,
  receipt_order_line_count: 1,
  independently_verified: true,
  exact_identity_confirmed: true,
  final_price_confirmed: true,
  shipping_price_confirmed: true,
};
const receipt = (id: string, price: number) => ({
  id,
  marketplace_id: "ebay",
  external_sale_id: id,
  source_url: `https://www.ebay.com/itm/${id}`,
  sold_at: "2026-07-20T12:00:00.000Z",
  sold_price: price,
  shipping_price: 4.99,
  quantity: 1,
  verified: true,
  match_confidence: 100,
  excluded: false,
  outlier_flag: false,
  metadata: verifiedMetadata,
});

const first = receipt("sale-1", 25);
const second = receipt("sale-2", 30);
const sales = sellerSweepVerifiedReceiptSales(
  [
    first,
    second,
    { ...first, id: "duplicate-row" },
    { ...receipt("non-usd", 100), metadata: { ...verifiedMetadata, currency: "CAD" } },
    { ...receipt("lot", 100), quantity: 2 },
    {
      ...receipt("manual", 100),
      metadata: {
        ...verifiedMetadata,
        verified_from: "purchase_inbox_manual_review",
        independently_verified: false,
      },
    },
    {
      ...receipt("multi-line", 100),
      metadata: { ...verifiedMetadata, receipt_order_line_count: 2 },
    },
    { ...receipt("wrong-host", 100), source_url: "https://example.test/sale" },
    { ...receipt("future", 100), sold_at: "2027-01-01T00:00:00.000Z" },
  ],
  new Date("2026-08-02T00:00:00.000Z"),
);

assert.equal(sales.length, 2, "only two independent exact USD receipts qualify");
assert.deepEqual(
  sales.map((sale) => sale.saleId),
  ["ebay:sale-1", "ebay:sale-2"],
);
assert.ok(sales.every((sale) => sale.finalPriceConfirmed));

console.log("Seller Sweep proof simulations passed.");
