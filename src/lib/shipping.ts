export type ShippingMethod =
  | "STANDARD_ENVELOPE"
  | "GROUND_ADVANTAGE"
  | "PRIORITY_MAIL";

export const STANDARD_ENVELOPE_MAX_SUBTOTAL = 20;
export const STANDARD_ENVELOPE_MAX_CARDS = 4;
export const STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES = 3;
export const STANDARD_ENVELOPE_ESTIMATED_OUNCES_PER_CARD = 0.75;
export const STANDARD_ENVELOPE_BUYER_PRICE = 1.99;

export const GROUND_ADVANTAGE_BUYER_PRICE = 4.99;
export const FREE_GROUND_ADVANTAGE_THRESHOLD = 250;
export const PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS = 4;
export const PRIORITY_MAIL_SMALL_ORDER_PRICE = 9.99;
export const PRIORITY_MAIL_LARGE_ORDER_PRICE = 14.99;
export const PARCEL_INCLUDED_COVERAGE_LIMIT = 100;
export const PARCEL_TRUELY_PAID_INSURANCE_MAX = 1000;
export const PARCEL_CUSTOMER_PAID_INSURANCE_THRESHOLD = 1000;
export const USPS_STANDARD_INSURANCE_MAX = 5000;

// Backward-compatible exports retained for older imports. Ground Advantage is now
// a flat buyer price and Priority Mail is an optional upgrade rather than a
// mandatory card-count tier.
export const GROUND_ADVANTAGE_TEN_OUNCE_MIN_CARDS = 13;
export const GROUND_ADVANTAGE_TEN_OUNCE_MAX_CARDS = 19;
export const GROUND_ADVANTAGE_TEN_OUNCE_PRICE = GROUND_ADVANTAGE_BUYER_PRICE;
export const PRIORITY_MAIL_MIN_CARDS = 1;
export const PRIORITY_MAIL_BUYER_PRICE = PRIORITY_MAIL_LARGE_ORDER_PRICE;
export const FREE_PRIORITY_MAIL_THRESHOLD = Number.MAX_SAFE_INTEGER;

export const SHIPPING_COVERAGE_PROVIDER = "Included carrier coverage";
export const STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER =
  "LetterTrack / USPS IMb";
export const STANDARD_ENVELOPE_POSTAGE_BASIS =
  "USPS retail stamped single-piece letter";
export const UNDER_20_SELLER_PROTECTION_PROVIDER =
  "Truely Collectables Under-$20 Seller Protection";
export const UNDER_20_SELLER_PROTECTION_RATE = 0.02;
export const UNDER_20_SELLER_PROTECTION_MAX_COVERAGE = 20;
export const UNDER_20_SELLER_PROTECTION_METADATA_KEY =
  "under20SellerProtectionOptIn";

const STANDARD_ENVELOPE_RATE_CHANGE_UTC = Date.UTC(2026, 6, 12, 0, 0, 0);
const STANDARD_ENVELOPE_RATES_BEFORE_JULY_12_2026 = [0.78, 1.07, 1.36];
const STANDARD_ENVELOPE_RATES_FROM_JULY_12_2026 = [0.82, 1.11, 1.4];

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
    basePrice: GROUND_ADVANTAGE_BUYER_PRICE,
    cardsIncluded: Number.MAX_SAFE_INTEGER,
    additionalCardPrice: 0,
    freeShippingThreshold: FREE_GROUND_ADVANTAGE_THRESHOLD,
    deliveryEstimate: "2–5 business days",
  },
  PRIORITY_MAIL: {
    name: "USPS Priority Mail",
    shortName: "Priority Mail",
    basePrice: PRIORITY_MAIL_SMALL_ORDER_PRICE,
    cardsIncluded: PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS,
    additionalCardPrice: 0,
    freeShippingThreshold: null,
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

  const reason = method !== requestedMethod ? standardEnvelope.reason : null;

  return {
    method,
    requestedMethod,
    minimumMethod,
    standardEnvelope,
    reason,
  };
}

