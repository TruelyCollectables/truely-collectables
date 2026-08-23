import assert from "node:assert/strict";
import {
  boundedPromotionPercent,
  discountedListingPrice,
  listingPromotionFromMetadata,
  normalizeListingCouponCode,
  priceFromInstaCompAdjustment,
  resolveCartListingCoupon,
} from "../src/lib/listing-promotions";
import {
  instaCompPricingGroupKey,
  summarizeInstaCompPricingGroup,
} from "../src/lib/instacomp-pricing-group";

assert.equal(priceFromInstaCompAdjustment(100, -25), 75);
assert.equal(priceFromInstaCompAdjustment(100, 25), 125);
assert.equal(priceFromInstaCompAdjustment(100, 26), null);
assert.equal(discountedListingPrice(80, 25), 60);
assert.equal(boundedPromotionPercent(0), null);
assert.equal(normalizeListingCouponCode(" card deal "), "CARD-DEAL");
assert.equal(normalizeListingCouponCode("x"), null);

const fingerprint = "a".repeat(64);
assert.equal(
  instaCompPricingGroupKey({
    instacomp: { channelDraft: { registryFingerprintSha256: fingerprint } },
  }),
  fingerprint,
);
assert.deepEqual(
  summarizeInstaCompPricingGroup([
    { status: "draft", quantity: 1, legacy_product_id: 10 },
    { status: "active", quantity: 2, legacy_product_id: 11 },
  ]),
  {
    exactChecklistIdentity: true,
    totalRows: 2,
    totalQuantity: 3,
    pendingRows: 1,
    activeRows: 1,
    listedProductIds: [11],
  },
);

const discountOnly = listingPromotionFromMetadata({
  tcos_promo: {
    discount_coupon: { code: "CARD-DEAL", discount_percent: 10 },
  },
});
const shippingOnly = listingPromotionFromMetadata({
  tcos_promo: { free_shipping_coupon: { code: "SHIP-FREE" } },
});
const both = listingPromotionFromMetadata({
  tcos_promo: {
    discount_coupon: { code: "BOTH", discount_percent: 15 },
    free_shipping_coupon: { code: "BOTH" },
  },
});

const promotions = new Map([
  [1, discountOnly],
  [2, shippingOnly],
  [3, both],
]);

const discountDecision = resolveCartListingCoupon({
  couponCode: "CARD-DEAL",
  productIds: [1, 2],
  promotionByProductId: promotions,
});
assert.equal(discountDecision.valid, true);
assert.deepEqual([...discountDecision.discountProductIds], [1]);
assert.equal(discountDecision.freeShippingApplies, false);

const mixedShippingDecision = resolveCartListingCoupon({
  couponCode: "SHIP-FREE",
  productIds: [1, 2],
  promotionByProductId: promotions,
});
assert.equal(mixedShippingDecision.valid, false);
assert.equal(mixedShippingDecision.freeShippingApplies, false);

const shippingDecision = resolveCartListingCoupon({
  couponCode: "SHIP-FREE",
  productIds: [2],
  promotionByProductId: promotions,
});
assert.equal(shippingDecision.valid, true);
assert.equal(shippingDecision.freeShippingApplies, true);

const bothDecision = resolveCartListingCoupon({
  couponCode: "BOTH",
  productIds: [3],
  promotionByProductId: promotions,
});
assert.equal(bothDecision.discountApplies, true);
assert.equal(bothDecision.freeShippingApplies, true);

console.log("Listing promotion simulations passed.");
