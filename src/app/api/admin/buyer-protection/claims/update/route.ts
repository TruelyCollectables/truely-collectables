import { NextResponse } from "next/server";
import Stripe from "stripe";
import { buildLetterTrackDeliveryEvidenceSummary } from "../../../../../../lib/lettertrack-delivery-evidence";
import {
  getStripeLiveSecretKey,
  getStripeTestSecretKey,
} from "../../../../../../lib/stripe-credentials";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const allowedActions = new Set([
  "under_review",
  "approved",
  "denied",
  "reimbursed",
]);

function cleanNote(value: unknown) {
  return String(value || "").trim().slice(0, 1500);
}

function hasDeliveredOverride(note: string) {
  const normalized = note.toLowerCase();
  return normalized.includes("override") && note.length >= 20;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const claimId = String(body.claimId || "").trim();
    const action = String(body.action || "").trim();
    const note = cleanNote(body.note);

    if (!claimId || !allowedActions.has(action)) {
      return NextResponse.json(
        { error: "A valid claim and action are required" },
        { status: 400 },
      );
    }

    if (["denied", "approved"].includes(action) && note.length < 5) {
      return NextResponse.json(
        { error: "Add a decision note before approving or denying a claim" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: claim, error: claimError } = await supabase
      .from("buyer_protection_claims")
      .select(
        "id,protection_id,order_id,status,submitted_at,reimbursement_amount,stripe_refund_id,metadata",
      )
      .eq("id", claimId)
      .eq("store_id", storeId)
      .single();

    if (claimError || !claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    const { data: protection, error: protectionError } = await supabase
      .from("order_buyer_protections")
      .select(
        "id,status,covered_item_amount,shipped_at,earliest_claim_at,claim_deadline_at",
      )
      .eq("id", claim.protection_id)
      .eq("store_id", storeId)
      .single();
    if (protectionError || !protection) {
      throw protectionError || new Error("Protection record not found");
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id,is_test,stripe_payment_intent_id,stripe_charge_id,customer_email,shipping_amount,subtotal,total",
      )
      .eq("id", claim.order_id)
      .eq("store_id", storeId)
      .single();
    if (orderError || !order) {
      throw orderError || new Error("Order not found");
    }

    const { data: trackingEvents, error: trackingError } = await supabase
      .from("order_shipping_tracking_events")
      .select(
        "id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
      )
      .eq("store_id", storeId)
      .eq("order_id", claim.order_id)
      .order("occurred_at", { ascending: true });
    if (trackingError) throw trackingError;

    const evidence = buildLetterTrackDeliveryEvidenceSummary(
      trackingEvents || [],
    );
    if (
      ["approved", "reimbursed"].includes(action) &&
      evidence.deliveredEvidencePresent &&
      !hasDeliveredOverride(note)
    ) {
      return NextResponse.json(
        {
          error:
            "LetterTrack/USPS delivered evidence is present. Add a detailed note containing the word override only when the evidence is known to be wrong.",
          evidence,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const metadata = {
      ...(claim.metadata || {}),
      latest_admin_action: {
        action,
        note: note || null,
        acted_at: now,
        lettertrack_evidence: evidence,
      },
    };

    if (action === "reimbursed") {
      if (claim.status !== "approved") {
        return NextResponse.json(
          { error: "Approve the claim before issuing reimbursement" },
          { status: 409 },
        );
      }

      if (claim.stripe_refund_id) {
        return NextResponse.json({
          success: true,
          alreadyReimbursed: true,
          refundId: claim.stripe_refund_id,
        });
      }

      const stripeKey = order.is_test
        ? getStripeTestSecretKey()
        : getStripeLiveSecretKey();
      if (!stripeKey) {
        return NextResponse.json(
          {
            error:
              "The matching Stripe credential is unavailable for reimbursement",
          },
          { status: 503 },
        );
      }

      const paymentIntentId = order.stripe_payment_intent_id;
      const chargeId = order.stripe_charge_id;
      if (!paymentIntentId && !chargeId) {
        return NextResponse.json(
          { error: "The order has no Stripe payment reference to refund" },
          { status: 409 },
        );
      }

      const reimbursementAmount = Number(protection.covered_item_amount || 0);
      const refundAmountCents = Math.round(reimbursementAmount * 100);
      if (refundAmountCents <= 0 || refundAmountCents > 2000) {
        return NextResponse.json(
          { error: "Protected reimbursement amount is invalid" },
          { status: 409 },
        );
      }

      const stripe = new Stripe(stripeKey);
      const refund = await stripe.refunds.create(
        {
          ...(paymentIntentId
            ? { payment_intent: paymentIntentId }
            : { charge: chargeId }),
          amount: refundAmountCents,
          reason: "requested_by_customer",
          metadata: {
            store_id: storeId,
            order_id: String(order.id),
            buyer_protection_claim_id: claim.id,
            reimbursement_scope: "item_subtotal_only",
            shipping_refunded: "false",
            protection_fee_refunded: "false",
          },
        },
        {
          idempotencyKey: `truely_buyer_protection_refund_${storeId}_${claim.id}`,
        },
      );

      const { error: refundUpdateError } = await supabase
        .from("buyer_protection_claims")
        .update({
          status: "reimbursed",
          reimbursement_amount: reimbursementAmount,
          stripe_refund_id: refund.id,
          reimbursed_at: now,
          reviewed_at: now,
          decision_note: note || "Approved protected item reimbursement.",
          metadata,
          updated_at: now,
        })
        .eq("id", claim.id)
        .eq("store_id", storeId)
        .eq("status", "approved");
      if (refundUpdateError) throw refundUpdateError;

      const { error: protectionUpdateError } = await supabase
        .from("order_buyer_protections")
        .update({ status: "reimbursed", updated_at: now })
        .eq("id", protection.id)
        .eq("store_id", storeId);
      if (protectionUpdateError) throw protectionUpdateError;

      return NextResponse.json({
        success: true,
        refundId: refund.id,
        reimbursementAmount,
      });
    }

    const protectionStatus =
      action === "denied"
        ? "denied"
        : action === "approved"
          ? "approved"
          : "claim_submitted";
    const { error: updateError } = await supabase
      .from("buyer_protection_claims")
      .update({
        status: action,
        reviewed_at: now,
        decision_note: note || null,
        reimbursement_amount:
          action === "approved"
            ? Number(protection.covered_item_amount || 0)
            : 0,
        metadata,
        updated_at: now,
      })
      .eq("id", claim.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    const { error: protectionUpdateError } = await supabase
      .from("order_buyer_protections")
      .update({ status: protectionStatus, updated_at: now })
      .eq("id", protection.id)
      .eq("store_id", storeId);
    if (protectionUpdateError) throw protectionUpdateError;

    return NextResponse.json({ success: true, status: action });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not update Buyer Protection claim" },
      { status: 500 },
    );
  }
}
