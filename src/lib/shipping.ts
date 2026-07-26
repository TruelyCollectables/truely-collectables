export type ShippingMethod =
  | "STANDARD_ENVELOPE"
  | "GROUND_ADVANTAGE"
  | "PRIORITY_MAIL";

export const STANDARD_ENVELOPE_MAX_SUBTOTAL = 20;
export const STANDARD_ENVELOPE_MAX_CARDS = 4;
export const STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES = 3;
export const STANDARD_ENVELOPE_ESTIMATED_OUNCES_PER_CARD = 0.75;
export const STANDARD_ENVELOPE_BUYER_PRICE = 1.99;
export const GROUND_ADVANTAGE_TEN_OUNCE_MIN_CARDS = 13;
export const GROUND_ADVANTAGE_TEN_OUNCE_MAX_CARDS = 19;
export const GROUND_ADVANTAGE_TEN_OUNCE_PRICE = 10.99;
export const PRIORITY_MAIL_MIN_CARDS = 20;
export const PRIORITY_MAIL_BUYER_PRICE = 14.99;
export const FREE_PRIORITY_MAIL_THRESHOLD = 250;
export const SHIPPING_COVERAGE_PROVIDER = "Coverage";
export const STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER =
  "LetterTrack / USPS IMb";
export const UNDER_20_SELLER_PROTECTION_PROVIDER =
  "Truely Collectables Under-$20 Seller Protection";
export const UNDER_20_SELLER_PROTECTION_RATE = 0.02;
export const UNDER_20_SELLER_PROTECTION_MAX_COVERAGE = 20;
export const UNDER_20_SELLER_PROTECTION_METADATA_KEY =
  "under20SellerProtectionOptIn";

const STANDARD_ENVELOPE_RATE_CHANGE_UTC = Date.UTC(2026, 6, 12, 7, 0, 0);
const STANDARD_ENVELOPE_RATES_BEFORE_JULY_12_2026 = [0.74, 1.03, 1.32];
const STANDARD_ENVELOPE_RATES_FROM_JULY_12_2026 = [0.78, 1.07, 1.36];

export const SHIPPING_RULES = {
  STANDARD_ENVELOPE: {
    name: "Tracked Card Letter — Limited USPS scan visibility",
    shortName: "Tracked Card Letter",
    basePrice: STANDARD_ENVELOPE_BUYER_PRICE,
    cardsIncluded: STANDARD_ENVELOPE_MAX_CARDS,
    additionalCardPrice: 0,
    freeShippingThreshold: null,
    deliveryEstimate:
      "Limited USPS Intelligent Mail barcode scan visibility when available",
  },
  GROUND_ADVANTAGE: {
    name: "USPS Ground Advantage",
    shortName: "Ground Advantage",
    basePrice: 6.99,
    cardsIncluded: 5,
    additionalCardPrice: 0.25,
    freeShippingThreshold: null,
    deliveryEstimate: "2–5 business days",
  },
  PRIORITY_MAIL: {
    name: "USPS Priority Mail",
    shortName: "Priority Mail",
    basePrice: PRIORITY_MAIL_BUYER_PRICE,
    cardsIncluded: PRIORITY_MAIL_MIN_CARDS,
    additionalCardPrice: 0,
    freeShippingThreshold: FREE_PRIORITY_MAIL_THRESHOLD,
    deliveryEstimate: "1–3 business days",
  },
} as const;

const SHIPPING_METHODS: ShippingMethod[] = [
  "STANDARD_ENVELOPE",
  "GROUND_ADVANTAGE",
  "PRIORITY_MAIL",
];

const shippingMethodRank: Record<ShippingMethod, number> = {
  STANDARD_ENVELOPE: 0,
  GROUND_ADVANTAGE: 1,
  PRIORITY_MAIL: 2,
};

export function isShippingMethod(value: unknown): value is ShippingMethod {
  return SHIPPING_METHODS.includes(value as ShippingMethod);
}

