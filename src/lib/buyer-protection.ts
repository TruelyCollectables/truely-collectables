export const BUYER_PROTECTION_POLICY_VERSION =
  "truely-shipment-protection-v2-2026-07-30";
export const BUYER_PROTECTION_PATH = "/buyer-protection";
export const BUYER_PROTECTION_RATE = 0.1;
// Backward-compatible alias for older imports. New code must calculate the fee
// from the pre-protection order total with calculateBuyerProtectionFee().
export const BUYER_PROTECTION_FEE = BUYER_PROTECTION_RATE;
export const BUYER_PROTECTION_MAX_ITEM_SUBTOTAL = 20;
export const BUYER_PROTECTION_MAX_COVERAGE = 25;
export const BUYER_PROTECTION_MIN_CLAIM_DAYS = 7;
export const BUYER_PROTECTION_CLAIM_DEADLINE_DAYS = 21;

export const BUYER_PROTECTION_DECLINE_ACKNOWLEDGMENT =
  "I decline optional Shipment Protection for this order. I understand Truely Collectables will not provide its voluntary shipment-protection reimbursement for qualifying carrier loss or damage. This acknowledgment does not waive rights that cannot legally be waived or any rights available through my payment provider.";

export type BuyerProtectionPreferenceMode =
  | "always_on"
  | "always_off"
  | "one_time";

export type BuyerProtectionEligibility = {
  eligible: boolean;
  coveredAmount: number;
  reason: string | null;
};

export type BuyerProtectionQuote = BuyerProtectionEligibility & {
  rate: number;
  feeBase: number;
  feeAmount: number;
  itemSubtotal: number;
  shippingAmount: number;
};

export function money(value: unknown) {
  const number = Number(value || 0);
  return Math.max(0, Math.round(number * 100) / 100);
}

export function isBuyerProtectionPreferenceMode(
  value: unknown,
): value is BuyerProtectionPreferenceMode {
  return ["always_on", "always_off", "one_time"].includes(String(value));
}

export function calculateBuyerProtectionFee(params: {
  itemSubtotal: number;
  shippingAmount: number;
}) {
  const feeBase = money(
    money(params.itemSubtotal) + money(params.shippingAmount),
  );
  return money(feeBase * BUYER_PROTECTION_RATE);
}

export function getBuyerProtectionQuote(params: {
  shippingMethod: string | null | undefined;
  itemSubtotal: number;
  itemCount: number;
  shippingAmount: number;
}): BuyerProtectionQuote {
  const itemSubtotal = money(params.itemSubtotal);
  const shippingAmount = money(params.shippingAmount);
  const feeBase = money(itemSubtotal + shippingAmount);
  const feeAmount = calculateBuyerProtectionFee({
    itemSubtotal,
    shippingAmount,
  });

  if (params.shippingMethod !== "STANDARD_ENVELOPE") {
    return {
      eligible: false,
      coveredAmount: 0,
      reason:
        "Shipment Protection is available only with the Tracked Card Letter shipping method.",
      rate: BUYER_PROTECTION_RATE,
      feeBase,
      feeAmount: 0,
      itemSubtotal,
      shippingAmount,
    };
  }

  if (params.itemCount < 1 || params.itemCount > 4) {
    return {
      eligible: false,
      coveredAmount: 0,
      reason:
        "Shipment Protection is limited to qualifying orders of one to four cards.",
      rate: BUYER_PROTECTION_RATE,
      feeBase,
      feeAmount: 0,
      itemSubtotal,
      shippingAmount,
    };
  }

  if (
    itemSubtotal <= 0 ||
    itemSubtotal > BUYER_PROTECTION_MAX_ITEM_SUBTOTAL
  ) {
    return {
      eligible: false,
      coveredAmount: 0,
      reason: `Shipment Protection is limited to item subtotals of $${BUYER_PROTECTION_MAX_ITEM_SUBTOTAL.toFixed(2)} or less.`,
      rate: BUYER_PROTECTION_RATE,
      feeBase,
      feeAmount: 0,
      itemSubtotal,
      shippingAmount,
    };
  }

  return {
    eligible: true,
    coveredAmount: Math.min(feeBase, BUYER_PROTECTION_MAX_COVERAGE),
    reason: null,
    rate: BUYER_PROTECTION_RATE,
    feeBase,
    feeAmount,
    itemSubtotal,
    shippingAmount,
  };
}

