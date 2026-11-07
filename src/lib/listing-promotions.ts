export type ListingPromotion = {
  onSale: boolean;
  originalPrice: number | null;
  discountPercent: number;
  automaticFreeShipping: boolean;
  discountCouponCode: string | null;
  discountCouponPercent: number;
  freeShippingCouponCode: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function roundedMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100) / 100
    : 0;
}

export function boundedPromotionPercent(value: unknown, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return allowZero ? 0 : null;
  const rounded = Math.round(number * 100) / 100;
  if (allowZero && rounded === 0) return 0;
  return rounded >= 1 && rounded <= 25 ? rounded : null;
}

export function normalizeListingCouponCode(value: unknown) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");

  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(normalized)
    ? normalized
    : null;
}

export function listingPromotionFromMetadata(
  metadata: unknown,
): ListingPromotion {
  const promo = record(record(metadata).tcos_promo);
  const discountCoupon = record(promo.discount_coupon);
  const freeShippingCoupon = record(promo.free_shipping_coupon);
  const originalPrice = roundedMoney(promo.original_price);
  const discountPercent = boundedPromotionPercent(
    promo.discount_percent,
    true,
  ) || 0;
  const onSale =
    promo.on_sale === true && originalPrice > 0 && discountPercent > 0;

  return {
    onSale,
    originalPrice: originalPrice > 0 ? originalPrice : null,
    discountPercent,
    automaticFreeShipping: promo.free_shipping === true,
    discountCouponCode: normalizeListingCouponCode(discountCoupon.code),
    discountCouponPercent:
      boundedPromotionPercent(discountCoupon.discount_percent, true) || 0,
    freeShippingCouponCode: normalizeListingCouponCode(
      freeShippingCoupon.code,
    ),
  };
}

export function discountedListingPrice(
  originalPrice: unknown,
  discountPercent: unknown,
) {
  const original = roundedMoney(originalPrice);
  const percent = boundedPromotionPercent(discountPercent);
  if (original <= 0 || percent === null) return null;
  return Math.max(0.01, roundedMoney(original * (1 - percent / 100)));
}

export function priceFromInstaCompAdjustment(
  suggestedPrice: unknown,
  adjustmentPercent: unknown,
) {
  const suggestion = roundedMoney(suggestedPrice);
  const adjustment = Number(adjustmentPercent);
  if (
    suggestion <= 0 ||
    !Number.isFinite(adjustment) ||
    adjustment < -25 ||
    adjustment > 25
  ) {
    return null;
  }
  return Math.max(0.01, roundedMoney(suggestion * (1 + adjustment / 100)));
}

export function resolveCartListingCoupon(params: {
  couponCode: string | null;
  productIds: number[];
  promotionByProductId: Map<number, ListingPromotion>;
}) {
  const discountProductIds = new Set<number>();
  const freeShippingProductIds = new Set<number>();
  if (params.couponCode) {
    for (const [productId, promotion] of params.promotionByProductId) {
      if (
        promotion.discountCouponCode === params.couponCode &&
        promotion.discountCouponPercent > 0
      ) {
        discountProductIds.add(productId);
      }
      if (promotion.freeShippingCouponCode === params.couponCode) {
        freeShippingProductIds.add(productId);
      }
    }
  }

  const discountApplies = discountProductIds.size > 0;
  const freeShippingApplies =
    Boolean(params.couponCode) &&
    params.productIds.length > 0 &&
    params.productIds.every((productId) => freeShippingProductIds.has(productId));
  const valid =
    !params.couponCode || discountApplies || freeShippingApplies;

  return {
    valid,
    discountApplies,
    freeShippingApplies,
    discountProductIds,
    freeShippingProductIds,
    error: valid
      ? null
      : freeShippingProductIds.size > 0
        ? "That free-shipping code applies only when every card in the cart is eligible."
        : "Coupon code is not valid for the cards in this cart.",
  };
}