export function priorityMailBuyerPrice(itemCount: number) {
  return itemCount <= PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS
    ? PRIORITY_MAIL_SMALL_ORDER_PRICE
    : PRIORITY_MAIL_LARGE_ORDER_PRICE;
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

  if (resolved.method === "STANDARD_ENVELOPE") {
    return STANDARD_ENVELOPE_BUYER_PRICE;
  }

  if (resolved.method === "PRIORITY_MAIL") {
    return priorityMailBuyerPrice(itemCount);
  }

  return Number(subtotal || 0) > FREE_GROUND_ADVANTAGE_THRESHOLD
    ? 0
    : GROUND_ADVANTAGE_BUYER_PRICE;
}

export function calculateUspsMerchandiseInsuranceFee(declaredValue: number) {
  const value = Math.max(0, Math.round(Number(declaredValue || 0) * 100) / 100);
  if (value <= PARCEL_INCLUDED_COVERAGE_LIMIT) return 0;
  if (value <= 200) return 4.5;
  if (value <= 300) return 4.55;
  if (value <= 400) return 6.05;
  if (value <= 500) return 7.55;
  if (value <= 600) return 9.05;
  if (value <= USPS_STANDARD_INSURANCE_MAX) {
    return Math.round((9.05 + Math.ceil((value - 600) / 100) * 1.5) * 100) / 100;
  }
  return null;
}

