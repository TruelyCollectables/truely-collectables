import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  getStripeLiveSecretKey,
  getStripeTestSecretKey,
} from "../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";

function cleanReason(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const orderId = Number(body?.orderId);
    const reason = cleanReason(body?.reason);
    const confirmed = body?.confirmed === true;

    if (!orderId || !Number.isInteger(orderId)) {
      return NextResponse.json(
        { error: "A valid order ID is required." },
        { status: 400 },
      );
    }

    if (reason.length < 10) {
      return NextResponse.json(
        { error: "Enter at least 10 characters explaining why the order is being cancelled." },
        { status: 400 },
      );
    }

    if (!confirmed) {
      return NextResponse.json(
        { error: "Confirm that this action will issue a full refund and cancel fulfillment." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id,total,status,payment_status,refund_status,amount_refunded,fulfillment_status,shipped_at,stripe_payment_intent_id,stripe_charge_id,is_test,customer_notes",
      )
      .eq("id", orderId)
      .eq("store_id", storeId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const orderTotal = Number(order.total || 0);
    const alreadyRefunded = Number(order.amount_refunded || 0);
    const fullyRefunded =
      String(order.payment_status || "").toLowerCase() === "refunded" ||
      (orderTotal > 0 && alreadyRefunded >= orderTotal - 0.01);

    if (fullyRefunded) {
      return NextResponse.json(
        { error: "This order has already been fully refunded." },
        { status: 409 },
      );
    }

    if (
      order.shipped_at ||
      String(order.fulfillment_status || "").toLowerCase() === "shipped"
    ) {
      return NextResponse.json(
        {
          error:
            "This order is already marked shipped. Resolve the shipment or return before issuing an unfulfilled-order refund.",
        },
        { status: 409 },
      );
    }

    const paymentIntentId = String(order.stripe_payment_intent_id || "").trim();
    const chargeId = String(order.stripe_charge_id || "").trim();

    if (!paymentIntentId && !chargeId) {
      return NextResponse.json(
        { error: "This order does not have a refundable Stripe payment reference." },
        { status: 409 },
      );
    }

    const stripeKey = order.is_test
      ? getStripeTestSecretKey()
      : getStripeLiveSecretKey();

    if (!stripeKey) {
      return NextResponse.json(
        {
          error: order.is_test
            ? "The Stripe test secret key is not configured."
            : "The Stripe live secret key is not configured.",
        },
        { status: 503 },
      );
    }

    const stripe = new Stripe(stripeKey);
    const refund = await stripe.refunds.create(
      {
        ...(paymentIntentId
          ? { payment_intent: paymentIntentId }
          : { charge: chargeId }),
        metadata: {
          order_id: String(orderId),
          store_id: storeId,
          initiated_by: "tcos_admin",
          cancellation_reason: reason,
          inventory_restore: "false",
        },
      },
      {
        idempotencyKey: `admin_full_refund_${storeId}_${orderId}`,
      },
    );

    const refundStatus = String(refund.status || "pending");
    const refundAmount = Number(refund.amount || 0) / 100;
    const now = new Date().toISOString();
    const existingNotes = String(order.customer_notes || "").trim();
    const cancellationNote = `[${now}] Admin cancellation/refund reason: ${reason}`;
    const nextNotes = existingNotes
      ? `${existingNotes}\n${cancellationNote}`
      : cancellationNote;
    const succeeded = refundStatus === "succeeded";

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        status: succeeded ? "refunded" : "cancelled",
        payment_status: succeeded ? "refunded" : order.payment_status,
        refund_status: refundStatus,
        amount_refunded: succeeded
          ? Math.max(alreadyRefunded, refundAmount)
          : alreadyRefunded,
        fulfillment_status: "cancelled",
        customer_notes: nextNotes,
        last_payment_event_at: now,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    if (updateError) throw updateError;

    const { error: payoutHoldError } = await supabase
      .from("seller_payout_ledger_entries")
      .update({
        payout_status: "hold_dispute_or_review",
        updated_at: now,
      })
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .in("payout_status", [
        "hold_pending_fulfillment",
        "eligible",
        "hold_dispute_or_review",
      ]);

    if (payoutHoldError) throw payoutHoldError;

    return NextResponse.json({
      success: true,
      orderId,
      refundId: refund.id,
      refundStatus,
      refundAmount,
      fullRefundRequested: true,
      fulfillmentCancelled: true,
      inventoryRestored: false,
      reason,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unable to refund this order." },
      { status: 500 },
    );
  }
}
