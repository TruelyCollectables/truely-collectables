import assert from "node:assert/strict";
import {
  assess130PointVerificationNeed,
  build130PointVerificationQuery,
  build130PointVerificationUrl,
  normalize130PointExtractedRows,
} from "../src/lib/instacomp-130point-verification";
import {
  buildExactMarketObservation,
} from "../src/lib/instacomp-market-history";
import { isInstaCompPricingEligibleComp } from "../src/lib/instacomp-live-pipeline";
import { trustedHistoricalSoldPricing } from "../src/lib/deal-hunter-trusted-sold-history";
import type { InstaCompAiResult, InstaCompComp } from "../src/lib/instacomp";

const now = new Date("2026-08-26T12:00:00-06:00");
const ai: InstaCompAiResult = {
  player: "Caitlin Clark", year: "2024", brand: "Panini", setName: "Prizm WNBA Fireworks",
  cardNumber: "13", parallel: "Green", serialNumber: null, team: "Indiana Fever",
  sport: "Basketball", isRookie: true, isAuto: false, isRelic: false,
  conditionGuess: "Near Mint", confidence: 0.99, notes: null,
};
const recent = [
  { price: 75, soldAt: "2026-08-24" },
  { price: 72, soldAt: "2026-08-20" },
  { price: 74, soldAt: "2026-08-15" },
  { price: 73, soldAt: "2026-08-10" },
];
assert.equal(assess130PointVerificationNeed({ sold: recent, now }).needed, false);
assert.equal(
  assess130PointVerificationNeed({ sold: recent.slice(0, 2), now }).needed,
  true,
);
assert.equal(
  assess130PointVerificationNeed({ sold: [{ price: 70, soldAt: "2026-05-01" }], now }).needed,
  true,
);
assert.equal(
  assess130PointVerificationNeed({
    sold: [{ price: 50, soldAt: "2026-08-25" }, { price: 55, soldAt: "2026-08-24" }, { price: 100, soldAt: "2026-08-20" }, { price: 120, soldAt: "2026-08-10" }],
    now,
  }).needed,
  true,
);
const query = build130PointVerificationQuery(ai, "fallback");
assert.match(query, /Caitlin Clark/i);
assert.match(query, /Green/i);
assert.match(build130PointVerificationUrl(query), /^https:\/\/130point\.com\/sales\/\?search=/);

const normalized = normalize130PointExtractedRows({ sales: [
  { title: "2024 Panini Prizm WNBA Fireworks Caitlin Clark Green #13", price: 75, currency: "USD", marketplace: "eBay", saleType: "Fixed Price", soldAt: "2026-08-24", bids: null, exactIdentity: true, notes: "visible" },
  { title: "bad", price: 0, soldAt: "2026-08-24" },
] });
assert.equal(normalized.length, 1);
assert.equal(normalized[0].price, 75);
assert.equal(normalized[0].exactIdentity, true);

const manualComp: InstaCompComp = {
  title: normalized[0].title, price: 75, itemPrice: 75, shippingPrice: null,
  priceIncludesShipping: false, currency: "USD",
  url: "https://130point.com/sales/?search=test#manual-evidence-abc-1", imageUrl: null,
  source: "130point_manual_screenshot_ebay", sourceLabel: "130point Manual Verified Sold (eBay)",
  sourceCategory: "sold", matchScore: 100, flags: ["130point manual screenshot evidence"],
  soldAt: "2026-08-24T00:00:00.000Z", observedAt: now.toISOString(),
};
assert.equal(isInstaCompPricingEligibleComp(manualComp), true);
const observation = buildExactMarketObservation({
  registryIdentityId: "11111111-1111-4111-8111-111111111111",
  kind: "SOLD",
  comp: manualComp,
  observedAt: now.toISOString(),
});
assert.equal(observation.item_price, 75);
assert.equal(observation.shipping_price, null);
assert.equal(observation.delivered_price, null);

const history = {
  identity: {
    registry_identity_id: "11111111-1111-4111-8111-111111111111",
    registry_fingerprint_sha256: "abc123",
  },
  observations: [observation],
};
const reused = trustedHistoricalSoldPricing({
  history,
  registryIdentityId: "11111111-1111-4111-8111-111111111111",
  registryFingerprintSha256: "abc123",
  now,
  maxAgeDays: 90,
});
assert.ok(reused);
assert.equal(reused?.medianDeliveredPrice, 75);

console.log("PASS instacomp 130point verification simulations");
