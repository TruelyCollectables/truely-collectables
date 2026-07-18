import { getClientIdentity } from "../../../../../lib/client-identity";
import {
  buildLetterTrackDeliveryEvidenceSummary,
  buildLetterTrackSellerProtectionEvidenceReview,
  evaluateLetterTrackSellerProtectionPaymentMetadataGate,
  shouldRecordLetterTrackSellerProtectionEvidenceReview,
  type LetterTrackDeliveryEvidenceEvent,
  type LetterTrackDeliveryEvidenceSummary,
  type LetterTrackSellerProtectionPaymentGate,
  type LetterTrackSellerProtectionEvidenceReview,
} from "../../../../../lib/lettertrack-delivery-evidence";
import { UNDER_20_SELLER_PROTECTION_PROVIDER } from "../../../../../lib/shipping";
import { isDryRunShippingLabel } from "../../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  buildUnder20SellerProtectionReimbursementPlan,
  evaluateUnder20SellerProtectionBuyerRefundMetadataGate,
  type Under20SellerProtectionBuyerRefundGate,
  type Under20SellerProtectionReimbursementRow,
} from "../../../../../lib/under20-seller-protection-claims";

export const dynamic = "force-dynamic";

const validStatuses = new Set([
  "draft",
  "submitted",
  "under_review",
  "approved",
  "paid",
  "denied",
  "cancelled",
]);

const terminalStatuses = new Set(["paid", "denied", "cancelled"]);

const allowedTransitions: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["under_review", "approved", "denied", "cancelled"],
  under_review: ["approved", "denied", "cancelled"],
  approved: ["paid", "denied", "cancelled"],
  paid: [],
  denied: [],
  cancelled: [],
};

type CoverageClaimRow = {
  id: string;
  store_id: string;
  order_id: number;
  shipping_label_id: string | null;
  provider: string | null;
  provider_claim_id: string | null;
  claim_status: string | null;
  claim_amount: number | string | null;
  submitted_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
};

type ShippingLabelRow = {
  id: string;
  coverage_status: string | null;
  coverage_policy_id: string | null;
  provider_label_id: string | null;
  provider_shipment_id: string | null;
  tracking_number: string | null;
  metadata: Record<string, unknown> | null;
};

type SellerProtectionLedgerRow = {
  id: string;
  order_item_id: number | null;
  seller_account_id: string | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  metadata: Record<string, unknown> | null;
};

type SellerProtectionPaymentEvidence = {
  summary: LetterTrackDeliveryEvidenceSummary;
  gate: LetterTrackSellerProtectionPaymentGate;
};

type SellerProtectionBuyerRefundEvidence = {
  reviewed_at: string;
  reviewed_by_identity: Awaited<ReturnType<typeof getClientIdentity>>;
  note: string | null;
  gate: Under20SellerProtectionBuyerRefundGate;
};

type SellerProtectionEvidenceReview = LetterTrackSellerProtectionEvidenceReview;

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => String(entry || "").trim())
        .filter((entry) => entry.length > 0)
    : [];
}

function isUnder20SellerProtectionClaim(under20Claim: Record<string, unknown>) {
  return (
    under20Claim.program === UNDER_20_SELLER_PROTECTION_PROVIDER &&
    under20Claim.appliesToMethod === "STANDARD_ENVELOPE"
  );
}

async function latestSellerProtectionPaymentEvidence(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  claim: CoverageClaimRow;
  overrideNote: string;
}): Promise<SellerProtectionPaymentEvidence> {
  if (!params.claim.shipping_label_id) {
    const summary = buildLetterTrackDeliveryEvidenceSummary([]);
    return {
      summary,
      gate: {
        allowed: false,
        overrideAccepted: false,
        reason:
          "No shipping label is linked for LetterTrack evidence review. Link the Standard Envelope label before marking this seller-protection claim paid.",
      },
    };
  }

  const { data, error } = await params.supabase
    .from("order_shipping_tracking_events")
    .select(
      "id,provider,carrier,tracking_number,event_type,event_code,event_status,message,location,occurred_at,raw_payload",
    )
    .eq("store_id", params.storeId)
    .eq("order_id", params.claim.order_id)
    .eq("shipping_label_id", params.claim.shipping_label_id)
    .order("occurred_at", { ascending: true })
    .limit(100);

  if (error) throw error;

  const summary = buildLetterTrackDeliveryEvidenceSummary(
    (data || []) as LetterTrackDeliveryEvidenceEvent[],
  );
  const gate = evaluateLetterTrackSellerProtectionPaymentMetadataGate({
    evidence: summary,
    metadata: params.claim.metadata,
    overrideNote: params.overrideNote,
  });

  return { summary, gate };
}

