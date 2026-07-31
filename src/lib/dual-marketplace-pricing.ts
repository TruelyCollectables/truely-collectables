export type DualMarketplaceFeeProfile = {
  ebayPercent: number;
  ebayFixed: number;
  ebayFixedUnderTen: number;
  promotedPercent: number;
  websitePercent: number;
  websiteFixed: number;
  minimumWebsiteDiscountPercent: number;
  websitePriceEnding: number;
};

export type DualMarketplacePriceBreakdown = {
  ebayPrice: number;
  ebayEstimatedFees: number;
  ebayEstimatedNet: number;
  websitePrice: number;
  websiteEstimatedFees: number;
  websiteEstimatedNet: number;
  customerSavings: number;
  customerSavingsPercent: number;
  netDifference: number;
};

export const DEFAULT_DUAL_MARKETPLACE_FEES: DualMarketplaceFeeProfile = {
  ebayPercent: 0.1325,
  ebayFixed: 0.4,
  ebayFixedUnderTen: 0.3,
  promotedPercent: 0,
  websitePercent: 0.029,
  websiteFixed: 0.3,
  minimumWebsiteDiscountPercent: 0.03,
  websitePriceEnding: 0.99,
};

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeDualMarketplaceFeeProfile(
  profile: Partial<DualMarketplaceFeeProfile> = {},
): DualMarketplaceFeeProfile {
  return {
    ebayPercent: clamp(
      finiteNumber(profile.ebayPercent, DEFAULT_DUAL_MARKETPLACE_FEES.ebayPercent),
      0,
      0.95,
    ),
    ebayFixed: clamp(
      finiteNumber(profile.ebayFixed, DEFAULT_DUAL_MARKETPLACE_FEES.ebayFixed),
      0,
      100,
    ),
    ebayFixedUnderTen: clamp(
      finiteNumber(
        profile.ebayFixedUnderTen,
        DEFAULT_DUAL_MARKETPLACE_FEES.ebayFixedUnderTen,
      ),
      0,
      100,
    ),
    promotedPercent: clamp(
      finiteNumber(
        profile.promotedPercent,
        DEFAULT_DUAL_MARKETPLACE_FEES.promotedPercent,
      ),
      0,
      0.95,
    ),
    websitePercent: clamp(
      finiteNumber(
        profile.websitePercent,
        DEFAULT_DUAL_MARKETPLACE_FEES.websitePercent,
      ),
      0,
      0.95,
    ),
    websiteFixed: clamp(
      finiteNumber(profile.websiteFixed, DEFAULT_DUAL_MARKETPLACE_FEES.websiteFixed),
      0,
      100,
    ),
    minimumWebsiteDiscountPercent: clamp(
      finiteNumber(
        profile.minimumWebsiteDiscountPercent,
        DEFAULT_DUAL_MARKETPLACE_FEES.minimumWebsiteDiscountPercent,
      ),
      0,
      0.95,
    ),
    websitePriceEnding: clamp(
      finiteNumber(
        profile.websitePriceEnding,
        DEFAULT_DUAL_MARKETPLACE_FEES.websitePriceEnding,
      ),
      0,
      0.99,
    ),
  };
}

function floorToPriceEnding(value: number, ending: number) {
  if (value <= 0) return 0;

  const safeValue = roundMoney(value);
  const normalizedEnding = clamp(ending, 0, 0.99);

  // A .99 strategy must never turn a legitimate sub-dollar card into $0.01.
  if (safeValue < 1 || normalizedEnding <= 0) {
    return Math.max(0.01, Math.floor((safeValue + Number.EPSILON) * 100) / 100);
  }

  const whole = Math.floor(safeValue);
  let candidate = whole + normalizedEnding;

  if (candidate > safeValue + 0.000001) {
    candidate = whole - 1 + normalizedEnding;
  }

  if (candidate <= 0) {
    return Math.max(0.01, Math.floor((safeValue + Number.EPSILON) * 100) / 100);
  }

  return roundMoney(candidate);
}

function ebayFixedFee(ebayPrice: number, profile: DualMarketplaceFeeProfile) {
  return ebayPrice <= 10 ? profile.ebayFixedUnderTen : profile.ebayFixed;
}

export function calculateCustomWebsitePricing(
  ebayPriceInput: number,
  websitePriceInput: number,
  profileInput: Partial<DualMarketplaceFeeProfile> = {},
): DualMarketplacePriceBreakdown {
  const profile = normalizeDualMarketplaceFeeProfile(profileInput);
  const ebayPrice = roundMoney(Math.max(0, finiteNumber(ebayPriceInput, 0)));
  const websitePrice = roundMoney(Math.max(0, finiteNumber(websitePriceInput, 0)));
  const ebayRate = clamp(profile.ebayPercent + profile.promotedPercent, 0, 0.95);
  const ebayEstimatedFees =
    ebayPrice > 0
      ? roundMoney(ebayPrice * ebayRate + ebayFixedFee(ebayPrice, profile))
      : 0;
  const ebayEstimatedNet = roundMoney(Math.max(0, ebayPrice - ebayEstimatedFees));
  const websiteEstimatedFees =
    websitePrice > 0
      ? roundMoney(websitePrice * profile.websitePercent + profile.websiteFixed)
      : 0;
  const websiteEstimatedNet = roundMoney(
    Math.max(0, websitePrice - websiteEstimatedFees),
  );
  const customerSavings = roundMoney(Math.max(0, ebayPrice - websitePrice));

  return {
    ebayPrice,
    ebayEstimatedFees,
    ebayEstimatedNet,
    websitePrice,
    websiteEstimatedFees,
    websiteEstimatedNet,
    customerSavings,
    customerSavingsPercent: roundMoney(
      ebayPrice > 0 ? (customerSavings / ebayPrice) * 100 : 0,
    ),
    netDifference: roundMoney(websiteEstimatedNet - ebayEstimatedNet),
  };
}

export function calculateDualMarketplacePricing(
  ebayPriceInput: number,
  profileInput: Partial<DualMarketplaceFeeProfile> = {},
): DualMarketplacePriceBreakdown {
  const profile = normalizeDualMarketplaceFeeProfile(profileInput);
  const ebayPrice = roundMoney(Math.max(0, finiteNumber(ebayPriceInput, 0)));

  if (ebayPrice <= 0) {
    return calculateCustomWebsitePricing(0, 0, profile);
  }

  const ebayRate = clamp(profile.ebayPercent + profile.promotedPercent, 0, 0.95);
  const ebayEstimatedFees = roundMoney(
    ebayPrice * ebayRate + ebayFixedFee(ebayPrice, profile),
  );
  const ebayEstimatedNet = roundMoney(Math.max(0, ebayPrice - ebayEstimatedFees));
  const websiteRateDenominator = Math.max(0.01, 1 - profile.websitePercent);
  const parityWebsitePrice =
    (ebayEstimatedNet + profile.websiteFixed) / websiteRateDenominator;
  const discountCeiling = ebayPrice * (1 - profile.minimumWebsiteDiscountPercent);
  const rawWebsitePrice = Math.min(parityWebsitePrice, discountCeiling);
  let websitePrice = floorToPriceEnding(rawWebsitePrice, profile.websitePriceEnding);

  if (websitePrice >= ebayPrice) {
    websitePrice = floorToPriceEnding(
      Math.max(0.01, ebayPrice - 0.01),
      profile.websitePriceEnding,
    );
  }

  websitePrice = roundMoney(Math.max(0.01, websitePrice));
  return calculateCustomWebsitePricing(ebayPrice, websitePrice, profile);
}
