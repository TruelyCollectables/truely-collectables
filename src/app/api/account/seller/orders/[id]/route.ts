import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../../lib/account-auth";
import { buildSellerOrderSignals } from "../../../../../../lib/seller-order-signals";
import {
  isMissingPayoutReviewGuardTable,
  loadSellerPayoutRequestReviewBlockers,
  type SellerPayoutRequestReviewBlocker,
} from "../../../../../../lib/seller-payout-review-blocks";
import { isDryRunShippingReference } from "../../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

type SellerOrderItemRow = {
  id: number;
  order_id: number;
  title: string | null;
  quantity: number | null;
  price: number | string | null;
};

type OrderRow = {
  id: number;
  created_at: string | null;
  total: number | string | null;
  status: string | null;
  fulfillment_status: string | null;
  shipping_name: string | null;
  shipping_amount: number | string | null;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  seller_item_count: number | null;
  store_item_count: number | null;
};

type SellerPayoutLedgerRow = {
  id: string;
  order_id: number;
  order_item_id: number;
  seller_payable_amount: number | string | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  platform_fee_amount: number | string | null;
  payout_status: string | null;
  created_at: string | null;
};

type OrderReviewCaseRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  case_type: string | null;
  status: string | null;
  severity: string | null;
  title: string | null;
  description: string | null;
  outcome_summary: string | null;
  updated_at: string | null;
};

type SellerPayoutRequestEntryRow = {
  payout_request_id: string;
  seller_payout_ledger_entry_id: string;
  amount_requested: number | string | null;
};

type SellerPayoutRequestRow = {
  id: string;
  status: string | null;
  requested_amount: number | string | null;
  estimated_net_amount: number | string | null;
  final_net_amount: number | string | null;
  requested_at: string | null;
  completed_at: string | null;
};

type SellerPayoutLedgerScopeRow = {
  id: string;
  order_id: number;
};

type SellerCashOutRequestDetail = {
  id: string;
  status: string;
  amountRequested: number;
  requestTotal: number;
  estimatedNetAmount: number;
  finalNetAmount: number;
  requestedAt: string | null;
  completedAt: string | null;
  reviewBlocked: boolean;
  reviewBlockReason: string | null;
  linkedOrderIds: number[];
  activeCaseCount: number;
  blockedLedgerRowCount: number;
};