function coverageStatusForClaimStatus(
  status: string,
  label: ShippingLabelRow | null,
) {
  if (status === "paid") return "claim_paid";
  if (status === "denied") return "claim_denied";
  if (status === "submitted" || status === "under_review" || status === "approved") {
    return "claim_pending";
  }
  if (status === "cancelled") {
    return label?.coverage_policy_id ? "covered" : "required_at_label_purchase";
  }

  return label?.coverage_status || null;
}

async function createSellerProtectionReimbursement(params: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  storeId: string;
  claim: CoverageClaimRow;
  now: string;
  identity: Awaited<ReturnType<typeof getClientIdentity>>;
}) {
  const under20Claim = recordValue(
    recordValue(params.claim.metadata).under_20_seller_protection_claim,
  );
  const protectedLedgerEntryIds = stringList(
    under20Claim.protectedLedgerEntryIds,
  );
  const reimbursableAmount = moneyNumber(
    under20Claim.reimbursableItemAmount || params.claim.claim_amount,
  );

  if (under20Claim.eligible !== true || reimbursableAmount <= 0) {
    return {
      required: false,
      insertedCount: 0,
      reimbursedAmount: 0,
      detail:
        "No TCOS seller-protection reimbursement was created because this claim is not eligible or the reimbursable item amount is $0.",
    };
  }

  if (protectedLedgerEntryIds.length === 0) {
    throw new Error(
      "Cannot mark seller-protection claim paid because no protected seller payout ledger rows were recorded.",
    );
  }

  const { data, error } = await params.supabase
    .from("seller_payout_ledger_entries")
    .select(
      "id,order_item_id,seller_account_id,gross_item_amount,shipping_allocated_amount,metadata",
    )
    .eq("store_id", params.storeId)
    .eq("order_id", params.claim.order_id)
    .in("id", protectedLedgerEntryIds);

  if (error) throw error;

  const rows = (data || []) as SellerProtectionLedgerRow[];

  if (rows.length === 0) {
    throw new Error(
      "Cannot mark seller-protection claim paid because the protected seller payout rows could not be loaded.",
    );
  }

  let insertedCount = 0;
  const reimbursementPlan = buildUnder20SellerProtectionReimbursementPlan({
    rows: rows as Under20SellerProtectionReimbursementRow[],
    reimbursableAmount,
  });

  for (const allocation of reimbursementPlan.allocations) {
    const { data: inserted, error: insertError } = await params.supabase
      .from("financial_adjustment_ledger_entries")
      .upsert(
        {
          store_id: params.storeId,
          order_id: params.claim.order_id,
          order_item_id: allocation.orderItemId,
          seller_account_id: allocation.sellerAccountId,
          provider: "tcos_internal",
          provider_event_id: `coverage_claim:${params.claim.id}:paid`,
          provider_object_id:
            params.claim.provider_claim_id || params.claim.id,
          economic_key: `seller_protection:${params.claim.id}:${allocation.rowId}`,
          entry_type: "seller_protection_reimbursement",
          ledger_account: "seller_payable",
          balance_effect: "credit",
          amount: allocation.amount,
          currency: "USD",
          metadata: {
            claim_id: params.claim.id,
            base_seller_payout_row_id: allocation.rowId,
            coverage_basis: "item_sale_amount_excluding_shipping",
            reimburses_shipping: false,
            shipping_excluded_amount: allocation.shippingExcludedAmount,
            protected_row_covered_amount: allocation.coveredAmount,
            reimbursement_plan: reimbursementPlan,
            created_by_identity: params.identity,
            created_at: params.now,
          },
        },
        { onConflict: "store_id,economic_key", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (insertError) throw insertError;

    if (inserted?.id) insertedCount += 1;
  }

  return {
    required: true,
    insertedCount,
    reimbursedAmount: reimbursementPlan.reimbursedAmount,
    reimbursementPlan,
    detail:
      insertedCount > 0
        ? "TCOS seller-protection reimbursement adjustment was created for protected item amount only. Shipping was excluded."
        : "TCOS seller-protection reimbursement adjustment already existed; no duplicate credit was created.",
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const claimId = String(id || "").trim();

    if (!claimId) {
      return Response.json({ error: "Missing claim id." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const nextStatus = String(body.status || "").trim();
    const note = String(body.note || "").trim();
    const providerClaimId = String(body.providerClaimId || "").trim();

    if (!validStatuses.has(nextStatus) || nextStatus === "draft") {
      return Response.json(
        { error: "Choose a valid coverage claim status." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const identity = await getClientIdentity(request);

    const { data: claimData, error: claimError } = await supabase
      .from("order_shipping_coverage_claims")
      .select(
        "id,store_id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,claim_amount,submitted_at,resolved_at,metadata",
      )
      .eq("store_id", storeId)
      .eq("id", claimId)
      .maybeSingle();

    if (claimError) throw claimError;

    const claim = (claimData || null) as CoverageClaimRow | null;

    if (!claim?.id) {
      return Response.json(
        { error: "Coverage claim was not found." },
        { status: 404 },
      );
    }

    const previousStatus = claim.claim_status || "draft";

    if (terminalStatuses.has(previousStatus)) {
      return Response.json(
        { error: "Closed coverage claims cannot be changed." },
        { status: 409 },
      );
    }

    if (
      nextStatus !== previousStatus &&
      !allowedTransitions[previousStatus]?.includes(nextStatus)
    ) {
      return Response.json(
        {
          error: `Coverage claim cannot move from ${previousStatus} to ${nextStatus}.`,
        },
        { status: 409 },
      );
    }

    if (terminalStatuses.has(nextStatus) && note.length < 8) {
      return Response.json(
        {
          error:
            "Add an audit note with the reason before closing a coverage claim.",
        },
        { status: 400 },
      );
    }

    let label: ShippingLabelRow | null = null;

    if (claim.shipping_label_id) {
      const { data: labelData, error: labelError } = await supabase
        .from("order_shipping_labels")
        .select(
          "id,coverage_status,coverage_policy_id,provider_label_id,provider_shipment_id,tracking_number,metadata",
        )
        .eq("store_id", storeId)
        .eq("id", claim.shipping_label_id)
        .maybeSingle();

      if (labelError) throw labelError;
      label = (labelData || null) as ShippingLabelRow | null;
    }

    if (isDryRunShippingLabel(label) && nextStatus !== "cancelled") {
      return Response.json(
        {
          error:
            "Dry-run Coverage claims can only be cancelled. Record a real Coverage policy before submitting or resolving a claim.",
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const under20Claim = recordValue(
      recordValue(claim.metadata).under_20_seller_protection_claim,
    );
    const internalSellerProtectionClaim =
      isUnder20SellerProtectionClaim(under20Claim);

    if (
      nextStatus === "paid" &&
      !internalSellerProtectionClaim &&
      !(providerClaimId || claim.provider_claim_id)
    ) {
      return Response.json(
        {
          error:
            "Provider claim ID is required before marking an external Coverage claim paid.",
        },
        { status: 409 },
      );
    }

    const sellerProtectionPaymentEvidence =
      shouldRecordLetterTrackSellerProtectionEvidenceReview({
        status: nextStatus,
        eligible: under20Claim.eligible,
      })
        ? await latestSellerProtectionPaymentEvidence({
            supabase,
            storeId,
            claim,
            overrideNote: note,
          })
        : null;

    if (
      sellerProtectionPaymentEvidence &&
      nextStatus === "paid" &&
      !sellerProtectionPaymentEvidence.gate.allowed
    ) {
      return Response.json(
        { error: sellerProtectionPaymentEvidence.gate.reason },
        { status: 409 },
      );
    }

    const sellerProtectionBuyerRefundEvidence: SellerProtectionBuyerRefundEvidence | null =
      nextStatus === "paid" && under20Claim.eligible === true
        ? {
            reviewed_at: now,
            reviewed_by_identity: identity,
            note: note || null,
            gate: evaluateUnder20SellerProtectionBuyerRefundMetadataGate({
              metadata: claim.metadata,
              note,
            }),
          }
        : null;

    if (
      sellerProtectionBuyerRefundEvidence &&
      !sellerProtectionBuyerRefundEvidence.gate.allowed
    ) {
      return Response.json(
        { error: sellerProtectionBuyerRefundEvidence.gate.reason },
        { status: 409 },
      );
    }

    const sellerProtectionEvidenceReview: SellerProtectionEvidenceReview | null =
      sellerProtectionPaymentEvidence
        ? buildLetterTrackSellerProtectionEvidenceReview({
            status: nextStatus,
            reviewedAt: now,
            reviewedByIdentity: identity,
            note,
            summary: sellerProtectionPaymentEvidence.summary,
            gate: sellerProtectionPaymentEvidence.gate,
          })
        : null;

    const sellerProtectionReimbursement =
      nextStatus === "paid"
        ? await createSellerProtectionReimbursement({
            supabase,
            storeId,
            claim,
            now,
            identity,
          })
        : null;
    const metadata = {
      ...(claim.metadata || {}),
      latest_admin_status_change: {
        previous_status: previousStatus,
        new_status: nextStatus,
        note: note || null,
        provider_claim_id:
          providerClaimId || claim.provider_claim_id || null,
        changed_at: now,
        changed_by_identity: identity,
      },
      ...(sellerProtectionReimbursement
        ? {
            latest_seller_protection_reimbursement:
              sellerProtectionReimbursement,
          }
        : {}),
      ...(sellerProtectionBuyerRefundEvidence
        ? {
            latest_seller_protection_buyer_refund_evidence:
              sellerProtectionBuyerRefundEvidence,
          }
        : {}),
      ...(sellerProtectionPaymentEvidence
        ? {
            latest_lettertrack_delivery_evidence_review:
              sellerProtectionEvidenceReview,
            latest_lettertrack_seller_protection_payment_gate:
              sellerProtectionPaymentEvidence,
            ...(nextStatus === "paid"
              ? {
                  lettertrack_delivery_evidence:
                    sellerProtectionPaymentEvidence.summary,
                }
              : {}),
          }
        : {}),
    };

    const claimUpdate: Record<string, unknown> = {
      claim_status: nextStatus,
      metadata,
      updated_at: now,
    };

    if (providerClaimId) {
      claimUpdate.provider_claim_id = providerClaimId;
    }

    if (nextStatus === "submitted" && !claim.submitted_at) {
      claimUpdate.submitted_at = now;
    }

    if (terminalStatuses.has(nextStatus) && !claim.resolved_at) {
      claimUpdate.resolved_at = now;
    }

    const { error: updateError } = await supabase
      .from("order_shipping_coverage_claims")
      .update(claimUpdate)
      .eq("store_id", storeId)
      .eq("id", claim.id);

    if (updateError) throw updateError;

    const nextCoverageStatus = coverageStatusForClaimStatus(nextStatus, label);

    if (claim.shipping_label_id) {
      const labelUpdate: Record<string, unknown> = {
        coverage_claim_id: providerClaimId || claim.provider_claim_id || claim.id,
        coverage_claim_status: nextStatus,
        updated_at: now,
      };

      if (nextCoverageStatus) {
        labelUpdate.coverage_status = nextCoverageStatus;
      }

      const { error: labelUpdateError } = await supabase
        .from("order_shipping_labels")
        .update(labelUpdate)
        .eq("store_id", storeId)
        .eq("id", claim.shipping_label_id);

      if (labelUpdateError) throw labelUpdateError;
    }

    await supabase.from("order_shipping_tracking_events").insert({
      store_id: storeId,
      order_id: claim.order_id,
      shipping_label_id: claim.shipping_label_id,
      provider: claim.provider || "Coverage",
      event_type:
        nextStatus === previousStatus
          ? "coverage_claim_status_reaffirmed"
          : "coverage_claim_status_changed",
      event_status: nextStatus,
      message:
        nextStatus === previousStatus
          ? `Coverage claim status reaffirmed as ${nextStatus}.`
          : `Coverage claim status changed from ${previousStatus} to ${nextStatus}.`,
      occurred_at: now,
      raw_payload: {
        claim_id: claim.id,
        previous_status: previousStatus,
        new_status: nextStatus,
        provider_claim_id: providerClaimId || claim.provider_claim_id || null,
        note: note || null,
        seller_protection_reimbursement: sellerProtectionReimbursement,
        seller_protection_buyer_refund_evidence:
          sellerProtectionBuyerRefundEvidence,
        lettertrack_delivery_evidence_review: sellerProtectionEvidenceReview,
        lettertrack_seller_protection_payment_gate:
          sellerProtectionPaymentEvidence,
        changed_by_identity: identity,
      },
    });

    return Response.json({
      success: true,
      claimId: claim.id,
      previousStatus,
      claimStatus: nextStatus,
      sellerProtectionReimbursement,
      sellerProtectionBuyerRefundEvidence,
      letterTrackSellerProtectionPaymentGate: sellerProtectionPaymentEvidence,
      message:
        nextStatus === previousStatus
          ? "Coverage claim status reaffirmed and logged."
          : "Coverage claim status updated and logged.",
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not update coverage claim." },
      { status: 500 },
    );
  }
}
