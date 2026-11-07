import assert from "node:assert/strict";
import { kingmakerPricingProfileOwner } from "../src/lib/kingmaker-pricing-profile-server";
import { DEFAULT_KINGMAKER_PRICING_PROFILE } from "../src/lib/kingmaker-pricing-profile";

const sellerOwner = kingmakerPricingProfileOwner({
  type: "seller",
  storeId: "store-1",
  sellerAccountId: "seller-1",
} as never);
assert.deepEqual(sellerOwner, {
  storeId: "store-1",
  sellerAccountId: "seller-1",
});

const adminOwner = kingmakerPricingProfileOwner({
  type: "admin",
  storeId: "store-1",
  sellerAccountId: "seller-should-not-leak",
} as never);
assert.deepEqual(adminOwner, {
  storeId: "store-1",
  sellerAccountId: null,
});

assert.equal(DEFAULT_KINGMAKER_PRICING_PROFILE.name, "TCOS Standard");
assert.equal(DEFAULT_KINGMAKER_PRICING_PROFILE.isDefault, true);
assert.ok(DEFAULT_KINGMAKER_PRICING_PROFILE.targetMarginPct > 0);
assert.ok(DEFAULT_KINGMAKER_PRICING_PROFILE.marketplaceFeePct >= 0);

console.log("KINGMAKER Pricing profile hookup regressions passed.");