export function estimateStandardEnvelopeOunces({
  itemCount,
}: {
  itemCount: number;
}) {
  return Math.max(
    1,
    Math.ceil(itemCount * STANDARD_ENVELOPE_ESTIMATED_OUNCES_PER_CARD),
  );
}

export function standardEnvelopeRateForEstimatedOunces({
  estimatedOunces,
  now = new Date(),
}: {
  estimatedOunces: number;
  now?: Date;
}) {
  const ounces = Math.min(
    Math.max(1, Math.ceil(estimatedOunces)),
    STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES,
  );
  const rates =
    now.getTime() >= STANDARD_ENVELOPE_RATE_CHANGE_UTC
      ? STANDARD_ENVELOPE_RATES_FROM_JULY_12_2026
      : STANDARD_ENVELOPE_RATES_BEFORE_JULY_12_2026;

  return rates[ounces - 1];
}

export function getStandardEnvelopeEligibility({
  itemCount,
  subtotal,
  listingPriceBasis = subtotal,
}: {
  itemCount: number;
  subtotal: number;
  listingPriceBasis?: number;
}) {
  const estimatedOunces = estimateStandardEnvelopeOunces({ itemCount });
  const normalizedListingPriceBasis = Math.max(
    0,
    Math.round(Number(listingPriceBasis || 0) * 100) / 100,
  );

  if (itemCount <= 0 || itemCount > STANDARD_ENVELOPE_MAX_CARDS) {
    return {
      eligible: false,
      estimatedOunces,
      listingPriceBasis: normalizedListingPriceBasis,
      reason: `Tracked Card Letter is limited to ${STANDARD_ENVELOPE_MAX_CARDS} cards per order.`,
    };
  }

  if (normalizedListingPriceBasis > STANDARD_ENVELOPE_MAX_SUBTOTAL) {
    return {
      eligible: false,
      estimatedOunces,
      listingPriceBasis: normalizedListingPriceBasis,
      reason: `Tracked Card Letter requires an original listing-price total of $${STANDARD_ENVELOPE_MAX_SUBTOTAL.toFixed(2)} or less. Accepted offers do not lower this shipping tier.`,
    };
  }

  if (estimatedOunces > STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES) {
    return {
      eligible: false,
      estimatedOunces,
      listingPriceBasis: normalizedListingPriceBasis,
      reason: `Tracked Card Letter is limited to ${STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES} estimated oz.`,
    };
  }

  return {
    eligible: true,
    estimatedOunces,
    listingPriceBasis: normalizedListingPriceBasis,
    reason: null,
  };
}

export function getMinimumShippingMethod({
  itemCount,
  subtotal,
  listingPriceBasis = subtotal,
}: {
  itemCount: number;
  subtotal: number;
  listingPriceBasis?: number;
}): ShippingMethod {
  if (
    Number(subtotal || 0) > FREE_PRIORITY_MAIL_THRESHOLD ||
    itemCount >= PRIORITY_MAIL_MIN_CARDS
  ) {
    return "PRIORITY_MAIL";
  }

  return getStandardEnvelopeEligibility({
    itemCount,
    subtotal,
    listingPriceBasis,
  }).eligible
    ? "STANDARD_ENVELOPE"
    : "GROUND_ADVANTAGE";
}

export function getAvailableShippingMethods({
  itemCount,
  subtotal,
  listingPriceBasis = subtotal,
}: {
  itemCount: number;
  subtotal: number;
  listingPriceBasis?: number;
}): ShippingMethod[] {
  const minimumMethod = getMinimumShippingMethod({
    itemCount,
    subtotal,
    listingPriceBasis,
  });
  const minimumRank = shippingMethodRank[minimumMethod];

  return SHIPPING_METHODS.filter(
    (method) => shippingMethodRank[method] >= minimumRank,
  );
}

