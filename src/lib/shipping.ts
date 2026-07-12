export type ShippingMethod =
  | "STANDARD_ENVELOPE"
  | "GROUND_ADVANTAGE"
  | "PRIORITY_MAIL";

export const STANDARD_ENVELOPE_MAX_SUBTOTAL = 20;
export const STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES = 3;
export const STANDARD_ENVELOPE_ESTIMATED_OUNCES_PER_CARD = 1;
export const SHIPPING_COVERAGE_PROVIDER = "Coverage";
export const STANDARD_ENVELOPE_DELIVERY_EVIDENCE_PROVIDER =
  "LetterTrack / USPS IMb";
export const UNDER_20_SELLER_PROTECTION_PROVIDER =
  "TCOS Under-$20 Seller Protection";
export const UNDER_20_SELLER_PROTECTION_RATE = 0.02;
export const UNDER_20_SELLER_PROTECTION_MAX_COVERAGE = 20;
export const UNDER_20_SELLER_PROTECTION_METADATA_KEY =
  "under20SellerProtectionOptIn";
const STANDARD_ENVELOPE_RATE_CHANGE_UTC = Date.UTC(2026, 6, 12, 7, 0, 0);
const STANDARD_ENVELOPE_RATES_BEFORE_JULY_12_2026 = [0.74, 1.03, 1.32];
const STANDARD_ENVELOPE_RATES_FROM_JULY_12_2026 = [0.78, 1.07, 1.36];

export const SHIPPING_RULES = {
  STANDARD_ENVELOPE: {
    name: "TCOS Standard Envelope",
    shortName: "Standard Envelope",
    basePrice: 0,
    cardsIncluded: 0,
    additionalCardPrice: 0,
    freeShippingThreshold: null,
    deliveryEstimate:
      "Letter-mail visibility with Out for Delivery / Delivered in Mailbox evidence when USPS scan data is available",
  },

  GROUND_ADVANTAGE: {
    name: "USPS Ground Advantage",
    shortName: "Ground Advantage",
    basePrice: 6.99,
    cardsIncluded: 5,
    additionalCardPrice: 0.25,
    freeShippingThreshold: 149,
    deliveryEstimate: "2–5 business days",
  },

  PRIORITY_MAIL: {
    name: "USPS Priority Mail",
    shortName: "Priority Mail",
    basePrice: 12.99,
    cardsIncluded: 5,
    additionalCardPrice: 0.25,
    freeShippingThreshold: 500,
    deliveryEstimate: "1–3 business days",
  },
} as const;

export function isShippingMethod(value: unknown): value is ShippingMethod {
  return (
    value === "STANDARD_ENVELOPE" ||
    value === "GROUND_ADVANTAGE" ||
    value === "PRIORITY_MAIL"
  );
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
}: {
  itemCount: number;
  subtotal: number;
}) {
  const estimatedOunces = estimateStandardEnvelopeOunces({ itemCount });

  if (subtotal > STANDARD_ENVELOPE_MAX_SUBTOTAL) {
    return {
      eligible: false,
      estimatedOunces,
      reason: `Standard Envelope is only available for card orders up to $${STANDARD_ENVELOPE_MAX_SUBTOTAL.toFixed(2)}.`,
    };
  }

  if (estimatedOunces > STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES) {
    return {
      eligible: false,
      estimatedOunces,
      reason: `Standard Envelope is only available up to ${STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES} estimated oz.`,
    };
  }

  return {
    eligible: true,
    estimatedOunces,
    reason: null,
  };
}

export function resolveShippingMethod({
  requestedMethod,
  itemCount,
  subtotal,
}: {
  requestedMethod: ShippingMethod;
  itemCount: number;
  subtotal: number;
}) {
  const standardEnvelope = getStandardEnvelopeEligibility({
    itemCount,
    subtotal,
  });

  if (requestedMethod === "STANDARD_ENVELOPE" && !standardEnvelope.eligible) {
    return {
      method: "GROUND_ADVANTAGE" as const,
      requestedMethod,
      standardEnvelope,
      reason: standardEnvelope.reason,
    };
  }

  return {
    method: requestedMethod,
    requestedMethod,
    standardEnvelope,
    reason: null,
  };
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
      ? "standard_envelope_delivery_evidence"
      : "full_shipment_coverage",
    detail: isStandardEnvelope
      ? "Delivery evidence is required for eligible raw-card Standard Envelope shipments. TCOS expects USPS IMb scan history with Out for Delivery / Delivered in Mailbox status when USPS data is available. Seller protection applies only when the seller opted into TCOS Under-$20 Seller Protection for the shipment."
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
      "Eligible only when the Standard Envelope delivery-evidence lane does not show delivered status under TCOS claim rules. Seller reimbursement is limited to the protected item sale amount up to $20 and excludes shipping.",
    sellerRefundRule:
      "If the buyer must be refunded for a protected under-$20 Standard Envelope shipment, TCOS seller protection reimburses the seller for the item sale amount up to $20 after the seller/buyer refund is processed; shipping is not reimbursed.",
    legalLabel:
      "seller_protection_not_insurance",
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

export function calculateShipping({
  itemCount,
  subtotal,
  method,
}: {
  itemCount: number;
  subtotal: number;
  method: ShippingMethod;
}) {
  const rule = SHIPPING_RULES[method];

  if (method === "STANDARD_ENVELOPE") {
    const estimatedOunces = estimateStandardEnvelopeOunces({ itemCount });

    return standardEnvelopeRateForEstimatedOunces({ estimatedOunces });
  }

  if (rule.freeShippingThreshold !== null && subtotal >= rule.freeShippingThreshold) {
    return 0;
  }

  const extraCards = Math.max(itemCount - rule.cardsIncluded, 0);

  return rule.basePrice + extraCards * rule.additionalCardPrice;
}

export function getFreeShippingMessage({
  subtotal,
  method,
}: {
  subtotal: number;
  method: ShippingMethod;
}) {
  const rule = SHIPPING_RULES[method];

  if (method === "STANDARD_ENVELOPE") {
    return "Trackable Standard Envelope is available for raw card orders up to $20 and 3 estimated oz.";
  }

  if (rule.freeShippingThreshold !== null && subtotal >= rule.freeShippingThreshold) {
    return `✅ You unlocked FREE ${rule.shortName} shipping!`;
  }

  const amountAway = Number(rule.freeShippingThreshold) - subtotal;

  return `🎯 Add $${amountAway.toFixed(2)} more for FREE ${rule.shortName} shipping.`;
}
