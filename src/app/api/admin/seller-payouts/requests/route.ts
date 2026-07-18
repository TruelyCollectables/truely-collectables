import { getActiveStoreId } from "../../../../../lib/stores";
import { getClientIdentity } from "../../../../../lib/client-identity";
import { recordSellerPayoutAdminEvent } from "../../../../../lib/seller-payout-admin-events";
import {
  isMissingPayoutReviewGuardTable,
  loadSellerPayoutRequestReviewBlockers,
} from "../../../../../lib/seller-payout-review-blocks";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const allowedStatuses = new Set([
  "requested",
  "approved",
  "processing",
  "paid",
  "rejected",
  "cancelled",
]);

const reviewProtectedStatuses = new Set(["approved", "processing", "paid"]);
const allowedTransitions = new Map<string, Set<string>>([
  ["requested", new Set(["approved", "rejected", "cancelled"])],
  ["approved", new Set(["processing", "rejected", "cancelled"])],
  ["processing", new Set(["paid", "rejected", "cancelled"])],
  ["rejected", new Set()],
  ["cancelled", new Set()],
  ["paid", new Set()],
]);

type SellerPayoutAccountRow = {
  onboarding_status: string | null;
  payouts_enabled: boolean | null;
  details_submitted: boolean | null;
  requirements_currently_due: string[] | null;
  requirements_past_due: string[] | null;
  disabled_reason: string | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanAdminNote(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, 1000) : null;
}

function cleanPayoutReference(value: unknown) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, 250) : null;
}

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sellerPayoutAccountReady(row: SellerPayoutAccountRow | null) {
  return (
    row?.onboarding_status === "active" &&
    row.payouts_enabled === true &&
    row.details_submitted === true &&
    (row.requirements_currently_due || []).length === 0 &&
    (row.requirements_past_due || []).length === 0 &&
    !row.disabled_reason
  );
}

