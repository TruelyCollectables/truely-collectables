export const TRUELY_EBAY_LAUNCH_POLICY_VERSION = "truely-ebay-launch-v1";
export const TRUELY_WEBSITE_SHIPPING_RULES_VERSION = "truely-shipping-2026-07-26";

export type TruelyEbayLaunchDecision = {
  allowed: boolean;
  reason: string;
  shippingProfile: "card_letter_eligible" | "parcel_only";
};

const EXPLICIT_BLOCK_PATTERN =
  /\b(?:pants?|air\s+intake|fuel\s+sensor)\b/i;
const CARD_CATEGORY_KEYS = new Set(["sports_cards", "trading_cards"]);
const SEALED_OR_NONLETTER_PATTERN =
  /\b(?:box|case|pack|sealed|wax|lot|shoe|sneaker|boot|watch|wristwatch|sunglasses|puck|jersey|helmet|bat|ball|photo|photograph|comic|coin|toy|figure)\b/i;

export function truelyWebsiteShippingProfile(params: {
  mappedCategory: string;
  title: string;
}) {
  return CARD_CATEGORY_KEYS.has(params.mappedCategory) &&
    !SEALED_OR_NONLETTER_PATTERN.test(params.title)
    ? ("card_letter_eligible" as const)
    : ("parcel_only" as const);
}

export function evaluateTruelyEbayLaunchListing(params: {
  title: string;
  categoryName?: string | null;
  mappedCategory: string;
  listingType: string;
  price: number;
  quantity: number;
  imageCount: number;
}): TruelyEbayLaunchDecision {
  const shippingProfile = truelyWebsiteShippingProfile(params);
  const searchable = `${params.title} ${params.categoryName || ""}`;

  if (EXPLICIT_BLOCK_PATTERN.test(searchable)) {
    return {
      allowed: false,
      reason: "explicit_blocked_category_or_title",
      shippingProfile,
    };
  }

  if (!["FixedPriceItem", "StoresFixedPrice"].includes(params.listingType)) {
    return {
      allowed: false,
      reason: "auction_or_unsupported_listing_type",
      shippingProfile,
    };
  }

  if (!params.title.trim() || params.title.trim().toLowerCase() === "untitled") {
    return { allowed: false, reason: "missing_title", shippingProfile };
  }

  if (!Number.isFinite(params.price) || params.price <= 0) {
    return { allowed: false, reason: "invalid_price", shippingProfile };
  }

  if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
    return { allowed: false, reason: "not_available", shippingProfile };
  }

  if (params.imageCount <= 0) {
    return { allowed: false, reason: "missing_images", shippingProfile };
  }

  return { allowed: true, reason: "allowed_by_truely_policy", shippingProfile };
}

export function publicLaunchMetadataAllowed(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return true;
  }

  const record = metadata as Record<string, unknown>;
  const policy =
    record.truely_ebay_launch &&
    typeof record.truely_ebay_launch === "object" &&
    !Array.isArray(record.truely_ebay_launch)
      ? (record.truely_ebay_launch as Record<string, unknown>)
      : null;

  return !policy || policy.allowed === true;
}
