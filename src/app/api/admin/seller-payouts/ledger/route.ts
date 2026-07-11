import { getActiveStoreId } from "../../../../../lib/stores";
import { getClientIdentity } from "../../../../../lib/client-identity";
import { isOrderReviewStatus } from "../../../../../lib/order-status";
import { recordSellerPayoutAdminEvent } from "../../../../../lib/seller-payout-admin-events";
import { isDryRunShippingReference } from "../../../../../lib/shipping-dry-run";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const allowedStatuses = new Set([
  "hold_pending_fulfillment",
  "hold_dispute_or_review",
  "eligible",
  "reversed",
  "cancelled",
]);

const committedRequestStatuses = new Set([
  "requested",
  "approved",
  "processing",
  "paid",
]);

type SellerPayoutLedgerRow = {
  id: string;
  seller_account_id: string | null;
  order_id: number;
  payout_status: string | null;
  metadata?: Record<string, unknown> | null;
};

type OrderRow = {
  id: number;
  status: string | null;
  fulfillment_status: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
};

type OrderReviewCaseRow = {
  id: string;
  status: string | null;
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
  supabase: ReturnType<typeof getSupabaseClient>;
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

function isActiveReviewCase(status: string | null | undefined) {
  return !["decided_for_buyer", "decided_for_seller", "closed"].includes(
    status || "open",
  );
}

async function payoutReleaseBlockReason(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  storeId: string;
  orderId: number;
}) {
  const { data: order, error: orderError } = await params.supabase
    .from("orders")
    .select("id,status,fulfillment_status,shipped_at,tracking_number")
    .eq("id", params.orderId)
    .eq("store_id", params.storeId)
    .single();

  if (orderError || !order) {
    return orderError?.message || "Order could not be verified before payout release.";
  }

  const typedOrder = order as OrderRow;
  if (isOrderReviewStatus(typedOrder.status, typedOrder.fulfillment_status)) {
    return "Order is still on payment, inventory, or shipping review.";
  }

  if (typedOrder.fulfillment_status !== "shipped" || !typedOrder.shipped_at) {
    return "Order must be marked shipped before seller payout can be released.";
  }

  if (isDryRunShippingReference(typedOrder.tracking_number)) {
    return "Order only has TCOS dry-run shipping. Add real carrier proof before seller payout can be released.";
  }

  const { data: cases, error: caseError } = await params.supabase
    .from("order_review_cases")
    .select("id,status")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId);

  if (caseError) throw caseError;

  const activeCaseCount = ((cases || []) as OrderReviewCaseRow[]).filter(
    (reviewCase) => isActiveReviewCase(reviewCase.status),
  ).length;

  if (activeCaseCount > 0) {
    return `${activeCaseCount} active order review case(s) must be resolved before seller payout release.`;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ledgerEntryId = String(body.ledgerEntryId || "").trim();
    const status = String(body.status || "").trim();
    const adminNote = cleanAdminNote(body.adminNote);

    if (!ledgerEntryId || !allowedStatuses.has(status)) {
      return Response.json(
        { error: "Missing seller payout ledger id or valid status." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: ledgerEntry, error: lookupError } = await supabase
      .from("seller_payout_ledger_entries")
      .select("id,seller_account_id,order_id,payout_status,metadata")
      .eq("id", ledgerEntryId)
      .eq("store_id", storeId)
      .single();

    if (lookupError || !ledgerEntry) {
      return Response.json(
        { error: lookupError?.message || "Seller payout ledger row not found." },
        { status: 404 },
      );
    }

    const typedLedgerEntry = ledgerEntry as SellerPayoutLedgerRow;
    const currentStatus =
      typedLedgerEntry.payout_status || "hold_pending_fulfillment";

    if (
      status !== "eligible" &&
      status !== currentStatus &&
      (await hasCommittedPayoutRequest({
        supabase,
        storeId,
        ledgerEntryId,
      }))
    ) {
      return Response.json(
        {
          error:
            "This seller payout row is already tied to an active or paid cash-out request.",
        },
        { status: 409 },
      );
    }

    if (status === "eligible") {
      const releaseBlockReason = await payoutReleaseBlockReason({
        supabase,
        storeId,
        orderId: typedLedgerEntry.order_id,
      });

      if (releaseBlockReason) {
        return Response.json(
          {
            error: releaseBlockReason,
            orderId: typedLedgerEntry.order_id,
          },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();
    const metadata = {
      ...(typedLedgerEntry.metadata || {}),
      latest_admin_status_change: {
        status,
        previous_status: currentStatus,
        note: adminNote,
        changed_at: now,
      },
    };

    const { error: updateError } = await supabase
      .from("seller_payout_ledger_entries")
      .update({
        payout_status: status,
        metadata,
        updated_at: now,
      })
      .eq("id", ledgerEntryId)
      .eq("store_id", storeId);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const identity = await getClientIdentity(request);
    await recordSellerPayoutAdminEvent({
      supabase,
      storeId,
      targetType: "seller_payout_ledger_entry",
      targetId: ledgerEntryId,
      sellerAccountId: typedLedgerEntry.seller_account_id,
      eventType: "ledger_status_change",
      previousStatus: currentStatus,
      newStatus: status,
      adminNote,
      identity,
      metadata: {
        had_committed_payout_request: status !== "eligible" && status !== currentStatus,
      },
    });

    return Response.json({
      success: true,
      ledgerEntryId,
      status,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not update seller payout ledger row." },
      { status: 500 },
    );
  }
}
