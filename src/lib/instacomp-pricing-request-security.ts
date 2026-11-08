export const INSTACOMP_SERVER_OWNED_PRICING_FIELDS = [
  "exactIdentity",
  "soldComps",
  "targetMarginPct",
  "marketplaceFeePct",
  "paymentFeePct",
  "paymentFixedFee",
  "shippingCost",
] as const;

export type InstaCompServerOwnedPricingField =
  (typeof INSTACOMP_SERVER_OWNED_PRICING_FIELDS)[number];

export function suppliedInstaCompServerOwnedPricingFields(
  body: Record<string, unknown>,
): InstaCompServerOwnedPricingField[] {
  return INSTACOMP_SERVER_OWNED_PRICING_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
}
