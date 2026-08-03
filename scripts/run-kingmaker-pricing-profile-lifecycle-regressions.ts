import assert from "node:assert/strict";
import {
  KINGMAKER_PRICING_PROFILE_PRESETS,
  normalizeCloneName,
  normalizeKingmakerPricingProfileMutation,
  resolveKingmakerPricingProfilePreset,
} from "../src/lib/kingmaker-pricing-profile-lifecycle";

assert.equal(KINGMAKER_PRICING_PROFILE_PRESETS.length, 3);
assert.equal(resolveKingmakerPricingProfilePreset("fast-flip")?.targetMarginPct, 0.2);
assert.equal(resolveKingmakerPricingProfilePreset("missing"), null);
assert.equal(normalizeCloneName("", "Standard"), "Standard Copy");
assert.equal(normalizeCloneName("Custom", "Standard"), "Custom");

const normalized = normalizeKingmakerPricingProfileMutation({
  name: "  Seller Profile  ",
  marketplaceFeePct: 99,
  paymentFeePct: -1,
  paymentFixedFee: 100,
  estimatedShippingCost: 999,
  targetMarginPct: 0,
  isDefault: true,
  expectedVersion: 4,
});
assert.equal(normalized.name, "Seller Profile");
assert.equal(normalized.marketplaceFeePct, 0.5);
assert.equal(normalized.paymentFeePct, 0);
assert.equal(normalized.paymentFixedFee, 25);
assert.equal(normalized.estimatedShippingCost, 250);
assert.equal(normalized.targetMarginPct, 0.05);
assert.equal(normalized.isDefault, true);
assert.equal(normalized.expectedVersion, 4);

console.log("KINGMAKER Pricing profile lifecycle regressions passed.");
