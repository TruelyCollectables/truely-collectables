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
});
assert.equal(ready.status, "ready");
assert.equal(ready.boundary, "advisory_only");
assert.ok((ready.suggestedListPrice || 0) > 0);
assert.ok((ready.buyCeiling || 0) < (ready.suggestedListPrice || 0));
assert.equal(ready.reviewReasons.length, 0);

const unresolved = buildKingmakerPricingDecision({
  exactIdentity: false,
  pricing,
  soldComps: [{ price: 100 }, { price: 105 }, { price: 110 }],
});
assert.equal(unresolved.status, "review_required");
assert.equal(unresolved.suggestedListPrice, null);
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

console.log("KINGMAKER Pricing decision regressions passed.");
