export const BUYER_PROTECTION_POLICY_VERSION =
  "truely-buyer-protection-v1-2026-07-26";
export const BUYER_PROTECTION_PATH = "/buyer-protection";
export const BUYER_PROTECTION_FEE = 0.75;
export const BUYER_PROTECTION_MAX_COVERAGE = 20;
export const BUYER_PROTECTION_MIN_CLAIM_DAYS = 7;
export const BUYER_PROTECTION_CLAIM_DEADLINE_DAYS = 21;

export type BuyerProtectionPreferenceMode =
  | "always_on"
  | "always_off"
  | "one_time";

export type BuyerProtectionEligibility = {
  eligible: boolean;
  coveredAmount: number;
  reason: string | null;
};

function money(value: unknown) {
  const number = Number(value || 0);
  return Math.max(0, Math.round(number * 100) / 100);
}

export function isBuyerProtectionPreferenceMode(
  value: unknown,
): value is BuyerProtectionPreferenceMode {
  return ["always_on", "always_off", "one_time"].includes(String(value));
}

export function getBuyerProtectionEligibility(params: {
  shippingMethod: string | null | undefined;
  itemSubtotal: number;
  itemCount: number;
}): BuyerProtectionEligibility {
  const coveredAmount = Math.min(
    money(params.itemSubtotal),
    BUYER_PROTECTION_MAX_COVERAGE,
  );

  if (params.shippingMethod !== "STANDARD_ENVELOPE") {
    return {
      eligible: false,
      coveredAmount: 0,
      reason:
        "Buyer Protection is available only with the Tracked Card Letter shipping method.",
    };
  }

  if (params.itemCount < 1 || params.itemCount > 4) {
    return {
      eligible: false,
      coveredAmount: 0,
      reason: "Buyer Protection is limited to qualifying orders of one to four cards.",
    };
  }

  if (coveredAmount <= 0 || money(params.itemSubtotal) > BUYER_PROTECTION_MAX_COVERAGE) {
    return {
      eligible: false,
      coveredAmount: 0,
      reason: `Buyer Protection is limited to item subtotals of $${BUYER_PROTECTION_MAX_COVERAGE.toFixed(2)} or less.`,
    };
  }

  return { eligible: true, coveredAmount, reason: null };
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
      detail: "The protection claim clock has not started because the order is not shipped.",
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
      detail: `A claim may be submitted only after ${BUYER_PROTECTION_MIN_CLAIM_DAYS} full days have passed from shipment.`,
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
    detail: "The order is inside the buyer-protection claim window.",
  };
}

export const BUYER_PROTECTION_TERMS_SUMMARY = [
  `The optional fee is $${BUYER_PROTECTION_FEE.toFixed(2)} per qualifying order.`,
  `Reimbursement is limited to the item subtotal, up to $${BUYER_PROTECTION_MAX_COVERAGE.toFixed(2)}.`,
  "Shipping charges and the Buyer Protection fee are not reimbursed.",
  `The shipment must remain undelivered for at least ${BUYER_PROTECTION_MIN_CLAIM_DAYS} full days before a claim may be submitted.`,
  `A claim must be submitted no later than ${BUYER_PROTECTION_CLAIM_DEADLINE_DAYS} calendar days after the recorded shipment date.`,
  "Claims are reviewed against the LetterTrack/USPS scan trail and order evidence.",
  "Buyer Protection is a Truely Collectables reimbursement program and is not insurance or guaranteed USPS delivery.",
];
