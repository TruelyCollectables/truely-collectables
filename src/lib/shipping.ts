export type ShippingMethod = "GROUND_ADVANTAGE" | "PRIORITY_MAIL";

export const SHIPPING_RULES = {
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

  if (subtotal >= rule.freeShippingThreshold) {
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

  if (subtotal >= rule.freeShippingThreshold) {
    return `✅ You unlocked FREE ${rule.shortName} shipping!`;
  }

  const amountAway = rule.freeShippingThreshold - subtotal;

  return `🎯 Add $${amountAway.toFixed(2)} more for FREE ${rule.shortName} shipping.`;
}