import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getActiveStoreId } from "../../../../lib/stores";
import { getClientIdentity, type ClientIdentity } from "../../../../lib/client-identity";
import { recordOrderReviewCaseEvent } from "../../../../lib/order-review-case-events";
import { recordSellerPayoutAdminEvent } from "../../../../lib/seller-payout-admin-events";

export const dynamic = "force-dynamic";

const caseTypes = new Set([
  "chargeback",
  "return",
  "authenticity",
  "item_not_as_described",
  "payment_risk",
  "shipping_issue",
  "seller_dispute",
  "other",
]);

const caseStatuses = new Set([
  "open",
  "evidence_gathering",
  "waiting_on_buyer",
  "waiting_on_seller",
  "under_review",
  "decided_for_buyer",
  "decided_for_seller",
  "appealed",
  "closed",
]);

const severities = new Set(["low", "medium", "high", "critical"]);
const finalStatuses = new Set([
  "decided_for_buyer",
  "decided_for_seller",
  "closed",
]);
const ledgerStatusesThatCannotBeHeld = new Set([
  "paid",
  "reversed",
  "cancelled",
]);

type OrderRow = {
  id: number;
  status: string | null;
  fulfillment_status: string | null;
};

type OrderReviewCaseRow = {
  id: string;
  order_id: number;
  seller_account_id: string | null;
  status: string | null;
};

type SellerPayoutLedgerRow = {
  id: string;
  seller_account_id: string | null;
  payout_status: string | null;
  metadata?: Record<string, unknown> | null;
};

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanText(value: unknown, maxLength: number) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function parseOrderId(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  return String(value).toLowerCase() === "true";
}

function optionalSellerAccountId(value: unknown) {
  const text = cleanText(value, 100);
  return text && text !== "all" ? text : null;
}

function isMissingCaseTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("order_review_cases") ||
    message.includes("order_review_case_events")
  );
}

async function getOrder(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("orders")
    .select("id,status,fulfillment_status")
    .eq("id", params.orderId)
    .eq("store_id", params.storeId)
    .single();

  if (error || !data) {
    return {
      order: null,
      error: error?.message || "Order not found.",
    };
  }

  return {
    order: data as OrderRow,
    error: null,
  };
}

async function orderContainsSeller(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  sellerAccountId: string;
}) {
  const { data, error } = await params.supabase
    .from("order_items")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId)
    .eq("seller_account_id", params.sellerAccountId)
    .limit(1);

  if (error) throw error;

  return Boolean(data && data.length > 0);
}

async function holdSellerPayoutsForCase(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  caseId: string;
  sellerAccountId: string | null;
  adminNote: string | null;
  identity: ClientIdentity;
}) {
  let query = params.supabase
    .from("seller_payout_ledger_entries")
    .select("id,seller_account_id,payout_status,metadata")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId);

  if (params.sellerAccountId) {
    query = query.eq("seller_account_id", params.sellerAccountId);
  }

  const { data, error } = await query;

  if (error) {
    await recordOrderReviewCaseEvent({
      supabase: params.supabase,
      storeId: params.storeId,
      caseId: params.caseId,
      orderId: params.orderId,
      sellerAccountId: params.sellerAccountId,
      eventType: "seller_payout_hold_skipped",
      note: "Seller payout ledger could not be loaded.",
      identity: params.identity,
      metadata: {
        error: error.message,
      },
    });

    return {
      heldCount: 0,
      skippedCount: 0,
      error: error.message,
    };
  }

  const rows = (data || []) as SellerPayoutLedgerRow[];
  let heldCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const previousStatus = row.payout_status || "hold_pending_fulfillment";

    if (
      previousStatus === "hold_dispute_or_review" ||
      ledgerStatusesThatCannotBeHeld.has(previousStatus)
    ) {
      skippedCount += 1;
      continue;
    }

    const now = new Date().toISOString();
    const metadata = {
      ...(row.metadata || {}),
      latest_order_review_case_hold: {
        case_id: params.caseId,
        previous_status: previousStatus,
        note: params.adminNote,
        held_at: now,
      },
    };

    const { error: updateError } = await params.supabase
      .from("seller_payout_ledger_entries")
      .update({
        payout_status: "hold_dispute_or_review",
        metadata,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("store_id", params.storeId);

    if (updateError) throw updateError;

    heldCount += 1;

    await recordSellerPayoutAdminEvent({
      supabase: params.supabase,
      storeId: params.storeId,
      targetType: "seller_payout_ledger_entry",
      targetId: row.id,
      sellerAccountId: row.seller_account_id,
      eventType: "ledger_status_change",
      previousStatus,
      newStatus: "hold_dispute_or_review",
      adminNote: params.adminNote,
      identity: params.identity,
      metadata: {
        order_review_case_id: params.caseId,
        automated_by: "order_review_case",
      },
    });
  }

  await recordOrderReviewCaseEvent({
    supabase: params.supabase,
    storeId: params.storeId,
    caseId: params.caseId,
    orderId: params.orderId,
    sellerAccountId: params.sellerAccountId,
    eventType:
      heldCount > 0
        ? "seller_payout_hold_applied"
        : "seller_payout_hold_skipped",
    note:
      heldCount > 0
        ? `Held ${heldCount} seller payout ledger row(s).`
        : "No seller payout ledger rows were eligible for a new hold.",
    identity: params.identity,
    metadata: {
      held_count: heldCount,
      skipped_count: skippedCount,
    },
  });

  return {
    heldCount,
    skippedCount,
    error: null,
  };
}

