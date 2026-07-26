import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { evaluateBuyerProtectionClaimWindow } from "../../../../../lib/buyer-protection";
import { buildLetterTrackDeliveryEvidenceSummary } from "../../../../../lib/lettertrack-delivery-evidence";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function cleanStatement(value: unknown) {
  return String(value || "").trim().slice(0, 1200);
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: protections, error: protectionError } = await supabase
      .from("order_buyer_protections")
      .select(
        "id,order_id,status,fee_amount,covered_item_amount,policy_version,terms_accepted_at,consent_source,preference_mode,shipped_at,earliest_claim_at,claim_deadline_at,created_at",
      )
      .eq("store_id", storeId)
      .eq("account_id", account.id)
      .order("created_at", { ascending: false });

    if (protectionError) throw protectionError;

    const protectionRows = protections || [];
    const orderIds = protectionRows.map((row) => Number(row.order_id));
    const protectionIds = protectionRows.map((row) => String(row.id));
    const [ordersResult, claimsResult] = await Promise.all([
      orderIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("orders")
            .select(
              "id,created_at,total,subtotal,shipping_amount,shipping_method,shipping_name,fulfillment_status,tracking_number,carrier,shipped_at",
            )
            .eq("store_id", storeId)
            .in("id", orderIds),
      protectionIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase
            .from("buyer_protection_claims")
            .select(
              "id,protection_id,order_id,status,reason,buyer_statement,submitted_at,reviewed_at,decision_note,reimbursement_amount,stripe_refund_id,reimbursed_at",
            )
            .eq("store_id", storeId)
            .in("protection_id", protectionIds),
    ]);

    if (ordersResult.error) throw ordersResult.error;
    if (claimsResult.error) throw claimsResult.error;

    const ordersById = new Map(
      (ordersResult.data || []).map((order) => [Number(order.id), order]),
    );
    const claimsByProtectionId = new Map(
      (claimsResult.data || []).map((claim) => [
        String(claim.protection_id),
        claim,
      ]),
    );
    const now = new Date();

    return NextResponse.json({
      success: true,
      protections: protectionRows.map((protection) => ({
        ...protection,
        order: ordersById.get(Number(protection.order_id)) || null,
        claim: claimsByProtectionId.get(String(protection.id)) || null,
        claimWindow: evaluateBuyerProtectionClaimWindow({
          shippedAt: protection.shipped_at,
          earliestClaimAt: protection.earliest_claim_at,
          claimDeadlineAt: protection.claim_deadline_at,
          now,
        }),
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load Buyer Protection claims" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const orderId = Number(body.orderId);
    const statement = cleanStatement(body.statement);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json(
        { error: "A valid protected order is required" },
        { status: 400 },
      );
    }
    if (statement.length < 10) {
      return NextResponse.json(
        { error: "Please describe the missing shipment" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: protection, error: protectionError } = await supabase
      .from("order_buyer_protections")
      .select(
        "id,order_id,status,covered_item_amount,shipped_at,earliest_claim_at,claim_deadline_at",
      )
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .eq("account_id", account.id)
      .single();

    if (protectionError || !protection) {
      return NextResponse.json(
        { error: "Protected order not found" },
        { status: 404 },
      );
    }

    if (protection.status !== "active") {
      return NextResponse.json(
        { error: "A claim already exists or this protection is no longer active" },
        { status: 409 },
      );
    }

    const claimWindow = evaluateBuyerProtectionClaimWindow({
      shippedAt: protection.shipped_at,
      earliestClaimAt: protection.earliest_claim_at,
      claimDeadlineAt: protection.claim_deadline_at,
    });
    if (!claimWindow.eligible) {
      return NextResponse.json(
        { error: claimWindow.detail, claimWindow },
        { status: 409 },
      );
    }

    const { data: trackingEvents, error: trackingError } = await supabase
      .from("order_shipping_tracking_events")
      .select(
        "id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
      )
      .eq("store_id", storeId)
      .eq("order_id", orderId)
      .order("occurred_at", { ascending: true });

    if (trackingError) throw trackingError;
    const evidence = buildLetterTrackDeliveryEvidenceSummary(trackingEvents || []);
    if (evidence.deliveredEvidencePresent) {
      return NextResponse.json(
        {
          error:
            "LetterTrack/USPS evidence shows delivered status. Contact support if the delivery evidence is wrong.",
          evidence,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { data: claim, error: claimError } = await supabase
      .from("buyer_protection_claims")
      .insert({
        store_id: storeId,
        protection_id: protection.id,
        order_id: orderId,
        account_id: account.id,
        status: "submitted",
        reason: "not_received",
        buyer_statement: statement,
        submitted_at: now,
        reimbursement_amount: 0,
        metadata: {
          claim_window: claimWindow,
          lettertrack_evidence_at_submission: evidence,
        },
      })
      .select("*")
      .single();

    if (claimError || !claim) {
      if (claimError?.code === "23505") {
        return NextResponse.json(
          { error: "A claim has already been submitted for this order" },
          { status: 409 },
        );
      }
      throw claimError || new Error("Claim insert failed");
    }

    const { error: updateError } = await supabase
      .from("order_buyer_protections")
      .update({ status: "claim_submitted", updated_at: now })
      .eq("id", protection.id)
      .eq("store_id", storeId)
      .eq("status", "active");
    if (updateError) throw updateError;

    return NextResponse.json({ success: true, claim });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not submit Buyer Protection claim" },
      { status: 500 },
    );
  }
}