function timestampPatch(status: string) {
  const now = new Date().toISOString();

  if (status === "approved" || status === "rejected") {
    return {
      reviewed_at: now,
      completed_at: null,
    };
  }

  if (status === "paid" || status === "cancelled") {
    return {
      completed_at: now,
    };
  }

  return {};
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestId = String(body.requestId || "").trim();
    const status = String(body.status || "").trim();
    const adminNote = cleanAdminNote(body.adminNote);
    const providerPayoutReference = cleanPayoutReference(
      body.providerPayoutReference,
    );
    const finalProcessorFeeAmount = roundMoney(
      Math.max(0, moneyNumber(body.finalProcessorFeeAmount)),
    );

    if (!requestId || !allowedStatuses.has(status)) {
      return Response.json(
        { error: "Missing payout request id or valid status." },
        { status: 400 },
      );
    }

    if (
      (status === "rejected" || status === "cancelled") &&
      (!adminNote || adminNote.length < 8)
    ) {
      return Response.json(
        {
          error:
            "Add an audit note with the reason before rejecting or cancelling a payout request.",
        },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: payoutRequest, error: lookupError } = await supabase
      .from("seller_payout_requests")
      .select("id,seller_account_id,requested_amount,status")
      .eq("id", requestId)
      .eq("store_id", storeId)
      .single();

    if (lookupError || !payoutRequest) {
      return Response.json(
        { error: lookupError?.message || "Payout request not found." },
        { status: 404 },
      );
    }

    if (payoutRequest.status === "paid") {
      return Response.json(
        { error: "Paid payout requests cannot be changed." },
        { status: 409 },
      );
    }

    const currentStatus = payoutRequest.status || "requested";
    const allowedNextStatuses = allowedTransitions.get(currentStatus);

    if (!allowedNextStatuses?.has(status)) {
      return Response.json(
        {
          error: `Payout requests cannot move from ${currentStatus} to ${status}.`,
        },
        { status: 409 },
      );
    }

    const requestedAmount = moneyNumber(payoutRequest.requested_amount);
    const finalNetAmount = roundMoney(
      Math.max(0, requestedAmount - finalProcessorFeeAmount),
    );

    if (status === "paid" && !providerPayoutReference) {
      return Response.json(
        {
          error:
            "Provider payout reference is required before marking a cash-out request paid.",
        },
        { status: 400 },
      );
    }

    if (reviewProtectedStatuses.has(status)) {
      const { data: payoutAccount, error: payoutAccountError } = await supabase
        .from("seller_payout_accounts")
        .select(
          "onboarding_status,payouts_enabled,details_submitted,requirements_currently_due,requirements_past_due,disabled_reason",
        )
        .eq("store_id", storeId)
        .eq("account_id", payoutRequest.seller_account_id)
        .eq("provider", "stripe_connect")
        .maybeSingle();

      if (payoutAccountError) throw payoutAccountError;

      if (
        !sellerPayoutAccountReady(
          (payoutAccount || null) as SellerPayoutAccountRow | null,
        )
      ) {
        return Response.json(
          {
            error:
              "Seller Stripe payout verification must be active before approving, processing, or paying this cash-out request.",
            sellerPayoutStatus:
              (payoutAccount as SellerPayoutAccountRow | null)?.onboarding_status ||
              "not_started",
          },
          { status: 409 },
        );
      }

      const blockersByRequestId = await loadSellerPayoutRequestReviewBlockers({
        supabase,
        storeId,
        payoutRequestIds: [requestId],
      });
      const blocker = blockersByRequestId.get(requestId);

      if (blocker?.isBlocked) {
        return Response.json(
          {
            error:
              "This payout request is blocked by active review cases, held payout rows, or dry-run shipping rows. Resolve the case queue and record real fulfillment proof before approving or paying this request.",
            blockingCaseCount: blocker.activeCaseCount,
            blockedLedgerRowCount: blocker.blockedLedgerRowCount,
            dryRunShippingRowCount: blocker.dryRunShippingRowCount,
            affectedOrderIds: blocker.affectedOrderIds,
            blockingCases: blocker.blockingCases,
            blockingLedgerRows: blocker.blockingLedgerRows,
            dryRunShippingRows: blocker.dryRunShippingRows,
          },
          { status: 409 },
        );
      }
    }

    const paidFields =
      status === "paid"
        ? {
            final_processor_fee_amount: finalProcessorFeeAmount,
            final_net_amount: finalNetAmount,
            provider_payout_reference: providerPayoutReference,
            provider_payout_status: "paid_recorded",
          }
        : {};

    const { error: updateError } = await supabase
      .from("seller_payout_requests")
      .update({
        status,
        admin_note: adminNote,
        updated_at: new Date().toISOString(),
        ...timestampPatch(status),
        ...paidFields,
      })
      .eq("id", requestId)
      .eq("store_id", storeId);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    const identity = await getClientIdentity(request);
    await recordSellerPayoutAdminEvent({
      supabase,
      storeId,
      targetType: "seller_payout_request",
      targetId: requestId,
      sellerAccountId: payoutRequest.seller_account_id ?? null,
      eventType: "request_status_change",
      previousStatus: payoutRequest.status || "requested",
      newStatus: status,
      adminNote,
      identity,
      metadata:
        status === "paid"
          ? {
              provider_payout_reference: providerPayoutReference,
              final_processor_fee_amount: finalProcessorFeeAmount,
              final_net_amount: finalNetAmount,
            }
          : {},
    });

    return Response.json({
      success: true,
      requestId,
      status,
    });
  } catch (error: any) {
    if (isMissingPayoutReviewGuardTable(error)) {
      return Response.json(
        {
          error:
            "Payout review guards are unavailable until the order review case and payout request tables are applied.",
        },
        { status: 503 },
      );
    }

    return Response.json(
      { error: error.message || "Could not update payout request." },
      { status: 500 },
    );
  }
}