async function applyFulfillmentHold(params: {
  supabase: SupabaseClient;
  storeId: string;
  order: OrderRow;
  caseId: string;
  sellerAccountId: string | null;
  identity: ClientIdentity;
}) {
  if (
    params.order.fulfillment_status &&
    params.order.fulfillment_status !== "ready_to_ship"
  ) {
    return false;
  }

  const { error } = await params.supabase
    .from("orders")
    .update({
      fulfillment_status: "shipping_review",
    })
    .eq("id", params.order.id)
    .eq("store_id", params.storeId);

  if (error) throw error;

  await recordOrderReviewCaseEvent({
    supabase: params.supabase,
    storeId: params.storeId,
    caseId: params.caseId,
    orderId: params.order.id,
    sellerAccountId: params.sellerAccountId,
    eventType: "fulfillment_hold_applied",
    previousStatus: params.order.fulfillment_status || "ready_to_ship",
    newStatus: "shipping_review",
    note: "Order fulfillment moved into shipping review.",
    identity: params.identity,
  });

  return true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = parseOrderId(body.orderId);
    const caseType = String(body.caseType || "").trim();
    const severity = String(body.severity || "medium").trim();
    const sellerAccountId = optionalSellerAccountId(body.sellerAccountId);
    const title = cleanText(body.title, 200);
    const description = cleanText(body.description, 5000);
    const holdSellerPayouts = parseBoolean(body.holdSellerPayouts, true);
    const holdOrderFulfillment = parseBoolean(body.holdOrderFulfillment, false);

    if (!orderId || !caseTypes.has(caseType) || !severities.has(severity)) {
      return Response.json(
        { error: "Missing order id, case type, or severity." },
        { status: 400 },
      );
    }

    if (!title) {
      return Response.json(
        { error: "Case title is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const { order, error: orderError } = await getOrder({
      supabase,
      storeId,
      orderId,
    });

    if (!order) {
      return Response.json({ error: orderError }, { status: 404 });
    }

    if (
      sellerAccountId &&
      !(await orderContainsSeller({
        supabase,
        storeId,
        orderId,
        sellerAccountId,
      }))
    ) {
      return Response.json(
        {
          error:
            "That seller account is not tied to an order item on this order.",
        },
        { status: 400 },
      );
    }

    const { data: reviewCase, error: insertError } = await supabase
      .from("order_review_cases")
      .insert({
        store_id: storeId,
        order_id: orderId,
        seller_account_id: sellerAccountId,
        case_type: caseType,
        severity,
        title,
        description,
        hold_seller_payouts: holdSellerPayouts,
        hold_order_fulfillment: holdOrderFulfillment,
        metadata: {
          opened_from: "admin_order_detail",
          order_status_at_open: order.status,
          fulfillment_status_at_open: order.fulfillment_status,
        },
      })
      .select("id,order_id,seller_account_id,status")
      .single();

    if (insertError || !reviewCase) {
      const status = insertError && isMissingCaseTable(insertError) ? 503 : 500;
      return Response.json(
        {
          error:
            insertError?.message ||
            "Could not create order review case.",
        },
        { status },
      );
    }

    const typedCase = reviewCase as OrderReviewCaseRow;

    await recordOrderReviewCaseEvent({
      supabase,
      storeId,
      caseId: typedCase.id,
      orderId,
      sellerAccountId,
      eventType: "case_created",
      newStatus: typedCase.status || "open",
      note: description || title,
      identity,
      metadata: {
        case_type: caseType,
        severity,
        hold_seller_payouts: holdSellerPayouts,
        hold_order_fulfillment: holdOrderFulfillment,
      },
    });

    const payoutHold = holdSellerPayouts
      ? await holdSellerPayoutsForCase({
          supabase,
          storeId,
          orderId,
          caseId: typedCase.id,
          sellerAccountId,
          adminNote: title,
          identity,
        })
      : { heldCount: 0, skippedCount: 0, error: null };

    const fulfillmentHeld = holdOrderFulfillment
      ? await applyFulfillmentHold({
          supabase,
          storeId,
          order,
          caseId: typedCase.id,
          sellerAccountId,
          identity,
        })
      : false;

    return Response.json({
      success: true,
      caseId: typedCase.id,
      sellerPayoutRowsHeld: payoutHold.heldCount,
      sellerPayoutRowsSkipped: payoutHold.skippedCount,
      sellerPayoutHoldError: payoutHold.error,
      fulfillmentHeld,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not create order review case." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const caseId = cleanText(body.caseId, 100);
    const status = String(body.status || "").trim();
    const adminNote = cleanText(body.adminNote, 1000);
    const outcomeSummary = cleanText(body.outcomeSummary, 5000);

    if (!caseId || !caseStatuses.has(status)) {
      return Response.json(
        { error: "Missing case id or valid case status." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const { data: existingCase, error: lookupError } = await supabase
      .from("order_review_cases")
      .select("id,order_id,seller_account_id,status")
      .eq("id", caseId)
      .eq("store_id", storeId)
      .single();

    if (lookupError || !existingCase) {
      const responseStatus =
        lookupError && isMissingCaseTable(lookupError) ? 503 : 404;
      return Response.json(
        {
          error:
            lookupError?.message ||
            "Order review case not found.",
        },
        { status: responseStatus },
      );
    }

    const typedCase = existingCase as OrderReviewCaseRow;
    const previousStatus = typedCase.status || "open";
    const now = new Date().toISOString();
    const updatePatch: Record<string, unknown> = {
      status,
      updated_at: now,
    };

    if (outcomeSummary !== null) {
      updatePatch.outcome_summary = outcomeSummary;
    }

    if (finalStatuses.has(status)) {
      updatePatch.closed_at = now;
    } else {
      updatePatch.closed_at = null;
    }

    const { error: updateError } = await supabase
      .from("order_review_cases")
      .update(updatePatch)
      .eq("id", caseId)
      .eq("store_id", storeId);

    if (updateError) {
      const responseStatus = isMissingCaseTable(updateError) ? 503 : 500;
      return Response.json({ error: updateError.message }, { status: responseStatus });
    }

    await recordOrderReviewCaseEvent({
      supabase,
      storeId,
      caseId,
      orderId: typedCase.order_id,
      sellerAccountId: typedCase.seller_account_id,
      eventType:
        status === previousStatus ? "case_note_added" : "case_status_change",
      previousStatus,
      newStatus: status,
      note: adminNote || outcomeSummary,
      identity,
      metadata: {
        outcome_summary: outcomeSummary,
      },
    });

    return Response.json({
      success: true,
      caseId,
      status,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not update order review case." },
      { status: 500 },
    );
  }
}
