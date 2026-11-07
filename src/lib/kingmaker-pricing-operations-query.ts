import type { PricingReceiptSummaryInput } from "./kingmaker-pricing-receipt-operations";

export type PricingReceiptStatus = PricingReceiptSummaryInput["status"];

export type PricingReceiptOperationsFilters = {
  status?: PricingReceiptStatus | null;
  identityId?: string | null;
  profileName?: string | null;
  minConfidence?: number | null;
  minEstimatedProfit?: number | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  page?: number;
  pageSize?: number;
};

type OperationsReceipt = PricingReceiptSummaryInput & {
  pricingProfile?: { name?: string | null } | null;
};

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function filterAndPaginatePricingReceipts(
  receipts: OperationsReceipt[],
  filters: PricingReceiptOperationsFilters,
) {
  const identityId = String(filters.identityId || "").trim().toLowerCase();
  const profileName = String(filters.profileName || "").trim().toLowerCase();
  const minConfidence = finite(filters.minConfidence);
  const minEstimatedProfit = finite(filters.minEstimatedProfit);
  const createdFrom = validDate(filters.createdFrom);
  const createdTo = validDate(filters.createdTo);
  const page = Math.max(1, Math.floor(finite(filters.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(finite(filters.pageSize) || 25)));

  const filtered = receipts.filter((receipt) => {
    if (filters.status && receipt.status !== filters.status) return false;
    if (identityId && !receipt.identityId.toLowerCase().includes(identityId)) return false;
    if (profileName && !String(receipt.pricingProfile?.name || "").toLowerCase().includes(profileName)) return false;
    if (minConfidence != null && receipt.confidence < minConfidence) return false;
    if (minEstimatedProfit != null && (receipt.estimatedProfitAtCeiling ?? Number.NEGATIVE_INFINITY) < minEstimatedProfit) return false;

    const createdAt = validDate(receipt.createdAt);
    if (createdFrom != null && (createdAt == null || createdAt < createdFrom)) return false;
    if (createdTo != null && (createdAt == null || createdAt > createdTo)) return false;
    return true;
  });

  const offset = (page - 1) * pageSize;
  return {
    rows: filtered.slice(offset, offset + pageSize),
    pagination: {
      page,
      pageSize,
      totalRows: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      hasPreviousPage: page > 1,
      hasNextPage: offset + pageSize < filtered.length,
    },
  };
}

export function comparePricingReceipts(receipts: OperationsReceipt[], receiptIds: string[]) {
  const requested = new Set(receiptIds.map((value) => String(value).trim()).filter(Boolean).slice(0, 5));
  const rows = receipts.filter((receipt) => requested.has(receipt.id));
  const ready = rows.filter((receipt) => receipt.status === "ready");
  const bestProfit = ready
    .filter((receipt) => receipt.estimatedProfitAtCeiling != null)
    .sort((a, b) => (b.estimatedProfitAtCeiling || 0) - (a.estimatedProfitAtCeiling || 0))[0] || null;
  const highestConfidence = [...rows].sort((a, b) => b.confidence - a.confidence)[0] || null;

  return {
    receipts: rows,
    requestedCount: requested.size,
    matchedCount: rows.length,
    bestEstimatedProfitReceiptId: bestProfit?.id || null,
    highestConfidenceReceiptId: highestConfidence?.id || null,
    boundary: "advisory_only" as const,
  };
}