export function resolveShippingMethod({
  requestedMethod,
  itemCount,
  subtotal,
  listingPriceBasis = subtotal,
}: {
  requestedMethod: ShippingMethod;
  itemCount: number;
  subtotal: number;
  listingPriceBasis?: number;
}) {
  const standardEnvelope = getStandardEnvelopeEligibility({
    itemCount,
    subtotal,
    listingPriceBasis,
  });
  const minimumMethod = getMinimumShippingMethod({
    itemCount,
    subtotal,
    listingPriceBasis,
  });
  const method =
    shippingMethodRank[requestedMethod] < shippingMethodRank[minimumMethod]
      ? minimumMethod
      : requestedMethod;

  let reason: string | null = null;

  if (method !== requestedMethod) {
    if (minimumMethod === "PRIORITY_MAIL") {
      reason =
        Number(subtotal || 0) > FREE_PRIORITY_MAIL_THRESHOLD
          ? `Orders over $${FREE_PRIORITY_MAIL_THRESHOLD.toFixed(2)} ship by Priority Mail for free.`
          : `${PRIORITY_MAIL_MIN_CARDS} or more cards require Priority Mail.`;
    } else {
      reason = standardEnvelope.reason;
    }
  }

  return {
    method,
    requestedMethod,
    minimumMethod,
    standardEnvelope,
    reason,
  };
}

export function calculateShipping({
  itemCount,
  subtotal,
  method,
  listingPriceBasis = subtotal,
}: {
  itemCount: number;
  subtotal: number;
  method: ShippingMethod;
  listingPriceBasis?: number;
}) {
  const resolved = resolveShippingMethod({
    requestedMethod: method,
    itemCount,
    subtotal,
    listingPriceBasis,
  });

  if (resolved.method === "PRIORITY_MAIL") {
    return Number(subtotal || 0) > FREE_PRIORITY_MAIL_THRESHOLD
      ? 0
      : PRIORITY_MAIL_BUYER_PRICE;
  }

  if (resolved.method === "STANDARD_ENVELOPE") {
    return STANDARD_ENVELOPE_BUYER_PRICE;
  }

  if (
    itemCount >= GROUND_ADVANTAGE_TEN_OUNCE_MIN_CARDS &&
    itemCount <= GROUND_ADVANTAGE_TEN_OUNCE_MAX_CARDS
  ) {
    return GROUND_ADVANTAGE_TEN_OUNCE_PRICE;
  }

  const extraCards = Math.max(
    Math.min(itemCount, 12) - SHIPPING_RULES.GROUND_ADVANTAGE.cardsIncluded,
    0,
  );

  return (
    SHIPPING_RULES.GROUND_ADVANTAGE.basePrice +
    extraCards * SHIPPING_RULES.GROUND_ADVANTAGE.additionalCardPrice
  );
}

export function getShippingCoverage({
  method,
  subtotal,
}: {
  method: ShippingMethod;
  subtotal: number;
}) {
  const coverageAmount = Math.max(0, Math.round(Number(subtotal || 0) * 100) / 100);
  const isStandardEnvelope = method === "STANDARD_ENVELOPE";

  return {
    provider: isStandardEnvelope
      ? STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER
      : SHIPPING_COVERAGE_PROVIDER,
    required: true,
    sellerProtected: true,
    buyerCharge: 0,
    coveredAmount: coverageAmount,
    status: "required_at_label_purchase",
    coverageType: isStandardEnvelope
      ? "tracked_card_letter_delivery_evidence"
      : "full_shipment_coverage",
    detail: isStandardEnvelope
      ? "Eligible Truely Collectables card-letter shipments use LetterTrack / USPS Intelligent Mail barcode scan visibility when available. This is limited letter visibility, not guaranteed package tracking or proof of delivery."
      : "Included seller protection for tracked parcel shipments, subject to Coverage provider terms and carrier tracking evidence.",
  };
}

