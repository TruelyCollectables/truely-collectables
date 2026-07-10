import { getClientIdentity } from "../../../../../lib/client-identity";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

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

function metadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedRecord(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isDryRunLabel(label: ShippingLabelRow | null) {
  if (!label) return false;

  const latestAttempt = metadataRecord(label.metadata, "latest_purchase_attempt");
  const purchaseResult = nestedRecord(latestAttempt, "purchase_result");
  const providerPayload = nestedRecord(purchaseResult, "rawProviderPayload");

  return (
    latestAttempt?.status === "dry_run_purchased" ||
    purchaseResult?.mode === "dry_run" ||
    providerPayload?.dry_run === true ||
    label.provider_label_id?.startsWith("dryrun-") ||
    label.provider_shipment_id?.startsWith("dryrun-") ||
    label.coverage_policy_id?.startsWith("dryrun-") ||
    label.tracking_number?.includes("TCOS-DRYRUN")
  );
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
        "id,store_id,order_id,shipping_label_id,provider,provider_claim_id,claim_status,submitted_at,resolved_at,metadata",
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

    if (isDryRunLabel(label) && nextStatus !== "cancelled") {
      return Response.json(
        {
          error:
            "Dry-run Coverage claims can only be cancelled. Record a real Coverage policy before submitting or resolving a claim.",
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
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
        changed_by_identity: identity,
      },
    });

    return Response.json({
      success: true,
      claimId: claim.id,
      previousStatus,
      claimStatus: nextStatus,
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
