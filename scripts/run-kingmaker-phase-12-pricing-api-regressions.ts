import assert from "node:assert/strict";
import { buildInstaCompKingmakerPricing } from "../src/lib/instacomp-kingmaker-pricing";

const missing = buildInstaCompKingmakerPricing(null);
assert.deepEqual(missing, {
  available: false,
  low: null,
  high: null,
  midpoint: null,
  currency: null,
  confidence: null,
  status: null,
  editionDate: null,
  historyCount: 0,
  trendPct: null,
  pricingUse: "display_only",
});

const pricing = buildInstaCompKingmakerPricing({
  identityId: "11111111-1111-4111-8111-111111111111",
  identityKey: "card:test",
  editionDate: "2026-09-01",
  low: 100,
  high: 140,
  midpoint: 120,
  currency: "USD",
  confidence: 0.94,
  status: "review_required",
  historyCount: 2,
  trendPct: 20,
  refreshedAt: "2026-08-03T17:00:00.000Z",
});

assert.equal(pricing.available, true);
assert.equal(pricing.low, 100);
assert.equal(pricing.high, 140);
assert.equal(pricing.midpoint, 120);
assert.equal(pricing.status, "review_required");
assert.equal(pricing.pricingUse, "display_only");
assert.equal("identityId" in pricing, false);
assert.equal("identityKey" in pricing, false);
assert.equal("sourceGuideId" in pricing, false);
assert.equal("guideId" in pricing, false);
assert.equal("entryId" in pricing, false);
assert.equal("source" in pricing, false);

console.log("KINGMAKER Phase 12 Pricing API regressions passed.");
