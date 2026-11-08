import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import {
  buildSellerOrderSignals,
  sortSellerOrderSignals,
} from "../../../../../lib/seller-order-signals";
import {
  isMissingPayoutReviewGuardTable,
  loadSellerPayoutRequestReviewBlockers,
  type SellerPayoutRequestReviewBlocker,
} from "../../../../../lib/seller-payout-review-blocks";
import { isDryRunShippingReference } from "../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { buildUnder20SellerProtectionSellerVisibilitySummary } from "../../../../../lib/under20-seller-protection-claims";

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
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  seller_payable_amount: number | string | null;
  platform_fee_amount: number | string | null;
  payout_status: string | null;
  created_at: string | null;
  metadata?: Record<string, unknown> | null;
};

type OrderReviewCaseRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  case_type: string | null;
  status: string | null;
  severity: string | null;
  title: string | null;
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
  requested_at: string | null;
  completed_at: string | null;
};

type SellerCashOutRequestSignalRow = {
  id: string;
  status: string;
  requestedAt: string | null;
  completedAt: string | null;
};

type SellerPayoutLedgerScopeRow = {
  id: string;
  order_id: number;
};

const finalCaseStatuses = new Set([
  "decided_for_buyer",
  "decided_for_seller",
  "closed",
]);

const openPayoutRequestStatuses = new Set([
  "requested",
  "approved",
  "processing",
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

  if (blocker.dryRunShippingRowCount > 0) {
    parts.push(`${blocker.dryRunShippingRowCount} dry-run shipping row`);
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

function orderAnchor(orderId: number) {
  return `seller-order-${orderId}`;
}

function sellerOrdersHeaders(params: {
  orderCount: number;
  activeCaseCount: number;
  heldOrderCount: number;
  openCashOutRequestCount: number;
  dryRunShippingBlockedCount: number;
}) {
  return {
    "X-TCOS-Seller-Orders": String(params.orderCount),
    "X-TCOS-Seller-Orders-Active-Cases": String(params.activeCaseCount),
    "X-TCOS-Seller-Orders-Held": String(params.heldOrderCount),
    "X-TCOS-Seller-Orders-Open-Cash-Out": String(
      params.openCashOutRequestCount,
    ),
    "X-TCOS-Seller-Orders-Dry-Run-Shipping-Blocked": String(
      params.dryRunShippingBlockedCount,
    ),
  };
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: orderItemsData, error: orderItemsError } = await supabase
      .from("order_items")
      .select("id,order_id,title,quantity,price")
      .eq("store_id", storeId)
      .eq("seller_account_id", account.id)
      .order("order_id", { ascending: false })
      .limit(500);

    if (orderItemsError) {
      return NextResponse.json({ error: orderItemsError.message }, { status: 500 });
    }

    const orderItems = (orderItemsData || []) as SellerOrderItemRow[];
    const orderIds = Array.from(
      new Set(orderItems.map((item) => item.order_id).filter(Boolean)),
    );

    if (orderIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          summary: {
            orderCount: 0,
            activeCaseCount: 0,
            heldOrderCount: 0,
            openCashOutRequestCount: 0,
            sellerPayableAmount: 0,
          },
          orders: [],
        },
        {
          headers: sellerOrdersHeaders({
            orderCount: 0,
            activeCaseCount: 0,
            heldOrderCount: 0,
            openCashOutRequestCount: 0,
            dryRunShippingBlockedCount: 0,
          }),
        },
      );
    }

    const [
      ordersResult,
      payoutLedgerResult,
      orderReviewCasesResult,
      payoutRequestEntriesResult,
    ] = await Promise.all([
      supabase
        .from("orders")
        .select(
          "id,created_at,total,status,fulfillment_status,tracking_number,carrier,shipped_at,seller_item_count,store_item_count",
        )
        .eq("store_id", storeId)
        .in("id", orderIds),
      supabase
        .from("seller_payout_ledger_entries")
        .select(
          "id,order_id,order_item_id,gross_item_amount,shipping_allocated_amount,seller_payable_amount,platform_fee_amount,payout_status,created_at,metadata",
        )
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id)
        .in("order_id", orderIds),
      supabase
        .from("order_review_cases")
        .select("id,order_id,seller_account_id,case_type,status,severity,title,updated_at")
        .eq("store_id", storeId)
        .in("order_id", orderIds)
        .or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
        .order("updated_at", { ascending: false }),
      supabase
        .from("seller_payout_request_entries")
        .select("payout_request_id,seller_payout_ledger_entry_id,amount_requested")
        .eq("store_id", storeId)
        .eq("seller_account_id", account.id),
    ]);

    if (ordersResult.error) {
      return NextResponse.json({ error: ordersResult.error.message }, { status: 500 });
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

    const payoutRows = (payoutLedgerResult.data || []) as SellerPayoutLedgerRow[];
    const payoutRequestEntries =
      (payoutRequestEntriesResult.data || []) as SellerPayoutRequestEntryRow[];
    const requestIds = Array.from(
      new Set(payoutRequestEntries.map((entry) => entry.payout_request_id)),
    );
    const { data: payoutRequestsData, error: payoutRequestsError } =
      requestIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("seller_payout_requests")
            .select("id,status,requested_amount,requested_at,completed_at")
            .eq("store_id", storeId)
            .eq("seller_account_id", account.id)
            .in("id", requestIds);

    if (payoutRequestsError) {
      return NextResponse.json(
        { error: payoutRequestsError.message },
        { status: 500 },
      );
    }

    const orders = (ordersResult.data || []) as OrderRow[];
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    const cases = (orderReviewCasesResult.data || []) as OrderReviewCaseRow[];
    const payoutRequests = (payoutRequestsData || []) as SellerPayoutRequestRow[];
    const payoutRequestStatusById = new Map(
      payoutRequests.map((row) => [row.id, row.status || "requested"]),
    );
    const payoutRequestById = new Map(
      payoutRequests.map((row) => [row.id, row]),
    );
    const payoutRowsById = new Map(payoutRows.map((row) => [row.id, row]));
    const linkedLedgerEntryIds = Array.from(
      new Set(
        payoutRequestEntries
          .filter((entry) => requestIds.includes(entry.payout_request_id))
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
      if (!requestIds.includes(entry.payout_request_id)) continue;

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
        payoutRequestIds: requestIds,
      });
    } catch (error: any) {
      if (!isMissingPayoutReviewGuardTable(error)) {
        throw error;
      }
    }

    const openRequestCountByOrderId = new Map<number, number>();

    for (const entry of payoutRequestEntries) {
      const requestStatus = payoutRequestStatusById.get(entry.payout_request_id);
      const payoutRow = payoutRowsById.get(entry.seller_payout_ledger_entry_id);

      if (!payoutRow || !openPayoutRequestStatuses.has(requestStatus || "")) {
        continue;
      }

      openRequestCountByOrderId.set(
        payoutRow.order_id,
        (openRequestCountByOrderId.get(payoutRow.order_id) || 0) + 1,
      );
    }

    const orderActivity = orderIds
      .map((orderId) => {
        const order = ordersById.get(orderId);
        const scopedItems = orderItems.filter((item) => item.order_id === orderId);
        const scopedPayoutRows = payoutRows.filter((row) => row.order_id === orderId);
        const scopedCases = cases.filter((reviewCase) => reviewCase.order_id === orderId);
        const activeCases = scopedCases.filter(
          (reviewCase) => !finalCaseStatuses.has(reviewCase.status || "open"),
        );
        const heldPayoutRows = scopedPayoutRows.filter((row) =>
          String(row.payout_status || "").startsWith("hold_"),
        );
        const sellerGrossAmount = scopedItems.reduce(
          (sum, item) =>
            sum + moneyNumber(item.price) * Number(item.quantity || 0),
          0,
        );
        const sellerPayableAmount = scopedPayoutRows.reduce(
          (sum, row) => sum + moneyNumber(row.seller_payable_amount),
          0,
        );
        const platformFeeAmount = scopedPayoutRows.reduce(
          (sum, row) => sum + moneyNumber(row.platform_fee_amount),
          0,
        );
        const sellerProtectionSummary =
          buildUnder20SellerProtectionSellerVisibilitySummary(scopedPayoutRows);
        const scopedRequestEntries = payoutRequestEntries.filter((entry) => {
          const payoutRow = payoutRowsById.get(entry.seller_payout_ledger_entry_id);
          return payoutRow?.order_id === orderId;
        });
        const scopedCashOutRequestMap = new Map<
          string,
          {
            id: string;
            status: string;
            amountRequested: number;
            requestTotal: number;
            requestedAt: string | null;
            completedAt: string | null;
            reviewBlocked: boolean;
            reviewBlockReason: string | null;
            linkedOrderIds: number[];
            activeCaseCount: number;
            blockedLedgerRowCount: number;
            dryRunShippingRowCount: number;
          }
        >();

        for (const entry of scopedRequestEntries) {
          const request = payoutRequestById.get(entry.payout_request_id);

          if (!request) continue;

          const blocker = requestBlockers.get(request.id);
          const existing = scopedCashOutRequestMap.get(request.id);

          if (existing) {
            existing.amountRequested = roundMoney(
              existing.amountRequested + moneyNumber(entry.amount_requested),
            );
            continue;
          }

          scopedCashOutRequestMap.set(request.id, {
            id: request.id,
            status: request.status || "requested",
            amountRequested: moneyNumber(entry.amount_requested),
            requestTotal: moneyNumber(request.requested_amount),
            requestedAt: request.requested_at,
            completedAt: request.completed_at,
            reviewBlocked: blocker?.isBlocked === true,
            reviewBlockReason: reviewBlockReason(blocker),
            linkedOrderIds: (linkedOrderIdsByRequestId.get(request.id) || []).sort(
              (left, right) => left - right,
            ),
            activeCaseCount: blocker?.activeCaseCount || 0,
            blockedLedgerRowCount: blocker?.blockedLedgerRowCount || 0,
            dryRunShippingRowCount: blocker?.dryRunShippingRowCount || 0,
          });
        }

        const scopedCashOutRequests = Array.from(scopedCashOutRequestMap.values()).sort(
          (left, right) => {
            const leftTime = left.requestedAt
              ? new Date(left.requestedAt).getTime()
              : 0;
            const rightTime = right.requestedAt
              ? new Date(right.requestedAt).getTime()
              : 0;
            return rightTime - leftTime;
          },
        );
        const signalCashOutRequests = scopedCashOutRequests.map((request) => ({
          id: request.id,
          status: request.status,
          requestedAt: request.requestedAt,
          completedAt: request.completedAt,
        })) satisfies SellerCashOutRequestSignalRow[];
        const dryRunShipping = isDryRunShippingReference(
          order?.tracking_number || null,
        );
        const safeTrackingNumber = dryRunShipping
          ? null
          : order?.tracking_number || null;
        const safeCarrier = dryRunShipping ? null : order?.carrier || null;
        const recentSignals = buildSellerOrderSignals({
          orderId,
          createdAt: order?.created_at || null,
          paymentStatus: order?.status || "unknown",
          shippedAt: order?.shipped_at || null,
          carrier: safeCarrier,
          trackingNumber: safeTrackingNumber,
          payoutRows: scopedPayoutRows.map((row) => ({
            id: row.id,
            payoutStatus: row.payout_status || "unknown",
            createdAt: row.created_at,
          })),
          cashOutRequests: signalCashOutRequests,
          reviewCases: scopedCases.map((reviewCase) => ({
            id: reviewCase.id,
            title: reviewCase.title || `Order #${orderId} case`,
            status: reviewCase.status || "open",
            severity: reviewCase.severity || "medium",
            caseType: reviewCase.case_type || "other",
            updatedAt: reviewCase.updated_at,
          })),
        });

        return {
          orderId,
          anchor: orderAnchor(orderId),
          createdAt: order?.created_at || null,
          orderTotal: moneyNumber(order?.total),
          paymentStatus: order?.status || "unknown",
          fulfillmentStatus: order?.fulfillment_status || "unknown",
          trackingNumber: safeTrackingNumber,
          carrier: safeCarrier,
          dryRunShippingBlocked: dryRunShipping,
          shippedAt: order?.shipped_at || null,
          sellerItemCount: scopedItems.length,
          sellerUnitCount: scopedItems.reduce(
            (sum, item) => sum + Number(item.quantity || 0),
            0,
          ),
          sellerGrossAmount,
          sellerPayableAmount,
          platformFeeAmount,
          heldPayoutRowCount: heldPayoutRows.length,
          openCashOutRequestCount: openRequestCountByOrderId.get(orderId) || 0,
          activeCaseCount: activeCases.length,
          blockedByReview:
            activeCases.length > 0 || heldPayoutRows.length > 0,
          payoutStatuses: Array.from(
            new Set(scopedPayoutRows.map((row) => row.payout_status || "unknown")),
          ),
          items: scopedItems.map((item) => ({
            sellerProtection:
              buildUnder20SellerProtectionSellerVisibilitySummary(
                scopedPayoutRows.filter((row) => row.order_item_id === item.id),
              ),
            id: item.id,
            title: item.title || "Untitled item",
            quantity: Number(item.quantity || 0),
            price: moneyNumber(item.price),
          })),
          sellerProtection: sellerProtectionSummary,
          cashOutRequests: scopedCashOutRequests,
          cases: activeCases.slice(0, 5).map((reviewCase) => ({
            id: reviewCase.id,
            title: reviewCase.title || `Order #${orderId} case`,
            status: reviewCase.status || "open",
            caseType: reviewCase.case_type || "other",
            severity: reviewCase.severity || "medium",
            updatedAt: reviewCase.updated_at,
          })),
          recentSignals,
        };
      })
      .filter((order) => Boolean(ordersById.get(order.orderId)))
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    const summary = {
      orderCount: orderActivity.length,
      activeCaseCount: orderActivity.reduce(
        (sum, order) => sum + order.activeCaseCount,
        0,
      ),
      heldOrderCount: orderActivity.filter((order) => order.heldPayoutRowCount > 0)
        .length,
      openCashOutRequestCount: orderActivity.reduce(
        (sum, order) => sum + order.openCashOutRequestCount,
        0,
      ),
      sellerPayableAmount: orderActivity.reduce(
        (sum, order) => sum + order.sellerPayableAmount,
        0,
      ),
    };
    const dryRunShippingBlockedCount = orderActivity.filter(
      (order) => order.dryRunShippingBlocked,
    ).length;

    return NextResponse.json(
      {
        success: true,
        summary,
        recentSignals: sortSellerOrderSignals(
          orderActivity.flatMap((order) =>
            order.recentSignals.map((signal) => ({
              ...signal,
              orderId: order.orderId,
              anchor: order.anchor,
            })),
          ),
          10,
        ),
        orders: orderActivity,
      },
      {
        headers: sellerOrdersHeaders({
          ...summary,
          dryRunShippingBlockedCount,
        }),
      },
    );
  } catch (error: any) {
    if (isMissingSellerOrderTables(error)) {
      return NextResponse.json(
        {
          error:
            "Seller order activity is not available until seller payout and order review tables are applied.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: error.message || "Could not load seller order activity" },
      { status: 500 },
    );
  }
}
