export type SellerOrderSignalTone = "positive" | "warning" | "neutral";

export type SellerOrderSignal = {
  id: string;
  kind:
    | "order_created"
    | "payment_cleared"
    | "shipment_saved"
    | "payout_hold"
    | "cash_out"
    | "review_case";
  title: string;
  detail: string;
  tone: SellerOrderSignalTone;
  occurredAt: string | null;
};

type SellerSignalCase = {
  id: string;
  title: string | null;
  status: string | null;
  severity: string | null;
  caseType: string | null;
  updatedAt: string | null;
};

type SellerSignalPayoutRow = {
  id: string;
  payoutStatus: string | null;
  createdAt: string | null;
};

type SellerSignalCashOutRequest = {
  id: string;
  status: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  amountRequested?: number | null;
};

type SellerOrderSignalInput = {
  orderId: number;
  createdAt: string | null;
  paymentStatus: string | null;
  shippedAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  payoutRows?: SellerSignalPayoutRow[];
  cashOutRequests?: SellerSignalCashOutRequest[];
  reviewCases?: SellerSignalCase[];
};

const positivePaymentStatuses = new Set(["paid", "completed"]);
const finalPositiveCaseStatuses = new Set(["decided_for_seller", "closed"]);
const finalNegativeCaseStatuses = new Set(["decided_for_buyer"]);

