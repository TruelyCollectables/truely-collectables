export type ShippingMethod =
  | "STANDARD_ENVELOPE"
  | "GROUND_ADVANTAGE"
  | "PRIORITY_MAIL";

export const STANDARD_ENVELOPE_MAX_SUBTOTAL = 20;
export const STANDARD_ENVELOPE_MAX_ESTIMATED_OUNCES = 3;
export const STANDARD_ENVELOPE_ESTIMATED_OUNCES_PER_CARD = 1;
export const SHIPPING_COVERAGE_PROVIDER = "Coverage";
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
    deliveryEstimate: "Letter-mail visibility; timing varies by USPS sorting scans",
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
    provider: SHIPPING_COVERAGE_PROVIDER,
    required: true,
    sellerProtected: true,
    buyerCharge: 0,
    coveredAmount: coverageAmount,
    status: "required_at_label_purchase",
    coverageType: isStandardEnvelope
      ? "low_value_standard_envelope"
      : "full_shipment_coverage",
    detail: isStandardEnvelope
      ? "Included seller protection for eligible raw-card Standard Envelope shipments, subject to Coverage provider terms and mail-visibility evidence."
      : "Included seller protection for tracked parcel shipments, subject to Coverage provider terms and carrier tracking evidence.",
  };
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
    return "Standard Envelope is available for raw card orders up to $20 and 3 estimated oz.";
  }

  if (rule.freeShippingThreshold !== null && subtotal >= rule.freeShippingThreshold) {
    return `✅ You unlocked FREE ${rule.shortName} shipping!`;
  }

  const amountAway = Number(rule.freeShippingThreshold) - subtotal;

  return `🎯 Add $${amountAway.toFixed(2)} more for FREE ${rule.shortName} shipping.`;
}
