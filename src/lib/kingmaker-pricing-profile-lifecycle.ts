import {
  normalizeKingmakerPricingProfile,
  type KingmakerPricingProfile,
} from "./kingmaker-pricing-profile";

export const KINGMAKER_PRICING_PROFILE_PRESETS = [
  {
    id: "standard",
    name: "TCOS Standard",
    marketplaceFeePct: 0.08,
    paymentFeePct: 0.029,
    paymentFixedFee: 0.3,
    estimatedShippingCost: 6.99,
    targetMarginPct: 0.3,
  },
  {
    id: "fast-flip",
    name: "Fast Flip",
    marketplaceFeePct: 0.08,
    paymentFeePct: 0.029,
    paymentFixedFee: 0.3,
    estimatedShippingCost: 6.99,
    targetMarginPct: 0.2,
  },
  {
    id: "premium-margin",
    name: "Premium Margin",
    marketplaceFeePct: 0.08,
    paymentFeePct: 0.029,
    paymentFixedFee: 0.3,
    estimatedShippingCost: 6.99,
    targetMarginPct: 0.4,
  },
] as const;

export type KingmakerPricingProfileMutation = Omit<KingmakerPricingProfile, "id"> & {
  expectedVersion?: number;
};

export function normalizeKingmakerPricingProfileMutation(
  input: Record<string, unknown>,
): KingmakerPricingProfileMutation {
  const profile = normalizeKingmakerPricingProfile(input);
  const expectedVersion = Number(input.expectedVersion);
  return {
    ...profile,
    expectedVersion: Number.isInteger(expectedVersion) && expectedVersion > 0
      ? expectedVersion
      : undefined,
  };
}

export function resolveKingmakerPricingProfilePreset(presetId: unknown) {
  const id = String(presetId || "").trim();
  return KINGMAKER_PRICING_PROFILE_PRESETS.find((preset) => preset.id === id) || null;
}

export function normalizeCloneName(name: unknown, sourceName: string) {
  const requested = String(name || "").trim();
  return (requested || `${sourceName} Copy`).slice(0, 80);
}
