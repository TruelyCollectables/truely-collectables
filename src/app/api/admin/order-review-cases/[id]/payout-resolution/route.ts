import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientIdentity } from "../../../../../../lib/client-identity";
import { isOrderReviewStatus } from "../../../../../../lib/order-status";
import { recordOrderReviewCaseEvent } from "../../../../../../lib/order-review-case-events";
import { recordSellerPayoutAdminEvent } from "../../../../../../lib/seller-payout-admin-events";
import { isDryRunShippingReference } from "../../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const committedRequestStatuses = new Set([
  "requested",
  "approved",
  "processing",
  "paid",
]);

const terminalLedgerStatuses = new Set(["paid", "reversed", "cancelled"]);

const resolutionActions = {
  release_to_seller: {
    targetStatus: "eligible",
    allowedCaseStatuses: new Set(["decided_for_seller", "closed"]),
    label: "Release held payout rows to seller eligibility",
  },
  reverse_for_buyer: {
    targetStatus: "reversed",
    allowedCaseStatuses: new Set(["decided_for_buyer", "closed"]),
    label: "Reverse held payout rows after buyer-favorable decision",
  },
  cancel_no_payout: {
    targetStatus: "cancelled",
    allowedCaseStatuses: new Set(["decided_for_buyer", "closed"]),
    label: "Cancel held payout rows with no seller payout",
  },
  hold_for_appeal: {
    targetStatus: "hold_dispute_or_review",
    allowedCaseStatuses: new Set([
      "open",
      "evidence_gathering",
      "waiting_on_buyer",
      "waiting_on_seller",
      "under_review",
      "decided_for_buyer",
      "decided_for_seller",
      "appealed",
      "closed",
    ]),
    label: "Keep related payout rows held for appeal or continued review",
  },
} as const;

type ResolutionAction = keyof typeof resolutionActions;

type OrderReviewCaseRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  status: string | null;
};

type OrderRow = {
  id: number;
  status: string | null;
  fulfillment_status: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
};

type SellerPayoutLedgerRow = {
  id: string;
  seller_account_id: string | null;
  payout_status: string | null;
  seller_payable_amount: number | string | null;
  metadata?: Record<string, unknown> | null;
};

type PayoutRequestEntryRow = {
  payout_request_id: string;
};

type PayoutRequestRow = {
  id: string;
  status: string | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanAdminNote(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, 1000) : null;
}

function isMissingRequestEntryTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    message.includes("seller_payout_request_entries") ||
    message.includes("seller_payout_requests")
  );
}

async function hasCommittedPayoutRequest(params: {
  supabase: SupabaseClient;
  storeId: string;
  ledgerEntryId: string;
}) {
  const { data: requestEntries, error: entryError } = await params.supabase
    .from("seller_payout_request_entries")
    .select("payout_request_id")
    .eq("store_id", params.storeId)
    .eq("seller_payout_ledger_entry_id", params.ledgerEntryId);

  if (entryError) {
    if (isMissingRequestEntryTable(entryError)) return false;
    throw entryError;
  }

  const payoutRequestIds = Array.from(
    new Set(
      ((requestEntries || []) as PayoutRequestEntryRow[]).map(
        (entry) => entry.payout_request_id,
      ),
    ),
  );

  if (payoutRequestIds.length === 0) return false;

  const { data: payoutRequests, error: requestError } = await params.supabase
    .from("seller_payout_requests")
    .select("id,status")
    .eq("store_id", params.storeId)
    .in("id", payoutRequestIds);

  if (requestError) {
    if (isMissingRequestEntryTable(requestError)) return false;
    throw requestError;
  }

  return ((payoutRequests || []) as PayoutRequestRow[]).some((request) =>
    committedRequestStatuses.has(request.status || "requested"),
  );
}

async function loadScopedLedgerRows(params: {
  supabase: SupabaseClient;
  storeId: string;
  reviewCase: OrderReviewCaseRow;
}) {
  let query = params.supabase
    .from("seller_payout_ledger_entries")
    .select("id,seller_account_id,payout_status,seller_payable_amount,metadata")
    .eq("store_id", params.storeId)
    .eq("order_id", params.reviewCase.order_id);

  if (params.reviewCase.seller_account_id) {
    query = query.eq("seller_account_id", params.reviewCase.seller_account_id);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data || []) as SellerPayoutLedgerRow[];
}

