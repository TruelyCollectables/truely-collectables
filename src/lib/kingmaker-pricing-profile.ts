export type KingmakerPricingProfile = {
  id: string;
  name: string;
  marketplaceFeePct: number;
  paymentFeePct: number;
  paymentFixedFee: number;
  estimatedShippingCost: number;
  targetMarginPct: number;
  isDefault: boolean;
};

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(parsed, max)) : fallback;
}

export function normalizeKingmakerPricingProfile(input: Record<string, unknown>): Omit<KingmakerPricingProfile, "id"> {
  const name = String(input.name || "Pricing Profile").trim().slice(0, 80) || "Pricing Profile";
  return {
    name,
    marketplaceFeePct: clamp(input.marketplaceFeePct, 0, 0.5, 0.08),
    paymentFeePct: clamp(input.paymentFeePct, 0, 0.25, 0.029),
    paymentFixedFee: clamp(input.paymentFixedFee, 0, 25, 0.3),
    estimatedShippingCost: clamp(input.estimatedShippingCost, 0, 250, 6.99),
    targetMarginPct: clamp(input.targetMarginPct, 0.05, 0.8, 0.3),
    isDefault: input.isDefault === true,
  };
}

export const DEFAULT_KINGMAKER_PRICING_PROFILE: Omit<KingmakerPricingProfile, "id"> = {
  name: "TCOS Standard",
  marketplaceFeePct: 0.08,
  paymentFeePct: 0.029,
  paymentFixedFee: 0.3,
  estimatedShippingCost: 6.99,
  targetMarginPct: 0.3,
  isDefault: true,
};
