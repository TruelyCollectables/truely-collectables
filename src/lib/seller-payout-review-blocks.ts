import type { SupabaseClient } from "@supabase/supabase-js";
import { isDryRunShippingReference } from "./shipping-dry-run";

const finalCaseStatuses = new Set([
  "decided_for_buyer",
  "decided_for_seller",
  "closed",
]);

const terminalLedgerStatuses = new Set(["reversed", "cancelled"]);

type SellerPayoutRequestEntryRow = {
  payout_request_id: string;
  seller_payout_ledger_entry_id: string;
};

type SellerPayoutLedgerScopeRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  payout_status: string | null;
};

type OrderReviewCaseScopeRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  status: string | null;
  title: string | null;
  severity: string | null;
  updated_at: string | null;
};

type OrderShippingScopeRow = {
  id: number;
  tracking_number: string | null;
};

export type SellerPayoutRequestReviewBlocker = {
  requestId: string;
  blockingCases: Array<{
    id: string;
    orderId: number;
    sellerAccountId: string | null;
    status: string | null;
    title: string | null;
    severity: string | null;
    updatedAt: string | null;
  }>;
  blockingLedgerRows: Array<{
    id: string;
    orderId: number;
    sellerAccountId: string | null;
    payoutStatus: string | null;
  }>;
  dryRunShippingRows: Array<{
    id: string;
    orderId: number;
    sellerAccountId: string | null;
    payoutStatus: string | null;
  }>;
  affectedOrderIds: number[];
  activeCaseCount: number;
  blockedLedgerRowCount: number;
  dryRunShippingRowCount: number;
  isBlocked: boolean;
};

export function isMissingPayoutReviewGuardTable(error: {
  code?: string;
  message?: string;
}) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_payout_request_entries") ||
    message.includes("seller_payout_ledger_entries") ||
    message.includes("order_review_cases")
  );
}

function appliesToLedgerRow(
  reviewCase: OrderReviewCaseScopeRow,
  ledgerRow: SellerPayoutLedgerScopeRow,
) {
  if (reviewCase.order_id !== ledgerRow.order_id) return false;
  if (!reviewCase.seller_account_id) return true;
  return reviewCase.seller_account_id === ledgerRow.seller_account_id;
}

function uniqueNumbers(values: number[]) {
  return Array.from(new Set(values));
}