const finalCaseStatuses = new Set([
  "decided_for_buyer",
  "decided_for_seller",
  "closed",
]);

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function moneyNumber(value: number | string | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function reviewBlockReason(blocker: SellerPayoutRequestReviewBlocker | undefined) {
  if (!blocker?.isBlocked) return null;

  const parts = [];

  if (blocker.activeCaseCount > 0) {
    parts.push(`${blocker.activeCaseCount} active case`);
  }

  if (blocker.blockedLedgerRowCount > 0) {
    parts.push(`${blocker.blockedLedgerRowCount} held or cancelled payout row`);
  }

  return `${parts.join(" and ")} currently blocking this cash-out request.`;
}

function isMissingSellerOrderTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("order_items") ||
    message.includes("orders") ||
    message.includes("seller_payout_ledger_entries") ||
    message.includes("order_review_cases") ||
    message.includes("seller_payout_request_entries") ||
    message.includes("seller_payout_requests")
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const orderId = Number(id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "Invalid order id." }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: sellerOrderItemsData, error: sellerOrderItemsError } =
      await supabase
        .from("order_items")
        .select("id,order_id,title,quantity,price")
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id)
        .eq("order_id", orderId)
        .order("id", { ascending: true });

    if (sellerOrderItemsError) {
      return NextResponse.json(
        { error: sellerOrderItemsError.message },
        { status: 500 },
      );
    }

    const sellerOrderItems = (sellerOrderItemsData || []) as SellerOrderItemRow[];

    if (sellerOrderItems.length === 0) {
      return NextResponse.json(
        { error: "Seller-owned order not found." },
        { status: 404 },
      );
    }

    const [
      orderResult,
      payoutLedgerResult,
      orderReviewCasesResult,
      payoutRequestEntriesResult,
    ] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id,created_at,total,status,fulfillment_status,shipping_name,shipping_amount,tracking_number,carrier,shipped_at,seller_item_count,store_item_count",
        )
        .eq("store_id", storeId)
        .eq("id", orderId)
        .single(),
      supabase
        .from("seller_payout_ledger_entries")
        .select(
          "id,order_id,order_item_id,seller_payable_amount,gross_item_amount,shipping_allocated_amount,platform_fee_amount,payout_status,created_at",
        )
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id)
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      supabase
        .from("order_review_cases")
        .select(
          "id,order_id,seller_account_id,case_type,status,severity,title,description,outcome_summary,updated_at",
        )
        .eq("store_id", storeId)
        .eq("order_id", orderId)
        .or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
        .order("updated_at", { ascending: false }),
      supabase
        .from("seller_payout_request_entries")
        .select("payout_request_id,seller_payout_ledger_entry_id,amount_requested")
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id),
    ]);

    if (orderResult.error || !orderResult.data) {
      return NextResponse.json(
        { error: orderResult.error?.message || "Order not found." },
        { status: 404 },
      );
    }

    if (payoutLedgerResult.error) {
      return NextResponse.json(
        { error: payoutLedgerResult.error.message },
        { status: 500 },
      );
    }

    if (orderReviewCasesResult.error) {
      return NextResponse.json(
        { error: orderReviewCasesResult.error.message },
        { status: 500 },
      );
    }

    if (payoutRequestEntriesResult.error) {
      return NextResponse.json(
        { error: payoutRequestEntriesResult.error.message },
        { status: 500 },
      );
    }

    const order = orderResult.data as OrderRow;
    const payoutRows = (payoutLedgerResult.data || []) as SellerPayoutLedgerRow[];
    const reviewCases =
      (orderReviewCasesResult.data || []) as OrderReviewCaseRow[];
    const payoutRequestEntries =
      (payoutRequestEntriesResult.data || []) as SellerPayoutRequestEntryRow[];
    const payoutRowsById = new Map(payoutRows.map((row) => [row.id, row]));
    const orderScopedRequestEntries = payoutRequestEntries.filter((entry) =>
      payoutRowsById.has(entry.seller_payout_ledger_entry_id),
    );
    const payoutRequestIds = Array.from(
      new Set(orderScopedRequestEntries.map((entry) => entry.payout_request_id)),
    );
    const { data: payoutRequestsData, error: payoutRequestsError } =
      payoutRequestIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("seller_payout_requests")
            .select(
              "id,status,requested_amount,estimated_net_amount,final_net_amount,requested_at,completed_at",
            )
            .eq("store_id", storeId)
            .eq("seller_account_id", account.id)
            .in("id", payoutRequestIds)
            .order("requested_at", { ascending: false });

    if (payoutRequestsError) {
      return NextResponse.json(
        { error: payoutRequestsError.message },
        { status: 500 },
      );
    }

    const payoutRequests = (payoutRequestsData || []) as SellerPayoutRequestRow[];
    const requestRowsById = new Map(
      payoutRequests.map((requestRow) => [requestRow.id, requestRow]),
    );
    const linkedLedgerEntryIds = Array.from(
      new Set(
        payoutRequestEntries
          .filter((entry) => payoutRequestIds.includes(entry.payout_request_id))
          .map((entry) => entry.seller_payout_ledger_entry_id),
      ),
    );
    const { data: linkedLedgerRowsData, error: linkedLedgerRowsError } =
      linkedLedgerEntryIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("seller_payout_ledger_entries")
            .select("id,order_id")
            .eq("store_id", storeId)
            .eq("seller_account_id", account.id)
            .in("id", linkedLedgerEntryIds);

    if (linkedLedgerRowsError) {
      return NextResponse.json(
        { error: linkedLedgerRowsError.message },
        { status: 500 },
      );
    }

    const linkedLedgerRows = (linkedLedgerRowsData || []) as SellerPayoutLedgerScopeRow[];
    const linkedLedgerRowsById = new Map(
      linkedLedgerRows.map((row) => [row.id, row]),
    );
    const linkedOrderIdsByRequestId = new Map<string, number[]>();

    for (const entry of payoutRequestEntries) {
      if (!payoutRequestIds.includes(entry.payout_request_id)) continue;

      const linkedLedgerRow = linkedLedgerRowsById.get(
        entry.seller_payout_ledger_entry_id,
      );

      if (!linkedLedgerRow) continue;

      const existing = linkedOrderIdsByRequestId.get(entry.payout_request_id) || [];

      if (!existing.includes(linkedLedgerRow.order_id)) {
        existing.push(linkedLedgerRow.order_id);
      }

      linkedOrderIdsByRequestId.set(entry.payout_request_id, existing);
    }

    let requestBlockers = new Map<string, SellerPayoutRequestReviewBlocker>();

    try {
      requestBlockers = await loadSellerPayoutRequestReviewBlockers({
        supabase,
        storeId,
        payoutRequestIds,
      });
    } catch (error: any) {
      if (!isMissingPayoutReviewGuardTable(error)) {
        throw error;
      }
    }

    const itemRowsById = new Map(
      sellerOrderItems.map((itemRow) => [itemRow.id, itemRow]),
    );
    const activeCases = reviewCases.filter(
      (reviewCase) => !finalCaseStatuses.has(reviewCase.status || "open"),
    );
    const cashOutRequestsById = new Map<string, SellerCashOutRequestDetail>();

    for (const entry of orderScopedRequestEntries) {
      const payoutRequest = requestRowsById.get(entry.payout_request_id);

      if (!payoutRequest) continue;

      const blocker = requestBlockers.get(payoutRequest.id);
      const existing = cashOutRequestsById.get(payoutRequest.id);

      if (existing) {
        existing.amountRequested = roundMoney(
          existing.amountRequested + moneyNumber(entry.amount_requested),
        );
        continue;
      }

      cashOutRequestsById.set(payoutRequest.id, {
        id: payoutRequest.id,
        status: payoutRequest.status || "requested",
        amountRequested: moneyNumber(entry.amount_requested),
        requestTotal: moneyNumber(payoutRequest.requested_amount),
        estimatedNetAmount: moneyNumber(payoutRequest.estimated_net_amount),
        finalNetAmount: moneyNumber(payoutRequest.final_net_amount),
        requestedAt: payoutRequest.requested_at,
        completedAt: payoutRequest.completed_at,
        reviewBlocked: blocker?.isBlocked === true,
        reviewBlockReason: reviewBlockReason(blocker),
        linkedOrderIds: (linkedOrderIdsByRequestId.get(payoutRequest.id) || []).sort(
          (left, right) => left - right,
        ),
        activeCaseCount: blocker?.activeCaseCount || 0,
        blockedLedgerRowCount: blocker?.blockedLedgerRowCount || 0,
      });
    }

    const cashOutRequests = Array.from(cashOutRequestsById.values()).sort((a, b) => {
      const aTime = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
      const bTime = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
      return bTime - aTime;
    });
    const dryRunShipping = isDryRunShippingReference(order.tracking_number);
    const safeTrackingNumber = dryRunShipping
      ? null
      : order.tracking_number || null;
    const safeCarrier = dryRunShipping ? null : order.carrier || null;
    const recentSignals = buildSellerOrderSignals({
      orderId,
      createdAt: order.created_at,
      paymentStatus: order.status || "unknown",
      shippedAt: order.shipped_at,
      carrier: safeCarrier,
      trackingNumber: safeTrackingNumber,
      payoutRows: payoutRows.map((payoutRow) => ({
        id: payoutRow.id,
        payoutStatus: payoutRow.payout_status || "unknown",
        createdAt: payoutRow.created_at,
      })),
      cashOutRequests,
      reviewCases: reviewCases.map((reviewCase) => ({
        id: reviewCase.id,
        title: reviewCase.title || `Order #${orderId} case`,
        status: reviewCase.status || "open",
        severity: reviewCase.severity || "medium",
        caseType: reviewCase.case_type || "other",
        updatedAt: reviewCase.updated_at,
      })),
    });

    return NextResponse.json({
      success: true,
      order: {
        orderId,
        createdAt: order.created_at,
        orderTotal: moneyNumber(order.total),
        paymentStatus: order.status || "unknown",
        fulfillmentStatus: order.fulfillment_status || "unknown",
        shippingName: order.shipping_name || null,
        shippingAmount: moneyNumber(order.shipping_amount),
        trackingNumber: safeTrackingNumber,
        carrier: safeCarrier,
        dryRunShippingBlocked: dryRunShipping,
        shippedAt: order.shipped_at,
        sellerItemCount: sellerOrderItems.length,
        sellerUnitCount: sellerOrderItems.reduce(
          (sum, itemRow) => sum + Number(itemRow.quantity || 0),
          0,
        ),
        sellerGrossAmount: sellerOrderItems.reduce(
          (sum, itemRow) =>
            sum + moneyNumber(itemRow.price) * Number(itemRow.quantity || 0),
          0,
        ),
        sellerPayableAmount: payoutRows.reduce(
          (sum, payoutRow) => sum + moneyNumber(payoutRow.seller_payable_amount),
          0,
        ),
        platformFeeAmount: payoutRows.reduce(
          (sum, payoutRow) => sum + moneyNumber(payoutRow.platform_fee_amount),
          0,
        ),
        heldPayoutRowCount: payoutRows.filter((payoutRow) =>
          String(payoutRow.payout_status || "").startsWith("hold_"),
        ).length,
        activeCaseCount: activeCases.length,
      },
      items: sellerOrderItems.map((itemRow) => ({
        id: itemRow.id,
        title: itemRow.title || "Untitled item",
        quantity: Number(itemRow.quantity || 0),
        price: moneyNumber(itemRow.price),
        lineTotal:
          moneyNumber(itemRow.price) * Number(itemRow.quantity || 0),
      })),
      payoutRows: payoutRows.map((payoutRow) => ({
        id: payoutRow.id,
        orderItemId: payoutRow.order_item_id,
        itemTitle:
          itemRowsById.get(payoutRow.order_item_id)?.title || "Untitled item",
        grossItemAmount: moneyNumber(payoutRow.gross_item_amount),
        shippingAllocatedAmount: moneyNumber(
          payoutRow.shipping_allocated_amount,
        ),
        platformFeeAmount: moneyNumber(payoutRow.platform_fee_amount),
        sellerPayableAmount: moneyNumber(payoutRow.seller_payable_amount),
        payoutStatus: payoutRow.payout_status || "unknown",
        createdAt: payoutRow.created_at,
      })),
      cashOutRequests,
      reviewCases: reviewCases.map((reviewCase) => ({
        id: reviewCase.id,
        title: reviewCase.title || `Order #${orderId} case`,
        caseType: reviewCase.case_type || "other",
        status: reviewCase.status || "open",
        severity: reviewCase.severity || "medium",
        description: reviewCase.description || null,
        outcomeSummary: reviewCase.outcome_summary || null,
        updatedAt: reviewCase.updated_at,
        sellerScoped: reviewCase.seller_account_id === account.id,
      })),
      recentSignals,
    });
  } catch (error: any) {
    if (isMissingSellerOrderTables(error)) {
      return NextResponse.json(
        {
          error:
            "Seller order detail is not available until seller payout and order review tables are applied.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error.message || "Could not load seller order detail" },
      { status: 500 },
    );
  }
}
