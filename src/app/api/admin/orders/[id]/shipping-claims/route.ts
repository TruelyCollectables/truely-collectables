import { getClientIdentity } from "../../../../../../lib/client-identity";
import { isDryRunShippingLabel } from "../../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import {
  buildLetterTrackDeliveryEvidenceSummary,
  type LetterTrackDeliveryEvidenceEvent,
  type LetterTrackDeliveryEvidenceSummary,
} from "../../../../../../lib/lettertrack-delivery-evidence";
import {
  buildUnder20SellerProtectionClaimSummary,
  type Under20SellerProtectionClaimSummary,
  type Under20SellerProtectionLedgerRow,
} from "../../../../../../lib/under20-seller-protection-claims";

export const dynamic = "force-dynamic";

const openClaimStatuses = new Set(["draft", "submitted", "under_review"]);

type ShippingLabelRow = {
  id: string;
  provider: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  coverage_provider: string | null;
  coverage_policy_id: string | null;
  coverage_amount: number | string | null;
  coverage_status: string | null;
  resolved_shipping_method: string | null;
  service_level: string | null;
  metadata: Record<string, unknown> | null;
};

type CoverageClaimRow = {
  id: string;
  claim_status: string | null;
};

function under20ClaimReason(params: {
  summary: Under20SellerProtectionClaimSummary;
  letterTrackDeliveryEvidence: LetterTrackDeliveryEvidenceSummary;
}) {
  const { summary, letterTrackDeliveryEvidence } = params;

  if (!summary.eligible) {
    return "Draft opened from TCOS admin for under-$20 Standard Envelope seller-liability review. Seller did not opt into TCOS protection, so TCOS reimbursement is $0 and seller is responsible for buyer refund.";
  }

  if (letterTrackDeliveryEvidence.deliveredEvidencePresent) {
    return "Draft opened from TCOS admin for an opted-in under-$20 Standard Envelope seller-protection review, but LetterTrack/USPS IMb delivered evidence is present. Do not pay the seller-protection reimbursement unless an operator documents an override reason.";
  }

  if (letterTrackDeliveryEvidence.claimReviewSupported) {
    return "Draft opened from TCOS admin for an opted-in under-$20 Standard Envelope seller-protection reimbursement. LetterTrack/USPS IMb evidence currently supports not-delivered, exception, or returned review; buyer refund evidence must still be confirmed before payout.";
  }

  return "Draft opened from TCOS admin for an opted-in under-$20 Standard Envelope seller-protection reimbursement. Buyer refund evidence and LetterTrack/USPS IMb delivery-evidence failure must be confirmed before payout.";
}

function hasExternalCoverageRecord(label: ShippingLabelRow) {
  return label.coverage_status === "covered" && Boolean(label.coverage_policy_id);
}

async function activeLabelForOrder(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  orderId: number;
}) {
  const { data, error } = await params.supabase
    .from("order_shipping_labels")
    .select(
      "id,provider,provider_label_id,provider_shipment_id,tracking_number,coverage_provider,coverage_policy_id,coverage_amount,coverage_status,resolved_shipping_method,service_level,metadata",
    )
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

    if (isDryRunShippingLabel(label)) {
      return Response.json(
        {
          error:
            "TCOS dry-run labels do not have real external Coverage policies. Record a real label and policy before opening a coverage claim.",
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const isStandardEnvelope =
      label.resolved_shipping_method === "STANDARD_ENVELOPE" ||
      label.service_level === "STANDARD_ENVELOPE";

    if (!isStandardEnvelope && !hasExternalCoverageRecord(label)) {
      return Response.json(
        {
          error:
            "Record a real Coverage policy before opening a provider coverage claim.",
        },
        { status: 409 },
      );
    }

    const { data: payoutRows, error: payoutRowsError } =
      isStandardEnvelope
        ? await supabase
            .from("seller_payout_ledger_entries")
            .select(
              "id,seller_account_id,gross_item_amount,shipping_allocated_amount,metadata",
            )
            .eq("store_id", storeId)
            .eq("order_id", orderId)
        : { data: [], error: null };

    if (payoutRowsError) throw payoutRowsError;

    const under20ProtectionSummary = isStandardEnvelope
      ? buildUnder20SellerProtectionClaimSummary(
          (payoutRows || []) as Under20SellerProtectionLedgerRow[],
        )
      : null;
    const { data: letterTrackEvents, error: letterTrackEventsError } =
      isStandardEnvelope
        ? await supabase
            .from("order_shipping_tracking_events")
            .select(
              "id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
            )
            .eq("store_id", storeId)
            .eq("order_id", orderId)
            .eq("shipping_label_id", label.id)
            .order("occurred_at", { ascending: true })
            .limit(50)
        : { data: [], error: null };

    if (letterTrackEventsError) throw letterTrackEventsError;

    const letterTrackDeliveryEvidence = isStandardEnvelope
      ? buildLetterTrackDeliveryEvidenceSummary(
          (letterTrackEvents || []) as LetterTrackDeliveryEvidenceEvent[],
        )
      : null;
    const claimAmount = under20ProtectionSummary
      ? under20ProtectionSummary.reimbursableItemAmount
      : Number(label.coverage_amount || 0);
    const claimProvider = under20ProtectionSummary
      ? under20ProtectionSummary.program
      : label.coverage_provider || "Coverage";
    const claimReason = under20ProtectionSummary
      ? under20ClaimReason({
          summary: under20ProtectionSummary,
          letterTrackDeliveryEvidence: letterTrackDeliveryEvidence!,
        })
      : "Draft opened from TCOS admin. Add carrier evidence, buyer communication, and provider claim details before submission.";
    const { data: claim, error: claimError } = await supabase
      .from("order_shipping_coverage_claims")
      .insert({
        store_id: storeId,
        order_id: orderId,
        shipping_label_id: label.id,
        provider: claimProvider,
        claim_status: "draft",
        claim_type: "shipment_loss_or_damage",
        claim_amount: claimAmount,
        reason: claimReason,
        metadata: {
          opened_from: "admin_order_shipping_cockpit",
          opened_at: now,
          opened_by_identity: identity,
          label_provider: label.provider,
          label_coverage_status: label.coverage_status,
          under_20_seller_protection_claim: under20ProtectionSummary,
          lettertrack_delivery_evidence: letterTrackDeliveryEvidence,
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
        claim_amount: claimAmount,
        under_20_seller_protection_claim: under20ProtectionSummary,
        lettertrack_delivery_evidence: letterTrackDeliveryEvidence,
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
