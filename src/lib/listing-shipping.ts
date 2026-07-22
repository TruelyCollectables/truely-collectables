import {
  calculateShipping,
  getStandardEnvelopeEligibility,
  SHIPPING_RULES,
} from "./shipping";

export type ListingShippingSummary = {
  amount: number;
  label: string;
  method: "STANDARD_ENVELOPE" | "GROUND_ADVANTAGE";
};

export function listingShippingSummary(
  subtotalValue: number,
): ListingShippingSummary {
  const subtotal = Math.max(0, Number(subtotalValue || 0));
  const groundFreeThreshold =
    SHIPPING_RULES.GROUND_ADVANTAGE.freeShippingThreshold;

  if (groundFreeThreshold !== null && subtotal >= groundFreeThreshold) {
    return {
      amount: 0,
      label: "FREE Ground shipping",
      method: "GROUND_ADVANTAGE",
    };
  }

  const standardEnvelope = getStandardEnvelopeEligibility({
    itemCount: 1,
    subtotal,
  });
  const method = standardEnvelope.eligible
    ? ("STANDARD_ENVELOPE" as const)
    : ("GROUND_ADVANTAGE" as const);
  const amount = calculateShipping({ itemCount: 1, subtotal, method });

  return {
    amount,
    label: `Shipping from $${amount.toFixed(2)}`,
    method,
  };
}