async function payoutReleaseBlockReason(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
}) {
  const { data: order, error } = await params.supabase
    .from("orders")
    .select("id,status,fulfillment_status,shipped_at,tracking_number")
    .eq("id", params.orderId)
    .eq("store_id", params.storeId)
    .single();

  if (error || !order) {
    return error?.message || "order_not_verified";
  }

  const typedOrder = order as OrderRow;
  if (isOrderReviewStatus(typedOrder.status, typedOrder.fulfillment_status)) {
    return "order_still_in_review";
  }

  if (typedOrder.fulfillment_status !== "shipped" || !typedOrder.shipped_at) {
    return "order_not_shipped";
  }

  if (isDryRunShippingReference(typedOrder.tracking_number)) {
    return "order_has_dry_run_shipping_only";
  }

  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const caseId = String(id || "").trim();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim() as ResolutionAction;
    const adminNote = cleanAdminNote(body.adminNote);
    const resolution = resolutionActions[action];

    if (!caseId || !resolution) {
      return Response.json(
        {
          error:
            "Missing order review case id or valid payout resolution action.",
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const { data: reviewCaseData, error: caseError } = await supabase
      .from("order_review_cases")
      .select("id,order_id,seller_account_id,status")
      .eq("id", caseId)
      .eq("store_id", storeId)
      .single();

    if (caseError || !reviewCaseData) {
      return Response.json(
        { error: caseError?.message || "Order review case not found." },
        { status: 404 },
      );
    }

    const reviewCase = reviewCaseData as OrderReviewCaseRow;
    const caseStatus = reviewCase.status || "open";

    if (!resolution.allowedCaseStatuses.has(caseStatus)) {
      return Response.json(
        {
          error: `Case must be one of ${Array.from(
            resolution.allowedCaseStatuses,
          ).join(", ")} before this payout resolution can be applied.`,
        },
        { status: 409 },
      );
    }

    const ledgerRows = await loadScopedLedgerRows({
      supabase,
      storeId,
      reviewCase,
    });
    const releaseBlockReason =
      resolution.targetStatus === "eligible"
        ? await payoutReleaseBlockReason({
            supabase,
            storeId,
            orderId: reviewCase.order_id,
          })
        : null;
    let changedCount = 0;
    let skippedCount = 0;
    let changedAmount = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const row of ledgerRows) {
      const previousStatus = row.payout_status || "hold_pending_fulfillment";

      if (previousStatus === resolution.targetStatus) {
        skippedCount += 1;
        skipped.push({ id: row.id, reason: "already_target_status" });
        continue;
      }

      if (
        terminalLedgerStatuses.has(previousStatus) &&
        resolution.targetStatus !== previousStatus
      ) {
        skippedCount += 1;
        skipped.push({ id: row.id, reason: `terminal_${previousStatus}` });
        continue;
      }

      if (releaseBlockReason && resolution.targetStatus === "eligible") {
        skippedCount += 1;
        skipped.push({ id: row.id, reason: releaseBlockReason });
        continue;
      }

      if (
        resolution.targetStatus !== "eligible" &&
        (await hasCommittedPayoutRequest({
          supabase,
          storeId,
          ledgerEntryId: row.id,
        }))
      ) {
        skippedCount += 1;
        skipped.push({
          id: row.id,
          reason: "active_or_paid_cash_out_request",
        });
        continue;
      }

      const now = new Date().toISOString();
      const metadata = {
        ...(row.metadata || {}),
        latest_order_review_case_resolution: {
          case_id: reviewCase.id,
          action,
          target_status: resolution.targetStatus,
          previous_status: previousStatus,
          note: adminNote,
          resolved_at: now,
        },
      };
      const { error: updateError } = await supabase
        .from("seller_payout_ledger_entries")
        .update({
          payout_status: resolution.targetStatus,
          metadata,
          updated_at: now,
        })
        .eq("id", row.id)
        .eq("store_id", storeId);

      if (updateError) {
        throw updateError;
      }

      changedCount += 1;
      changedAmount += Number(row.seller_payable_amount || 0);

      await recordSellerPayoutAdminEvent({
        supabase,
        storeId,
        targetType: "seller_payout_ledger_entry",
        targetId: row.id,
        sellerAccountId: row.seller_account_id,
        eventType: "ledger_status_change",
        previousStatus,
        newStatus: resolution.targetStatus,
        adminNote,
        identity,
        metadata: {
          order_review_case_id: reviewCase.id,
          order_id: reviewCase.order_id,
          payout_resolution_action: action,
          automated_by: "order_review_case_resolution",
        },
      });
    }

    const note =
      adminNote ||
      `${resolution.label}. Changed ${changedCount} row(s), skipped ${skippedCount}.`;

    await recordOrderReviewCaseEvent({
      supabase,
      storeId,
      caseId: reviewCase.id,
      orderId: reviewCase.order_id,
      sellerAccountId: reviewCase.seller_account_id,
      eventType: "case_note_added",
      previousStatus: caseStatus,
      newStatus: caseStatus,
      note,
      identity,
      metadata: {
        payout_resolution_action: action,
        target_payout_status: resolution.targetStatus,
        changed_count: changedCount,
        skipped_count: skippedCount,
        changed_amount: changedAmount,
        skipped,
      },
    });

    return Response.json({
      success: true,
      caseId: reviewCase.id,
      action,
      targetStatus: resolution.targetStatus,
      changedCount,
      skippedCount,
      changedAmount,
      skipped,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not resolve case payout rows." },
      { status: 500 },
    );
  }
}