export function getBuyerProtectionEligibility(params: {
  shippingMethod: string | null | undefined;
  itemSubtotal: number;
  itemCount: number;
}): BuyerProtectionEligibility {
  const quote = getBuyerProtectionQuote({
    ...params,
    shippingAmount: 0,
  });

  return {
    eligible: quote.eligible,
    coveredAmount: quote.eligible ? money(params.itemSubtotal) : 0,
    reason: quote.reason,
  };
}

export function buyerProtectionClaimWindow(shippedAt: string | Date) {
  const shipmentDate = new Date(shippedAt);
  if (Number.isNaN(shipmentDate.getTime())) {
    throw new Error("A valid shipment timestamp is required.");
  }

  const earliestClaimAt = new Date(
    shipmentDate.getTime() +
      BUYER_PROTECTION_MIN_CLAIM_DAYS * 24 * 60 * 60 * 1000,
  );
  const claimDeadlineAt = new Date(
    shipmentDate.getTime() +
      BUYER_PROTECTION_CLAIM_DEADLINE_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    shippedAt: shipmentDate.toISOString(),
    earliestClaimAt: earliestClaimAt.toISOString(),
    claimDeadlineAt: claimDeadlineAt.toISOString(),
  };
}

export function evaluateBuyerProtectionClaimWindow(params: {
  shippedAt?: string | null;
  earliestClaimAt?: string | null;
  claimDeadlineAt?: string | null;
  now?: Date;
}) {
  if (!params.shippedAt) {
    return {
      eligible: false,
      status: "not_shipped" as const,
      detail:
        "The protection claim clock has not started because the order is not shipped.",
    };
  }

  const fallback = buyerProtectionClaimWindow(params.shippedAt);
  const earliest = new Date(params.earliestClaimAt || fallback.earliestClaimAt);
  const deadline = new Date(params.claimDeadlineAt || fallback.claimDeadlineAt);
  const now = params.now || new Date();

  if (now.getTime() < earliest.getTime()) {
    return {
      eligible: false,
      status: "too_early" as const,
      detail: `A loss or damage claim may be submitted only after ${BUYER_PROTECTION_MIN_CLAIM_DAYS} full days have passed from shipment.`,
    };
  }

  if (now.getTime() > deadline.getTime()) {
    return {
      eligible: false,
      status: "expired" as const,
      detail: `The claim deadline was ${BUYER_PROTECTION_CLAIM_DEADLINE_DAYS} calendar days after shipment.`,
    };
  }

  return {
    eligible: true,
    status: "eligible" as const,
    detail:
      "The order is inside the Shipment Protection claim window for reviewed carrier loss or damage.",
  };
}

export const BUYER_PROTECTION_TERMS_SUMMARY = [
  `The optional fee is ${(BUYER_PROTECTION_RATE * 100).toFixed(0)}% of the item subtotal plus shipping, calculated before the protection fee is added.`,
  `Eligibility is limited to qualifying Tracked Card Letter orders with an item subtotal of $${BUYER_PROTECTION_MAX_ITEM_SUBTOTAL.toFixed(2)} or less.`,
  "Approved reimbursement covers the protected item subtotal and shipping amount shown at checkout; the protection fee itself is not reimbursed.",
  "Coverage applies only to reviewed carrier loss or damage claims supported by the available USPS/LetterTrack trail, photographs, packaging evidence, and order records.",
  `A claim may be submitted after ${BUYER_PROTECTION_MIN_CLAIM_DAYS} full days and no later than ${BUYER_PROTECTION_CLAIM_DEADLINE_DAYS} calendar days after the recorded shipment date.`,
  "Shipment Protection is a voluntary Truely Collectables reimbursement program. It is not insurance, USPS coverage, or guaranteed delivery.",
  "Declining Shipment Protection means this voluntary reimbursement program will not apply to the order, but does not waive rights that cannot legally be waived or payment-provider dispute rights.",
];