export function getUnder20SellerProtection({
  method,
  subtotal,
  sellerOptedIn = false,
}: {
  method: ShippingMethod;
  subtotal: number;
  sellerOptedIn?: boolean;
}) {
  const saleAmount = Math.max(
    0,
    Math.round(Number(subtotal || 0) * 100) / 100,
  );
  const eligible =
    sellerOptedIn &&
    method === "STANDARD_ENVELOPE" &&
    saleAmount > 0 &&
    saleAmount <= UNDER_20_SELLER_PROTECTION_MAX_COVERAGE;
  const feeAmount = eligible
    ? Math.round(saleAmount * UNDER_20_SELLER_PROTECTION_RATE * 100) / 100
    : 0;

  return {
    provider: UNDER_20_SELLER_PROTECTION_PROVIDER,
    eligible,
    sellerOptedIn,
    rate: UNDER_20_SELLER_PROTECTION_RATE,
    saleAmount,
    feeAmount,
    maxCoverage: UNDER_20_SELLER_PROTECTION_MAX_COVERAGE,
    coveredAmount: eligible
      ? Math.min(saleAmount, UNDER_20_SELLER_PROTECTION_MAX_COVERAGE)
      : 0,
    coverageBasis: "item_sale_amount_excluding_shipping",
    reimbursesShipping: false,
    claimTrigger:
      "Eligible only when the Tracked Card Letter delivery-evidence lane does not show delivered status under Truely Collectables claim rules. Seller reimbursement is limited to the protected item sale amount up to $20 and excludes shipping.",
    sellerRefundRule:
      "If the buyer must be refunded for a protected under-$20 Tracked Card Letter shipment, Truely Collectables seller protection reimburses the seller for the item sale amount up to $20 after the seller/buyer refund is processed; shipping is not reimbursed.",
    legalLabel: "seller_protection_not_insurance",
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getUnder20SellerProtectionOptIn(metadata: unknown) {
  const root = metadataRecord(metadata);
  const shipping = metadataRecord(root.shipping);

  return shipping[UNDER_20_SELLER_PROTECTION_METADATA_KEY] === true;
}

export function mergeUnder20SellerProtectionOptIn(
  metadata: unknown,
  optedIn: boolean,
) {
  const root = { ...metadataRecord(metadata) };
  const shipping = { ...metadataRecord(root.shipping) };

  shipping[UNDER_20_SELLER_PROTECTION_METADATA_KEY] = optedIn;
  root.shipping = shipping;

  return root;
}

export function getFreeShippingMessage({
  subtotal,
  method,
}: {
  subtotal: number;
  method: ShippingMethod;
}) {
  if (method === "STANDARD_ENVELOPE") {
    return `Tracked Card Letter is $${STANDARD_ENVELOPE_BUYER_PRICE.toFixed(2)} for up to ${STANDARD_ENVELOPE_MAX_CARDS} qualifying cards with an original listing-price total of $${STANDARD_ENVELOPE_MAX_SUBTOTAL.toFixed(2)} or less and a maximum estimated weight of ${STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES} oz.`;
  }

  if (Number(subtotal || 0) > FREE_PRIORITY_MAIL_THRESHOLD) {
    return `You unlocked FREE Priority Mail shipping for an order over $${FREE_PRIORITY_MAIL_THRESHOLD.toFixed(2)}.`;
  }

  if (method === "PRIORITY_MAIL") {
    return `Priority Mail is $${PRIORITY_MAIL_BUYER_PRICE.toFixed(2)}. Orders over $${FREE_PRIORITY_MAIL_THRESHOLD.toFixed(2)} ship Priority Mail free.`;
  }

  return `Ground Advantage starts at $${SHIPPING_RULES.GROUND_ADVANTAGE.basePrice.toFixed(2)}. You may upgrade to Priority Mail for $${PRIORITY_MAIL_BUYER_PRICE.toFixed(2)}. Orders over $${FREE_PRIORITY_MAIL_THRESHOLD.toFixed(2)} ship Priority Mail free.`;
}