export function getShippingCoverage({
  method,
  subtotal,
}: {
  method: ShippingMethod;
  subtotal: number;
}) {
  const orderValue = Math.max(
    0,
    Math.round(Number(subtotal || 0) * 100) / 100,
  );
  const isStandardEnvelope = method === "STANDARD_ENVELOPE";
  const includedCoveredAmount = isStandardEnvelope
    ? 0
    : Math.min(orderValue, PARCEL_INCLUDED_COVERAGE_LIMIT);
  const additionalCoverageRequired =
    !isStandardEnvelope && orderValue > PARCEL_INCLUDED_COVERAGE_LIMIT;
  const customerPaysAdditionalCoverage =
    additionalCoverageRequired &&
    orderValue > PARCEL_CUSTOMER_PAID_INSURANCE_THRESHOLD;
  const truelyPaysAdditionalCoverage =
    additionalCoverageRequired && !customerPaysAdditionalCoverage;
  const insuranceFee = customerPaysAdditionalCoverage
    ? calculateUspsMerchandiseInsuranceFee(orderValue)
    : 0;
  const requiresManualHighValueCoverage =
    !isStandardEnvelope && orderValue > USPS_STANDARD_INSURANCE_MAX;
  const buyerCharge = typeof insuranceFee === "number" ? insuranceFee : 0;

  return {
    provider: isStandardEnvelope
      ? STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER
      : SHIPPING_COVERAGE_PROVIDER,
    required: true,
    sellerProtected: !isStandardEnvelope,
    buyerCharge,
    coveredAmount: includedCoveredAmount,
    includedCoverageLimit: isStandardEnvelope
      ? 0
      : PARCEL_INCLUDED_COVERAGE_LIMIT,
    uncoveredAmount: isStandardEnvelope
      ? orderValue
      : Math.max(0, Math.round((orderValue - includedCoveredAmount) * 100) / 100),
    requiresAdditionalCoverageQuote: additionalCoverageRequired,
    additionalCoverageRequired,
    fullValueCoverageRequired: additionalCoverageRequired,
    fullValueCoverageAmount: additionalCoverageRequired ? orderValue : includedCoveredAmount,
    additionalCoverageMustBeArrangedBeforeShipment: additionalCoverageRequired,
    additionalCoveragePayer: isStandardEnvelope
      ? "not_applicable"
      : customerPaysAdditionalCoverage
        ? "customer"
        : truelyPaysAdditionalCoverage
          ? "truely_collectables"
          : "included",
    customerPaysAdditionalCoverage,
    truelyPaysAdditionalCoverage,
    requiresManualHighValueCoverage,
    standardInsuranceMaximum: USPS_STANDARD_INSURANCE_MAX,
    insuranceFeeSource:
      customerPaysAdditionalCoverage && !requiresManualHighValueCoverage
        ? "USPS Notice 123 effective 2026-07-12"
        : null,
    status: isStandardEnvelope
      ? "delivery_evidence_only"
      : requiresManualHighValueCoverage
        ? "manual_high_value_coverage_required"
        : customerPaysAdditionalCoverage
          ? "mandatory_customer_paid_full_value_insurance"
          : truelyPaysAdditionalCoverage
            ? "mandatory_truely_paid_full_value_insurance"
            : "included_coverage",
    coverageType: isStandardEnvelope
      ? "tracked_card_letter_delivery_evidence"
      : additionalCoverageRequired
        ? "carrier_full_value_insurance_required"
        : "carrier_included_up_to_100",
    detail: isStandardEnvelope
      ? "Eligible Truely Collectables card-letter shipments use LetterTrack / USPS Intelligent Mail barcode scan visibility when available. This is limited letter visibility, not guaranteed package tracking or insurance. Optional Truely Collectables Shipment Protection is available on qualifying orders of $20 or less."
      : requiresManualHighValueCoverage
        ? `This $${orderValue.toFixed(2)} order exceeds the standard USPS $${USPS_STANDARD_INSURANCE_MAX.toFixed(2)} merchandise-insurance maximum and requires a manual full-value shipping and insurance arrangement before fulfillment.`
        : customerPaysAdditionalCoverage
          ? `Ground Advantage includes the first $${PARCEL_INCLUDED_COVERAGE_LIMIT.toFixed(2)} of carrier coverage. Because this order is over $${PARCEL_CUSTOMER_PAID_INSURANCE_THRESHOLD.toFixed(2)}, full-value insurance is mandatory and the customer pays the $${buyerCharge.toFixed(2)} insurance fee.`
          : truelyPaysAdditionalCoverage
            ? `Ground Advantage includes the first $${PARCEL_INCLUDED_COVERAGE_LIMIT.toFixed(2)} of carrier coverage. Truely Collectables will purchase additional carrier insurance to cover the full $${orderValue.toFixed(2)} order value at no additional charge to the customer.`
            : `Ground Advantage and Priority Mail include carrier coverage up to $${PARCEL_INCLUDED_COVERAGE_LIMIT.toFixed(2)}, subject to carrier terms and claim approval.`,
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

  if (method === "GROUND_ADVANTAGE" && Number(subtotal || 0) > FREE_GROUND_ADVANTAGE_THRESHOLD) {
    return `You unlocked FREE Ground Advantage shipping for an order over $${FREE_GROUND_ADVANTAGE_THRESHOLD.toFixed(2)}. Priority Mail remains available as a paid upgrade.`;
  }

  if (method === "PRIORITY_MAIL") {
    return `Priority Mail is an optional upgrade: $${PRIORITY_MAIL_SMALL_ORDER_PRICE.toFixed(2)} for 1–${PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS} cards or $${PRIORITY_MAIL_LARGE_ORDER_PRICE.toFixed(2)} for ${PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS + 1}+ cards. Orders over $${FREE_GROUND_ADVANTAGE_THRESHOLD.toFixed(2)} qualify for free Ground Advantage instead.`;
  }

  return `Ground Advantage is $${GROUND_ADVANTAGE_BUYER_PRICE.toFixed(2)}. Priority Mail is available as a $${PRIORITY_MAIL_SMALL_ORDER_PRICE.toFixed(2)} upgrade for 1–${PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS} cards or $${PRIORITY_MAIL_LARGE_ORDER_PRICE.toFixed(2)} for ${PRIORITY_MAIL_SMALL_ORDER_MAX_CARDS + 1}+ cards. Orders over $${FREE_GROUND_ADVANTAGE_THRESHOLD.toFixed(2)} ship Ground Advantage free.`;
}
