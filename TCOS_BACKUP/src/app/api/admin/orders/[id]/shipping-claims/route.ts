import { getClientIdentity } from "../../../../../../lib/client-identity";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const openClaimStatuses = new Set(["draft", "submitted", "under_review"]);

type ShippingLabelRow = {
  id: string;
  provider: string | null;
  coverage_provider: string | null;
  coverage_amount: number | string | null;
  coverage_status: string | null;
};

type CoverageClaimRow = {
  id: string;
  claim_status: string | null;
};

async function activeLabelForOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_labels")
    .select("id,provider,coverage_provider,coverage_amount,coverage_status")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId)
    .not("label_status", "in", "(voided,failed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return (data || null) as ShippingLabelRow | null;
}

async function existingOpenClaim(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_coverage_claims")
    .select("id,claim_status")
    .eq("store_id", params.storeId)
    .eq("order_id", params.orderId)
    .in("claim_status", Array.from(openClaimStatuses))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return (data || null) as CoverageClaimRow | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const orderId = Number(id);

    if (!orderId) {
      return Response.json({ error: "Missing order id." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);
    const existingClaim = await existingOpenClaim({ supabase, storeId, orderId });

    if (existingClaim?.id) {
      return Response.json({
        success: true,
        reused: true,
        claimId: existingClaim.id,
        claimStatus: existingClaim.claim_status,
      });
    }

    const label = await activeLabelForOrder({ supabase, storeId, orderId });

    if (!label?.id) {
      return Response.json(
        {
          error:
            "Prepare a shipping label and coverage record before opening a coverage claim.",
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const { data: claim, error: claimError } = await supabase
      .from("order_shipping_coverage_claims")
      .insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider: label.coverage_provider || "Coverage",
        claim_status: "draft",
        claim_type: "shipment_loss_or_damage",
        claim_amount: Number(label.coverage_amount || 0),
        reason:
          "Draft opened from TCOS admin. Add carrier evidence, buyer communication, and provider claim details before submission.",
        metadata: {
          opened_from: "admin_order_shipping_cockpit",
          opened_at: now,
          opened_by_identity: identity,
          label_provider: label.provider,
          label_coverage_status: label.coverage_status,
        },
      })
      .select("id,claim_status")
      .single();

    if (claimError || !claim) {
      return Response.json(
        { error: claimError?.message || "Could not open coverage claim." },
        { status: 500 },
      );
    }

    await supabase.from("order_shipping_tracking_events").insert({
      store_id: storeId,
      order_id: orderId,
      shipping_label_id: label.id,
      provider: label.coverage_provider || "Coverage",
      event_type: "coverage_claim_draft_opened",
      event_status: "draft",
      message:
        "Coverage claim draft opened in TCOS. Provider submission is still required.",
      occurred_at: now,
      raw_payload: {
        claim_id: claim.id,
        claim_amount: Number(label.coverage_amount || 0),
        opened_by_identity: identity,
      },
    });

    return Response.json({
      success: true,
      reused: false,
      claimId: claim.id,
      claimStatus: claim.claim_status,
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not open coverage claim." },
      { status: 500 },
    );
  }
}