function moneyLabel(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function signalTime(value: string | null | undefined) {
  return value ? new Date(value).getTime() : 0;
}

function label(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.replaceAll("_", " ");
}

function holdTitle(status: string | null | undefined, count: number) {
  const prefix = count === 1 ? "1 payout row" : `${count} payout rows`;

  if (status === "hold_pending_fulfillment") {
    return `${prefix} waiting for fulfillment`;
  }

  if (status === "hold_dispute_or_review") {
    return `${prefix} held by review pressure`;
  }

  return `${prefix} on payout hold`;
}

function holdDetail(status: string | null | undefined) {
  if (status === "hold_pending_fulfillment") {
    return "Tracking and fulfillment completion are still needed before payout can clear.";
  }

  if (status === "hold_dispute_or_review") {
    return "A dispute or review case is currently keeping payout funds on hold.";
  }

  return `Current payout state: ${label(status)}.`;
}

function cashOutTitle(status: string | null | undefined) {
  if (status === "completed") {
    return "Cash-out request completed";
  }

  if (status === "processing") {
    return "Cash-out request is processing";
  }

  if (status === "approved") {
    return "Cash-out request approved";
  }

  if (status === "cancelled" || status === "reversed" || status === "failed") {
    return "Cash-out request needs review";
  }

  return "Cash-out request submitted";
}

function cashOutTone(status: string | null | undefined): SellerOrderSignalTone {
  if (status === "completed") return "positive";
  if (status === "cancelled" || status === "reversed" || status === "failed") {
    return "neutral";
  }
  return "warning";
}

function cashOutDetail(request: SellerSignalCashOutRequest) {
  const amount =
    typeof request.amountRequested === "number" && request.amountRequested > 0
      ? ` for ${moneyLabel(request.amountRequested)}`
      : "";

  if (request.status === "completed") {
    return `This seller cash-out request finished${amount}.`;
  }

  if (request.status === "processing") {
    return `Funds for this request are currently moving through payout processing${amount}.`;
  }

  if (request.status === "approved") {
    return `This request has been approved and is queued for payout handling${amount}.`;
  }

  if (request.status === "cancelled" || request.status === "reversed") {
    return `This request did not complete. Review the related payout rows before requesting again${amount}.`;
  }

  if (request.status === "failed") {
    return `The payout processor did not complete this request${amount}.`;
  }

  return `This cash-out request is waiting for review${amount}.`;
}

function reviewCaseTone(status: string | null | undefined): SellerOrderSignalTone {
  if (finalPositiveCaseStatuses.has(status || "")) return "positive";
  if (finalNegativeCaseStatuses.has(status || "")) return "warning";
  return "warning";
}

function reviewCaseTitle(reviewCase: SellerSignalCase) {
  if (reviewCase.status === "decided_for_seller") {
    return "Review case resolved for seller";
  }

  if (reviewCase.status === "decided_for_buyer") {
    return "Review case resolved for buyer";
  }

  if (reviewCase.status === "closed") {
    return "Review case closed";
  }

  return reviewCase.title || `Order #${reviewCase.id} review case updated`;
}

function reviewCaseDetail(reviewCase: SellerSignalCase) {
  return `${label(reviewCase.caseType)} case / ${label(reviewCase.severity)} severity / ${label(reviewCase.status)} status.`;
}

export function sortSellerOrderSignals<T extends { occurredAt: string | null }>(
  signals: T[],
  limit?: number,
) {
  const sorted = [...signals].sort(
    (left, right) => signalTime(right.occurredAt) - signalTime(left.occurredAt),
  );

  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

export function buildSellerOrderSignals(
  input: SellerOrderSignalInput,
  limit = 6,
): SellerOrderSignal[] {
  const signals: SellerOrderSignal[] = [];
  const payoutRows = input.payoutRows || [];
  const cashOutRequests = input.cashOutRequests || [];
  const reviewCases = input.reviewCases || [];

  signals.push({
    id: `order-created-${input.orderId}`,
    kind: "order_created",
    title: "Seller order created",
    detail: "This routed order is now part of your seller queue.",
    tone: "neutral",
    occurredAt: input.createdAt,
  });

  if (positivePaymentStatuses.has(input.paymentStatus || "")) {
    signals.push({
      id: `payment-${input.orderId}`,
      kind: "payment_cleared",
      title: "Buyer payment cleared",
      detail: "Payment is in a cleared state for this routed order.",
      tone: "positive",
      occurredAt: input.createdAt,
    });
  }

  if (input.shippedAt || input.trackingNumber) {
    const carrier = input.carrier ? `${input.carrier} ` : "";
    const tracking = input.trackingNumber ? `${carrier}${input.trackingNumber}` : "Tracking saved";

    signals.push({
      id: `shipment-${input.orderId}`,
      kind: "shipment_saved",
      title: "Shipping update saved",
      detail: `${tracking}.`,
      tone: "positive",
      occurredAt: input.shippedAt || input.createdAt,
    });
  }

  const heldRowsByStatus = new Map<
    string,
    { count: number; latestAt: string | null }
  >();

  for (const payoutRow of payoutRows) {
    const status = payoutRow.payoutStatus || "unknown";

    if (!status.startsWith("hold_")) continue;

    const existing = heldRowsByStatus.get(status);
    const latestAt =
      !existing || signalTime(payoutRow.createdAt) > signalTime(existing.latestAt)
        ? payoutRow.createdAt
        : existing.latestAt;

    heldRowsByStatus.set(status, {
      count: (existing?.count || 0) + 1,
      latestAt,
    });
  }

  for (const [status, value] of heldRowsByStatus.entries()) {
    signals.push({
      id: `hold-${input.orderId}-${status}`,
      kind: "payout_hold",
      title: holdTitle(status, value.count),
      detail: holdDetail(status),
      tone: "warning",
      occurredAt: value.latestAt,
    });
  }

  for (const request of cashOutRequests) {
    signals.push({
      id: `cash-out-${request.id}`,
      kind: "cash_out",
      title: cashOutTitle(request.status),
      detail: cashOutDetail(request),
      tone: cashOutTone(request.status),
      occurredAt: request.completedAt || request.requestedAt,
    });
  }

  for (const reviewCase of reviewCases) {
    signals.push({
      id: `review-case-${reviewCase.id}`,
      kind: "review_case",
      title: reviewCaseTitle(reviewCase),
      detail: reviewCaseDetail(reviewCase),
      tone: reviewCaseTone(reviewCase.status),
      occurredAt: reviewCase.updatedAt,
    });
  }

  return sortSellerOrderSignals(signals, limit);
}
