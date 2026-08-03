import assert from "node:assert/strict";
import { buildKingmakerPricingDecision } from "../src/lib/kingmaker-pricing-decision";

const pricing = {
  low: 80,
  high: 120,
  midpoint: 100,
  confidence: 0.9,
  status: "verified" as const,
  trendPct: 10,
};

const ready = buildKingmakerPricingDecision({
  exactIdentity: true,
  pricing,
  soldComps: [
    { price: 90, shipping: 5 },
    { price: 100, shipping: 0 },
    { price: 110, shipping: 5 },
    { price: 105, shipping: 0 },
  ],
  targetMarginPct: 0.3,
  marketplaceFeePct: 0.08,
  paymentFeePct: 0.029,
  paymentFixedFee: 0.3,
  shippingCost: 6.99,
});
assert.equal(ready.status, "ready");
assert.equal(ready.boundary, "advisory_only");
assert.ok((ready.suggestedListPrice || 0) > 0);
assert.ok((ready.estimatedNetProceeds || 0) < (ready.suggestedListPrice || 0));
assert.ok((ready.buyCeiling || 0) < (ready.estimatedNetProceeds || 0));
assert.equal(
  ready.estimatedProfitAtCeiling,
  Math.round(((ready.estimatedNetProceeds || 0) - (ready.buyCeiling || 0)) * 100) / 100,
);
assert.equal(ready.economics.marketplaceFeePct, 0.08);
assert.equal(ready.economics.shippingCost, 6.99);
assert.equal(ready.reviewReasons.length, 0);

const unresolved = buildKingmakerPricingDecision({
  exactIdentity: false,
  pricing,
  soldComps: [{ price: 100 }, { price: 105 }, { price: 110 }],
});
assert.equal(unresolved.status, "review_required");
assert.equal(unresolved.suggestedListPrice, null);
assert.equal(unresolved.estimatedNetProceeds, null);
assert.ok(unresolved.reviewReasons.includes("exact_identity_required"));

const thinMarket = buildKingmakerPricingDecision({
  exactIdentity: true,
  pricing,
  soldComps: [{ price: 100 }, { price: 105 }],
});
assert.equal(thinMarket.status, "insufficient_evidence");
assert.equal(thinMarket.buyCeiling, null);
assert.ok(thinMarket.reviewReasons.includes("three_verified_sold_comps_required"));

const reviewReference = buildKingmakerPricingDecision({
  exactIdentity: true,
  pricing: { ...pricing, status: "review_required" },
  soldComps: [{ price: 100 }, { price: 105 }, { price: 110 }],
});
assert.equal(reviewReference.status, "review_required");
assert.equal(reviewReference.suggestedListPrice, null);

const clamped = buildKingmakerPricingDecision({
  exactIdentity: true,
  pricing,
  soldComps: [{ price: 100 }, { price: 105 }, { price: 110 }],
  targetMarginPct: 5,
  marketplaceFeePct: 5,
  paymentFeePct: -1,
  paymentFixedFee: -2,
  shippingCost: -10,
});
assert.equal(clamped.economics.targetMarginPct, 0.8);
assert.equal(clamped.economics.marketplaceFeePct, 0.4);
assert.equal(clamped.economics.paymentFeePct, 0);
assert.equal(clamped.economics.paymentFixedFee, 0);
assert.equal(clamped.economics.shippingCost, 0);

console.log("KINGMAKER Pricing decision regressions passed.");
