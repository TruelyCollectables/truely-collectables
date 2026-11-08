import assert from "node:assert/strict";
import {
  DEFAULT_KINGMAKER_PRICING_PROFILE,
  normalizeKingmakerPricingProfile,
} from "../src/lib/kingmaker-pricing-profile";

const normalized = normalizeKingmakerPricingProfile({
  name: "  Marketplace A  ",
  marketplaceFeePct: 9,
  paymentFeePct: -1,
  paymentFixedFee: 100,
  estimatedShippingCost: -5,
  targetMarginPct: 4,
  isDefault: true,
});
assert.equal(normalized.name, "Marketplace A");
assert.equal(normalized.marketplaceFeePct, 0.5);
assert.equal(normalized.paymentFeePct, 0);
assert.equal(normalized.paymentFixedFee, 25);
assert.equal(normalized.estimatedShippingCost, 0);
assert.equal(normalized.targetMarginPct, 0.8);
assert.equal(normalized.isDefault, true);

const fallback = normalizeKingmakerPricingProfile({});
assert.equal(fallback.marketplaceFeePct, DEFAULT_KINGMAKER_PRICING_PROFILE.marketplaceFeePct);
assert.equal(fallback.paymentFeePct, DEFAULT_KINGMAKER_PRICING_PROFILE.paymentFeePct);
assert.equal(fallback.targetMarginPct, DEFAULT_KINGMAKER_PRICING_PROFILE.targetMarginPct);
assert.equal(DEFAULT_KINGMAKER_PRICING_PROFILE.marketplaceFeePct, 0.08);

console.log("KINGMAKER Pricing profile regressions passed.");