export async function loadSellerPayoutRequestReviewBlockers(params: {
  supabase: SupabaseClient;
  storeId: string;
  payoutRequestIds: string[];
}) {
  const requestIds = Array.from(
    new Set(params.payoutRequestIds.map((value) => String(value || "").trim())),
  ).filter(Boolean);

  if (requestIds.length === 0) {
    return new Map<string, SellerPayoutRequestReviewBlocker>();
  }

  const { data: requestEntriesData, error: requestEntriesError } =
    await params.supabase
      .from("seller_payout_request_entries")
      .select("payout_request_id,seller_payout_ledger_entry_id")
      .eq("store_id", params.storeId)
      .in("payout_request_id", requestIds);

  if (requestEntriesError) throw requestEntriesError;

  const requestEntries = (requestEntriesData || []) as SellerPayoutRequestEntryRow[];
  const ledgerIds = Array.from(
    new Set(
      requestEntries.map((entry) => entry.seller_payout_ledger_entry_id),
    ),
  );

  if (ledgerIds.length === 0) {
    return new Map(
      requestIds.map((requestId) => [
        requestId,
        {
          requestId,
          blockingCases: [],
          blockingLedgerRows: [],
          affectedOrderIds: [],
          activeCaseCount: 0,
          blockedLedgerRowCount: 0,
          dryRunShippingRows: [],
          dryRunShippingRowCount: 0,
          isBlocked: false,
        } satisfies SellerPayoutRequestReviewBlocker,
      ]),
    );
  }

  const { data: ledgerRowsData, error: ledgerRowsError } = await params.supabase
    .from("seller_payout_ledger_entries")
    .select("id,order_id,seller_account_id,payout_status")
    .eq("store_id", params.storeId)
    .in("id", ledgerIds);

  if (ledgerRowsError) throw ledgerRowsError;

  const ledgerRows = (ledgerRowsData || []) as SellerPayoutLedgerScopeRow[];
  const ledgerRowsById = new Map(ledgerRows.map((row) => [row.id, row]));
  const orderIds = uniqueNumbers(ledgerRows.map((row) => row.order_id));

  const { data: reviewCasesData, error: reviewCasesError } =
    orderIds.length === 0
      ? { data: [], error: null }
      : await params.supabase
          .from("order_review_cases")
          .select("id,order_id,seller_account_id,status,title,severity,updated_at")
          .eq("store_id", params.storeId)
          .in("order_id", orderIds)
          .order("updated_at", { ascending: false });

  if (reviewCasesError) throw reviewCasesError;

  const activeCases = ((reviewCasesData || []) as OrderReviewCaseScopeRow[]).filter(
    (reviewCase) => !finalCaseStatuses.has(reviewCase.status || "open"),
  );
  const { data: orderShippingData, error: orderShippingError } =
    orderIds.length === 0
      ? { data: [], error: null }
      : await params.supabase
          .from("orders")
          .select("id,tracking_number")
          .eq("store_id", params.storeId)
          .in("id", orderIds);

  if (orderShippingError) throw orderShippingError;

  const dryRunShippingOrderIds = new Set(
    ((orderShippingData || []) as OrderShippingScopeRow[])
      .filter((order) => isDryRunShippingReference(order.tracking_number))
      .map((order) => order.id),
  );
  const blockersByRequestId = new Map<string, SellerPayoutRequestReviewBlocker>();

  for (const requestId of requestIds) {
    const scopedLedgerRows = requestEntries
      .filter((entry) => entry.payout_request_id === requestId)
      .map((entry) => ledgerRowsById.get(entry.seller_payout_ledger_entry_id))
      .filter((row): row is SellerPayoutLedgerScopeRow => Boolean(row));
    const blockingLedgerRows = scopedLedgerRows.filter((row) => {
      const payoutStatus = row.payout_status || "eligible";
      return (
        payoutStatus.startsWith("hold_") || terminalLedgerStatuses.has(payoutStatus)
      );
    });
    const dryRunShippingRows = scopedLedgerRows.filter((row) =>
      dryRunShippingOrderIds.has(row.order_id),
    );
    const blockingCases = activeCases.filter((reviewCase) =>
      scopedLedgerRows.some((ledgerRow) => appliesToLedgerRow(reviewCase, ledgerRow)),
    );

    blockersByRequestId.set(requestId, {
      requestId,
      blockingCases: blockingCases.map((reviewCase) => ({
        id: reviewCase.id,
        orderId: reviewCase.order_id,
        sellerAccountId: reviewCase.seller_account_id,
        status: reviewCase.status,
        title: reviewCase.title,
        severity: reviewCase.severity,
        updatedAt: reviewCase.updated_at,
      })),
      blockingLedgerRows: blockingLedgerRows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        sellerAccountId: row.seller_account_id,
        payoutStatus: row.payout_status,
      })),
      dryRunShippingRows: dryRunShippingRows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        sellerAccountId: row.seller_account_id,
        payoutStatus: row.payout_status,
      })),
      affectedOrderIds: uniqueNumbers(scopedLedgerRows.map((row) => row.order_id)),
      activeCaseCount: blockingCases.length,
      blockedLedgerRowCount: blockingLedgerRows.length,
      dryRunShippingRowCount: dryRunShippingRows.length,
      isBlocked:
        blockingCases.length > 0 ||
        blockingLedgerRows.length > 0 ||
        dryRunShippingRows.length > 0,
    });
  }

  return blockersByRequestId;
}
