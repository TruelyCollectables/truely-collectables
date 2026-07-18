import Link from "next/link";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getActiveStoreId } from "../../../lib/stores";
import { getAccountProfilesByIds } from "../../../lib/account-profiles";
import { isDryRunShippingReference } from "../../../lib/shipping-dry-run";
import {
  isMissingPayoutReviewGuardTable,
  loadSellerPayoutRequestReviewBlockers,
  type SellerPayoutRequestReviewBlocker,
} from "../../../lib/seller-payout-review-blocks";
import {
  buildUnder20SellerProtectionSellerVisibilitySummary,
  under20ProtectionFromMetadata,
  type Under20SellerProtectionSellerVisibilitySummary,
} from "../../../lib/under20-seller-protection-claims";
import PayoutLedgerActions from "./PayoutLedgerActions";
import PayoutRequestActions from "./PayoutRequestActions";
import ConnectRefreshActions from "./ConnectRefreshActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SellerPayoutLedgerEntry = {
  id: string;
  seller_account_id: string;
  order_id: number;
  order_item_id: number;
  product_id: number | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  seller_payable_amount: number | string | null;
  payout_status: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

type LedgerOrderRow = {
  id: number;
  status: string | null;
  fulfillment_status: string | null;
  shipped_at: string | null;
  tracking_number: string | null;
  carrier: string | null;
};

type LedgerOrderReviewCaseRow = {
  id: string;
  order_id: number;
  status: string | null;
};

type PlatformFeeLedgerEntry = {
  id: string;
  order_id: number;
  order_item_id: number;
  product_id: number | null;
  seller_account_id: string | null;
  gross_item_amount: number | string | null;
  shipping_allocated_amount: number | string | null;
  total_basis_amount: number | string | null;
  platform_fee_rate: number | string | null;
  platform_fee_amount: number | string | null;
  fee_status: string | null;
  created_at: string;
};

type SellerPayoutRequest = {
  id: string;
  seller_account_id: string;
  requested_amount: number | string | null;
  estimated_processor_fee_amount: number | string | null;
  estimated_net_amount: number | string | null;
  final_processor_fee_amount: number | string | null;
  final_net_amount: number | string | null;
  provider_payout_reference: string | null;
  provider_payout_status: string | null;
  status: string | null;
  request_note: string | null;
  admin_note: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type SellerPayoutAccount = {
  id: string;
  account_id: string;
  provider_account_id: string;
  onboarding_status: string | null;
  charges_enabled: boolean | null;
  payouts_enabled: boolean | null;
  details_submitted: boolean | null;
  seller_tos_accepted: boolean | null;
  requirements_currently_due: string[] | null;
  requirements_past_due: string[] | null;
  disabled_reason: string | null;
  updated_at: string | null;
};

type SellerPayoutAdminEvent = {
  id: string;
  target_type: string | null;
  target_id: string | null;
  seller_account_id: string | null;
  event_type: string | null;
  previous_status: string | null;
  new_status: string | null;
  admin_note: string | null;
  ip_address: string | null;
  identity_risk: string | null;
  created_at: string | null;
};

function reviewBlockReason(blocker: SellerPayoutRequestReviewBlocker | undefined) {
  if (!blocker?.isBlocked) return null;

  const parts = [];

  if (blocker.activeCaseCount > 0) {
    parts.push(`${blocker.activeCaseCount} active case`);
  }

  if (blocker.blockedLedgerRowCount > 0) {
    parts.push(`${blocker.blockedLedgerRowCount} held or cancelled row`);
  }

  if (blocker.dryRunShippingRowCount > 0) {
    parts.push(`${blocker.dryRunShippingRowCount} dry-run shipping row`);
  }

  return `${parts.join(" and ")} blocking payout release.`;
}

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function safeErrorMessage(error: { message?: string } | string | null | undefined) {
  const message =
    typeof error === "string" ? error : error?.message || "Unknown database error.";

  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string | null | undefined) {
  if (status === "eligible" || status === "paid") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    status === "hold_pending_fulfillment" ||
    status === "hold_dispute_or_review" ||
    status === "requested" ||
    status === "approved" ||
    status === "processing"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "reversed" || status === "cancelled" || status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function cashOutPayoutProofCard(request: SellerPayoutRequest) {
  const hasProviderReference = Boolean(request.provider_payout_reference);
  const paidRequest = request.status === "paid";
  const processingRequest = request.status === "processing";

  if (!paidRequest && !processingRequest && !hasProviderReference) return null;

  return (
    <div
      className={`mt-2 rounded border p-2 text-xs font-semibold ${
        hasProviderReference
          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
          : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <p className="font-black uppercase tracking-widest">
        Cash-out payout proof
      </p>
      <p className="mt-1">
        Provider payout reference is required before marking a cash-out request
        paid. This reference is the Stripe/provider proof trail for closing the
        seller cash movement.
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div>
          <dt className="text-[10px] uppercase tracking-widest opacity-70">
            Provider reference ready
          </dt>
          <dd>{hasProviderReference ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-widest opacity-70">
            Payout status
          </dt>
          <dd>{label(request.status)}</dd>
        </div>
      </dl>
      {hasProviderReference ? (
        <p className="mt-2 break-all">
          Provider Ref: {request.provider_payout_reference}
        </p>
      ) : paidRequest ? (
        <p className="mt-2">
          AUDIT WARNING: this paid cash-out request is missing a provider payout
          reference. Use provider records before relying on payout proof.
        </p>
      ) : (
        <p className="mt-2">
          Enter the provider payout reference in Processing before Mark Paid is
          available.
        </p>
      )}
    </div>
  );
}

function sellerProtectionTone(
  status: Under20SellerProtectionSellerVisibilitySummary["status"] | undefined,
) {
  if (status === "protected") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (status === "mixed") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (status === "unprotected") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-800";
}

function hasUnder20SellerProtectionMetadata(
  entry: Pick<SellerPayoutLedgerEntry, "metadata">,
) {
  const protection = under20ProtectionFromMetadata(entry.metadata);
  return Object.keys(protection).length > 0;
}

function connectStatusTone(status: string | null | undefined) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "pending_provider_review") return "border-sky-200 bg-sky-50 text-sky-800";
  if (
    status === "payout_verification_required" ||
    status === "restricted" ||
    status === "not_started"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (status === "disabled") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function requirementSummary(account: SellerPayoutAccount) {
  const currentlyDue = account.requirements_currently_due || [];
  const pastDue = account.requirements_past_due || [];
  const parts = [];

  if (currentlyDue.length > 0) parts.push(`${currentlyDue.length} currently due`);
  if (pastDue.length > 0) parts.push(`${pastDue.length} past due`);
  if (account.disabled_reason) parts.push(account.disabled_reason);

  return parts.length > 0 ? parts.join(" / ") : "No open Stripe requirements";
}

function sellerPayoutAccountReady(account: SellerPayoutAccount | undefined) {
  return (
    account?.onboarding_status === "active" &&
    account.payouts_enabled === true &&
    account.details_submitted === true &&
    (account.requirements_currently_due || []).length === 0 &&
    (account.requirements_past_due || []).length === 0 &&
    !account.disabled_reason
  );
}

function sellerPayoutAccountBlockReason(account: SellerPayoutAccount | undefined) {
  if (!account) return "Seller has not started Stripe payout verification.";
  if (account.disabled_reason) {
    return `Stripe payout account disabled: ${account.disabled_reason}`;
  }
  if (account.onboarding_status !== "active") {
    return `Stripe payout verification is ${label(account.onboarding_status)}.`;
  }
  if (account.payouts_enabled !== true) return "Stripe payouts are not enabled.";
  if (account.details_submitted !== true) return "Stripe account details are not submitted.";

  const dueCount =
    (account.requirements_currently_due || []).length +
    (account.requirements_past_due || []).length;
  if (dueCount > 0) return `${dueCount} Stripe requirement(s) remain open.`;

  return null;
}

function isActiveReviewCase(status: string | null | undefined) {
  return !["decided_for_buyer", "decided_for_seller", "closed"].includes(
    status || "open",
  );
}

function payoutReleaseBlockReason(
  order: LedgerOrderRow | undefined,
  activeCaseCount: number,
) {
  if (!order) return "Order could not be verified before payout release.";
  if (
    String(order.status || "").endsWith("_review") ||
    ["inventory_review", "shipping_review"].includes(
      String(order.fulfillment_status || ""),
    )
  ) {
    return "Order is still on payment, inventory, or shipping review.";
  }
  if (order.fulfillment_status !== "shipped" || !order.shipped_at) {
    return "Order must be marked shipped before seller payout can be released.";
  }
  if (isDryRunShippingReference(order.tracking_number)) {
    return "Order only has TCOS dry-run shipping. Add real carrier proof before seller payout can be released.";
  }
  if (activeCaseCount > 0) {
    return `${activeCaseCount} active order review case(s) must be resolved before seller payout release.`;
  }
  return null;
}

export default async function AdminSellerPayoutsPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("seller_payout_ledger_entries")
    .select(
      `
      id,
      seller_account_id,
      order_id,
      order_item_id,
      product_id,
      gross_item_amount,
      shipping_allocated_amount,
      total_basis_amount,
      platform_fee_rate,
      platform_fee_amount,
      seller_payable_amount,
      payout_status,
      stripe_session_id,
      stripe_payment_intent_id,
      metadata,
      created_at,
      updated_at
    `,
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(200);
  const { data: platformFeeData, error: platformFeeError } = await supabase
    .from("platform_fee_ledger_entries")
    .select(
      `
      id,
      order_id,
      order_item_id,
      product_id,
      seller_account_id,
      gross_item_amount,
      shipping_allocated_amount,
      total_basis_amount,
      platform_fee_rate,
      platform_fee_amount,
      fee_status,
      created_at
    `,
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(200);
  const { data: payoutRequestData, error: payoutRequestError } = await supabase
    .from("seller_payout_requests")
    .select(
      `
      id,
      seller_account_id,
      requested_amount,
      estimated_processor_fee_amount,
      estimated_net_amount,
      final_processor_fee_amount,
      final_net_amount,
      provider_payout_reference,
      provider_payout_status,
      status,
      request_note,
      admin_note,
      requested_at,
      reviewed_at,
      completed_at,
      created_at
    `,
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(100);
  const { data: payoutAccountData, error: payoutAccountError } = await supabase
    .from("seller_payout_accounts")
    .select(
      `
      id,
      account_id,
      provider_account_id,
      onboarding_status,
      charges_enabled,
      payouts_enabled,
      details_submitted,
      seller_tos_accepted,
      requirements_currently_due,
      requirements_past_due,
      disabled_reason,
      updated_at
    `,
    )
    .eq("store_id", storeId)
    .eq("provider", "stripe_connect")
    .order("updated_at", { ascending: false })
    .limit(100);
  const { data: adminEventData, error: adminEventError } = await supabase
    .from("seller_payout_admin_events")
    .select(
      `
      id,
      target_type,
      target_id,
      seller_account_id,
      event_type,
      previous_status,
      new_status,
      admin_note,
      ip_address,
      identity_risk,
      created_at
    `,
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(25);

  const entries = (data || []) as SellerPayoutLedgerEntry[];
  const platformFeeEntries = (platformFeeData || []) as PlatformFeeLedgerEntry[];
  const payoutRequests = (payoutRequestData || []) as SellerPayoutRequest[];
  const payoutAccounts = (payoutAccountData || []) as SellerPayoutAccount[];
  const adminEvents = (adminEventData || []) as SellerPayoutAdminEvent[];
  const payoutLedgerUnavailable = Boolean(error);
  const platformFeeLedgerUnavailable = Boolean(platformFeeError);
  const payoutRequestsUnavailable = Boolean(payoutRequestError);
  const payoutAccountsUnavailable = Boolean(payoutAccountError);
  const payoutAdminEventsUnavailable = Boolean(adminEventError);
  const ledgerOrderIds = Array.from(
    new Set(entries.map((entry) => entry.order_id).filter(Boolean)),
  );
  const { data: ledgerOrdersData } =
    ledgerOrderIds.length === 0
      ? { data: [] }
      : await supabase
          .from("orders")
          .select("id,status,fulfillment_status,shipped_at,tracking_number,carrier")
          .eq("store_id", storeId)
          .in("id", ledgerOrderIds);
  const { data: ledgerCasesData } =
    ledgerOrderIds.length === 0
      ? { data: [] }
      : await supabase
          .from("order_review_cases")
          .select("id,order_id,status")
          .eq("store_id", storeId)
          .in("order_id", ledgerOrderIds);
  const ledgerOrdersById = new Map(
    ((ledgerOrdersData || []) as LedgerOrderRow[]).map((order) => [
      order.id,
      order,
    ]),
  );
  const activeCaseCountByOrderId = new Map<number, number>();
  for (const reviewCase of (ledgerCasesData || []) as LedgerOrderReviewCaseRow[]) {
    if (!isActiveReviewCase(reviewCase.status)) continue;
    activeCaseCountByOrderId.set(
      reviewCase.order_id,
      (activeCaseCountByOrderId.get(reviewCase.order_id) || 0) + 1,
    );
  }
  let payoutRequestBlockers = new Map<string, SellerPayoutRequestReviewBlocker>();
  let payoutRequestBlockerError: string | null = null;

  try {
    payoutRequestBlockers = await loadSellerPayoutRequestReviewBlockers({
      supabase,
      storeId,
      payoutRequestIds: payoutRequests.map((request) => request.id),
    });
  } catch (error: any) {
    payoutRequestBlockerError = isMissingPayoutReviewGuardTable(error)
      ? "Apply the order review case and payout request entry migrations before payout review guards can verify dispute holds."
      : safeErrorMessage(error) || "Could not load payout review blockers.";
  }

  const profilesById = await getAccountProfilesByIds(
    [
      ...entries.map((entry) => entry.seller_account_id),
      ...platformFeeEntries.map((entry) => entry.seller_account_id),
      ...payoutRequests.map((request) => request.seller_account_id),
      ...payoutAccounts.map((account) => account.account_id),
      ...adminEvents.map((event) => event.seller_account_id),
    ],
  );

  const heldEntries = entries.filter((entry) =>
    String(entry.payout_status || "").startsWith("hold_"),
  );
  const eligibleEntries = entries.filter(
    (entry) => entry.payout_status === "eligible",
  );
  const allSitePlatformFeeTotal = platformFeeEntries.reduce(
    (sum, entry) => sum + Number(entry.platform_fee_amount || 0),
    0,
  );
  const heldPayableTotal = heldEntries.reduce(
    (sum, entry) => sum + Number(entry.seller_payable_amount || 0),
    0,
  );
  const openPayoutRequests = payoutRequests.filter((request) =>
    ["requested", "approved", "processing"].includes(
      request.status || "requested",
    ),
  );
  const openPayoutRequestTotal = openPayoutRequests.reduce(
    (sum, request) => sum + Number(request.requested_amount || 0),
    0,
  );
  const blockedOpenPayoutRequests = openPayoutRequests.filter(
    (request) => payoutRequestBlockers.get(request.id)?.isBlocked,
  );
  const sellerProtectionEntries = entries.filter(
    hasUnder20SellerProtectionMetadata,
  );
  const sellerProtectionSummary =
    buildUnder20SellerProtectionSellerVisibilitySummary(sellerProtectionEntries);
  const activePayoutAccounts = payoutAccounts.filter(
    (account) =>
      account.onboarding_status === "active" &&
      account.payouts_enabled === true &&
      account.details_submitted === true,
  );
  const actionRequiredPayoutAccounts = payoutAccounts.filter(
    (account) =>
      account.onboarding_status !== "active" ||
      account.payouts_enabled !== true ||
      account.details_submitted !== true ||
      (account.requirements_currently_due || []).length > 0 ||
      (account.requirements_past_due || []).length > 0 ||
      Boolean(account.disabled_reason),
  );
  const payoutAccountsByAccountId = new Map(
    payoutAccounts.map((account) => [account.account_id, account]),
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Admin
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Seller Payout Review
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Seller-owned order item accounting, Dag Danky Holdings LLC fee
              basis, payout holds, and payable totals.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/financial-reconciliation"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              Money Audit
            </Link>
            <Link
              href="/admin"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
            >
              Command Center
            </Link>
            <Link
              href="/admin/orders"
              className="rounded-md bg-amber-300 px-4 py-2 text-sm font-bold text-neutral-950 hover:bg-amber-200"
            >
              Orders
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">Payout Ledger Not Available</h2>
            <p className="mt-2 text-sm font-semibold">
              Apply the seller payout ledger migration before using this page:
              {` ${safeErrorMessage(error)}`}
            </p>
          </section>
        ) : null}

        {platformFeeError ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">
              Platform Fee Ledger Not Available
            </h2>
            <p className="mt-2 text-sm font-semibold">
              Apply the platform fee ledger migration before using website
              checkout rake reporting: {safeErrorMessage(platformFeeError)}
            </p>
          </section>
        ) : null}

        {payoutRequestError ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">
              Cash-Out Requests Not Available
            </h2>
            <p className="mt-2 text-sm font-semibold">
              Apply the seller payout request migration before using cash-out
              review: {safeErrorMessage(payoutRequestError)}
            </p>
          </section>
        ) : null}

        {payoutAccountError ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">
              Seller Connect Accounts Not Available
            </h2>
            <p className="mt-2 text-sm font-semibold">
              Apply the seller payout account migration before using Connect
              readiness review: {safeErrorMessage(payoutAccountError)}
            </p>
          </section>
        ) : null}

        {adminEventError ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">Payout Audit Not Available</h2>
            <p className="mt-2 text-sm font-semibold">
              Apply the seller payout admin event migration before using audit
              history: {safeErrorMessage(adminEventError)}
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
          <MetricTile
            label="Connect Active"
            value={
              payoutAccountsUnavailable
                ? "Unavailable"
                : String(activePayoutAccounts.length)
            }
            detail={
              payoutAccountsUnavailable
                ? "Seller Connect account storage did not load"
                : `${payoutAccounts.length} seller Connect account(s)`
            }
          />
          <MetricTile
            label="Connect Action"
            value={
              payoutAccountsUnavailable
                ? "Unavailable"
                : String(actionRequiredPayoutAccounts.length)
            }
            detail={
              payoutAccountsUnavailable
                ? "Connect cleanup counts unavailable"
                : "Need onboarding, review, or Stripe requirement cleanup"
            }
          />
          <MetricTile
            label="Held Payable"
            value={payoutLedgerUnavailable ? "Unavailable" : money(heldPayableTotal)}
            detail={
              payoutLedgerUnavailable
                ? "Seller payout ledger did not load"
                : `${heldEntries.length} held ledger row(s)`
            }
          />
          <MetricTile
            label="Eligible Rows"
            value={
              payoutLedgerUnavailable
                ? "Unavailable"
                : String(eligibleEntries.length)
            }
            detail={
              payoutLedgerUnavailable
                ? "Eligibility counts unavailable"
                : "Ready once release rules are enabled"
            }
          />
          <MetricTile
            label="Website Rake"
            value={
              platformFeeLedgerUnavailable
                ? "Unavailable"
                : money(allSitePlatformFeeTotal)
            }
            detail={
              platformFeeLedgerUnavailable
                ? "Platform fee ledger did not load"
                : `${platformFeeEntries.length} TCOS checkout fee row(s)`
            }
          />
          <MetricTile
            label="Protection Reserve"
            value={
              payoutLedgerUnavailable
                ? "Unavailable"
                : money(sellerProtectionSummary.reserveAmount)
            }
            detail={
              payoutLedgerUnavailable
                ? "Reserve counts unavailable"
                : `${sellerProtectionSummary.protectedRowCount} protected / ${sellerProtectionSummary.unprotectedRowCount} liable row(s)`
            }
          />
          <MetricTile
            label="Blocked Requests"
            value={
              payoutRequestsUnavailable
                ? "Unavailable"
                : String(blockedOpenPayoutRequests.length)
            }
            detail={
              payoutRequestsUnavailable
                ? "Cash-out request storage did not load"
                : `${openPayoutRequests.length} open cash-out request(s)`
            }
          />
        </section>

        <SellerProtectionCard
          summary={sellerProtectionSummary}
          title="Admin Under-$20 Protection Reserve"
          detail="Operator view of TCOS internal Standard Envelope seller-protection reserves across loaded payout ledger rows that carry under-$20 protection metadata. Shipping is excluded from reimbursement and protected item reimbursement remains capped at $20."
          sourceUnavailable={payoutLedgerUnavailable}
        />

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Seller Connect Readiness</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Stripe-hosted seller onboarding status, payout capability, TOS
                acceptance, and open provider requirements.
              </p>
            </div>
            <ConnectRefreshActions
              disabled={Boolean(payoutAccountError) || payoutAccounts.length === 0}
              disabledReason={
                payoutAccountError
                  ? "Fix the seller payout account load error before refreshing Stripe Connect statuses."
                  : payoutAccounts.length === 0
                    ? "No seller Connect accounts have started payout onboarding yet."
                    : undefined
              }
            />
          </div>

          {payoutAccountsUnavailable ? (
            <div className="p-5 text-sm text-amber-950">
              <p className="font-black">Seller Connect account list unavailable.</p>
              <p className="mt-1 max-w-3xl font-semibold">
                Seller Connect storage did not load, so this page cannot prove
                whether payout accounts exist or need Stripe cleanup. Fix the
                migration warning above before treating this queue as clear.
              </p>
            </div>
          ) : payoutAccounts.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller Connect accounts have started payout onboarding yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {payoutAccounts.map((account) => {
                const profile = profilesById.get(account.account_id);
                const currentlyDue = account.requirements_currently_due || [];
                const pastDue = account.requirements_past_due || [];

                return (
                  <div
                    key={account.id}
                    className="grid gap-4 p-5 text-sm xl:grid-cols-[1fr_1fr_1.2fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="font-black">
                        {profile?.display_name ||
                          profile?.email ||
                          "Seller account"}
                      </p>
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        {account.account_id}
                      </p>
                      <p className="mt-2 break-all text-xs font-semibold text-neutral-700">
                        Stripe {account.provider_account_id}
                      </p>
                    </div>

                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Payouts
                        </dt>
                        <dd className="font-black">
                          {account.payouts_enabled ? "Enabled" : "Blocked"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Charges
                        </dt>
                        <dd className="font-black">
                          {account.charges_enabled ? "Enabled" : "Blocked"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Details
                        </dt>
                        <dd className="font-black">
                          {account.details_submitted ? "Submitted" : "Needed"}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Seller TOS
                        </dt>
                        <dd className="font-black">
                          {account.seller_tos_accepted ? "Accepted" : "Missing"}
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <p className="font-bold">{requirementSummary(account)}</p>
                      {currentlyDue.length > 0 ? (
                        <p className="mt-2 text-xs text-neutral-600">
                          Current: {currentlyDue.slice(0, 6).join(", ")}
                          {currentlyDue.length > 6 ? "..." : ""}
                        </p>
                      ) : null}
                      {pastDue.length > 0 ? (
                        <p className="mt-2 text-xs text-rose-700">
                          Past due: {pastDue.slice(0, 6).join(", ")}
                          {pastDue.length > 6 ? "..." : ""}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-neutral-500">
                        Updated {shortDate(account.updated_at)}
                      </p>
                    </div>

                    <span
                      className={`h-fit w-fit rounded border px-2 py-1 text-xs font-black ${connectStatusTone(
                        account.onboarding_status,
                      )}`}
                    >
                      {label(account.onboarding_status)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Payout Audit Trail</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Recent admin release, hold, review, and cash-out status events.
            </p>
          </div>

          {payoutAdminEventsUnavailable ? (
            <div className="p-5 text-sm text-amber-950">
              <p className="font-black">Payout audit trail unavailable.</p>
              <p className="mt-1 max-w-3xl font-semibold">
                Payout admin event storage did not load, so this page cannot
                prove whether release, hold, or cash-out audit events exist.
              </p>
            </div>
          ) : adminEvents.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No payout audit events recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {adminEvents.map((event) => {
                const profile = event.seller_account_id
                  ? profilesById.get(event.seller_account_id)
                  : undefined;

                return (
                  <div
                    key={event.id}
                    className="grid gap-4 p-5 text-sm xl:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="font-black">
                        {profile?.display_name ||
                          profile?.email ||
                          "Platform admin event"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {label(event.event_type)} / {label(event.target_type)}
                      </p>
                    </div>

                    <div>
                      <p className="font-bold">
                        {label(event.previous_status)}
                        {" -> "}
                        {label(event.new_status)}
                      </p>
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        Target {event.target_id}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold text-neutral-500">
                        {shortDate(event.created_at)} / IP{" "}
                        {event.ip_address || "not recorded"} /{" "}
                        {label(event.identity_risk)}
                      </p>
                      <p className="mt-2 text-sm text-neutral-700">
                        {event.admin_note || "No admin note."}
                      </p>
                    </div>

                    <span className="h-fit w-fit rounded border border-neutral-200 bg-neutral-100 px-2 py-1 text-xs font-black text-neutral-700">
                      AUDIT
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Seller Cash-Out Requests</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Requests from sellers against eligible balances. This is review
              tracking only; payout movement is not automated here yet.
            </p>
            <p className="mt-2 text-sm font-bold text-neutral-800">
              Open requested total: {money(openPayoutRequestTotal)}
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-700">
              Blocked by review: {blockedOpenPayoutRequests.length}
            </p>
          </div>

          {payoutRequestBlockerError ? (
            <div className="border-b border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
              {payoutRequestBlockerError}
            </div>
          ) : null}

          {payoutRequestsUnavailable ? (
            <div className="p-5 text-sm text-amber-950">
              <p className="font-black">Seller cash-out requests unavailable.</p>
              <p className="mt-1 max-w-3xl font-semibold">
                Cash-out request storage did not load, so this page cannot prove
                whether sellers are waiting on payout review.
              </p>
            </div>
          ) : payoutRequests.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller cash-out requests found.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {payoutRequests.map((request) => {
                const profile = profilesById.get(request.seller_account_id);
                const blocker = payoutRequestBlockers.get(request.id);
                const blockerReason = reviewBlockReason(blocker);
                const payoutAccount = payoutAccountsByAccountId.get(
                  request.seller_account_id,
                );
                const payoutAccountReady =
                  sellerPayoutAccountReady(payoutAccount);

                return (
                  <div
                    key={request.id}
                    className="grid gap-4 p-5 text-sm xl:grid-cols-[1fr_1fr_1fr_220px]"
                  >
                    <div className="min-w-0">
                      <p className="font-black">
                        {profile?.display_name ||
                          profile?.email ||
                          "Seller account"}
                      </p>
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        {request.seller_account_id}
                      </p>
                    </div>

                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Requested
                        </dt>
                        <dd className="font-black">
                          {money(request.requested_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Est. Net
                        </dt>
                        <dd className="font-black">
                          {money(request.estimated_net_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Final Fee
                        </dt>
                        <dd className="font-black">
                          {money(request.final_processor_fee_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Final Net
                        </dt>
                        <dd className="font-black">
                          {money(request.final_net_amount)}
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <p className="text-xs font-semibold text-neutral-500">
                        Requested {shortDate(request.requested_at)}
                      </p>
                      <p className="mt-2 text-sm text-neutral-700">
                        {request.request_note || "No seller note."}
                      </p>
                      {request.admin_note ? (
                        <p className="mt-2 rounded bg-neutral-50 p-2 text-xs font-semibold text-neutral-700">
                          Admin: {request.admin_note}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs text-neutral-500">
                        Reviewed {shortDate(request.reviewed_at)} / Completed{" "}
                        {shortDate(request.completed_at)}
                      </p>
                      {cashOutPayoutProofCard(request)}
                      {blocker?.isBlocked ? (
                        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-950">
                          <p>{blockerReason}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {blocker.affectedOrderIds.map((orderId) => (
                              <Link
                                key={`${request.id}-${orderId}`}
                                href={`/admin/orders/${orderId}`}
                                className="underline"
                              >
                                Order #{orderId}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <span
                        className={`h-fit w-fit rounded border px-2 py-1 text-xs font-black ${statusTone(
                          request.status,
                        )}`}
                      >
                        {label(request.status)}
                      </span>
                      <PayoutRequestActions
                        requestId={request.id}
                        status={request.status}
                        reviewBlocked={Boolean(blocker?.isBlocked)}
                        reviewGuardUnavailable={Boolean(payoutRequestBlockerError)}
                        reviewBlockReason={blockerReason}
                        payoutAccountReady={payoutAccountReady}
                        payoutAccountBlockReason={
                          payoutAccountReady
                            ? null
                            : sellerPayoutAccountBlockReason(payoutAccount)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">
              Dag Danky Holdings LLC Rake Ledger
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              8% platform fee rows for purchases completed through TCOS website
              checkout. Outside marketplace sales are not included.
            </p>
          </div>

          {platformFeeLedgerUnavailable ? (
            <div className="p-5 text-sm text-amber-950">
              <p className="font-black">Platform fee ledger unavailable.</p>
              <p className="mt-1 max-w-3xl font-semibold">
                Platform fee storage did not load, so this page cannot prove
                whether TCOS checkout fee rows exist.
              </p>
            </div>
          ) : platformFeeEntries.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No platform fee ledger entries found yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {platformFeeEntries.slice(0, 20).map((entry) => {
                const profile = entry.seller_account_id
                  ? profilesById.get(entry.seller_account_id)
                  : undefined;

                return (
                  <div
                    key={entry.id}
                    className="grid gap-4 p-5 text-sm xl:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <div>
                      <Link
                        href={`/admin/orders/${entry.order_id}`}
                        className="font-black underline"
                      >
                        Order #{entry.order_id}
                      </Link>
                      <p className="mt-1 text-xs text-neutral-600">
                        Order Item #{entry.order_item_id}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {entry.seller_account_id
                          ? profile?.display_name ||
                            profile?.email ||
                            "Seller inventory"
                          : "Store inventory"}
                      </p>
                    </div>

                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="font-semibold text-neutral-500">Gross</dt>
                        <dd className="font-black">
                          {money(entry.gross_item_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Ship Basis
                        </dt>
                        <dd className="font-black">
                          {money(entry.shipping_allocated_amount)}
                        </dd>
                      </div>
                    </dl>

                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="font-semibold text-neutral-500">Basis</dt>
                        <dd className="font-black">
                          {money(entry.total_basis_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Dag Danky Holdings LLC Fee
                        </dt>
                        <dd className="font-black">
                          {money(entry.platform_fee_amount)}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-col gap-2 xl:items-end">
                      <span
                        className={`w-fit rounded border px-2 py-1 text-xs font-black ${statusTone(
                          entry.fee_status,
                        )}`}
                      >
                        {label(entry.fee_status)}
                      </span>
                      <p className="text-xs font-semibold text-neutral-600">
                        Rate{" "}
                        {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}
                        %
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Seller Payout Ledger Entries</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Most recent 200 seller payout rows. Payout movement is not enabled
              here yet.
            </p>
          </div>

          {payoutLedgerUnavailable ? (
            <div className="p-5 text-sm text-amber-950">
              <p className="font-black">Seller payout ledger unavailable.</p>
              <p className="mt-1 max-w-3xl font-semibold">
                Seller payout ledger storage did not load, so this page cannot
                prove whether held, eligible, paid, or reversed payout rows
                exist.
              </p>
            </div>
          ) : entries.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller payout ledger entries found yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {entries.map((entry) => {
                const profile = profilesById.get(entry.seller_account_id);
                const releaseBlockReason = [
                  "eligible",
                  "paid",
                  "reversed",
                  "cancelled",
                ].includes(entry.payout_status || "")
                  ? null
                  : payoutReleaseBlockReason(
                      ledgerOrdersById.get(entry.order_id),
                      activeCaseCountByOrderId.get(entry.order_id) || 0,
                    );
                const rowSellerProtectionSummary =
                  hasUnder20SellerProtectionMetadata(entry)
                    ? buildUnder20SellerProtectionSellerVisibilitySummary([entry])
                    : null;

                return (
                  <div
                    key={entry.id}
                    className="grid gap-4 p-5 text-sm xl:grid-cols-[1.1fr_1fr_1.2fr_220px]"
                  >
                    <div className="min-w-0">
                      <p className="font-black">
                        {profile?.display_name ||
                          profile?.email ||
                          "Seller account"}
                      </p>
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        {entry.seller_account_id}
                      </p>
                      <p className="mt-2 text-xs text-neutral-600">
                        Created {shortDate(entry.created_at)}
                      </p>
                    </div>

                    <div>
                      <Link
                        href={`/admin/orders/${entry.order_id}`}
                        className="font-black underline"
                      >
                        Order #{entry.order_id}
                      </Link>
                      <p className="mt-1 text-xs text-neutral-600">
                        Order Item #{entry.order_item_id}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        Product #{entry.product_id || "Not saved"}
                      </p>
                    </div>

                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="font-semibold text-neutral-500">Gross</dt>
                        <dd className="font-black">
                          {money(entry.gross_item_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Ship Basis
                        </dt>
                        <dd className="font-black">
                          {money(entry.shipping_allocated_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Dag Danky Holdings LLC Fee
                        </dt>
                        <dd className="font-black">
                          {money(entry.platform_fee_amount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-neutral-500">
                          Seller Payable
                        </dt>
                        <dd className="font-black">
                          {money(entry.seller_payable_amount)}
                        </dd>
                      </div>
                    </dl>

                    <div className="space-y-3">
                      <span
                        className={`w-fit rounded border px-2 py-1 text-xs font-black ${statusTone(
                          entry.payout_status,
                        )}`}
                      >
                        {label(entry.payout_status)}
                      </span>
                      <p className="text-xs font-semibold text-neutral-600">
                        Rate{" "}
                        {(Number(entry.platform_fee_rate || 0) * 100).toFixed(2)}
                        %
                      </p>
                      {rowSellerProtectionSummary ? (
                        <SellerProtectionMiniCard
                          summary={rowSellerProtectionSummary}
                        />
                      ) : null}
                      <PayoutLedgerActions
                        ledgerEntryId={entry.id}
                        status={entry.payout_status}
                        releaseBlocked={Boolean(releaseBlockReason)}
                        releaseBlockReason={releaseBlockReason}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
      <p className="mt-2 text-sm text-neutral-600">{detail}</p>
    </div>
  );
}

function SellerProtectionCard({
  summary,
  title,
  detail,
  sourceUnavailable = false,
}: {
  summary: Under20SellerProtectionSellerVisibilitySummary;
  title: string;
  detail: string;
  sourceUnavailable?: boolean;
}) {
  return (
    <section
      className={`rounded-md border p-5 ${
        sourceUnavailable
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : sellerProtectionTone(summary.status)
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
            {title}
          </p>
          <h2 className="mt-1 text-2xl font-black">
            {sourceUnavailable ? "Protection reserve unavailable" : summary.label}
          </h2>
        </div>
        <span className="rounded border border-current/20 px-2 py-1 text-xs font-black">
          2% reserve / $20 max / shipping excluded
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="font-black uppercase opacity-70">Reserve</dt>
          <dd className="mt-1 text-lg font-black">
            {sourceUnavailable ? "Unavailable" : money(summary.reserveAmount)}
          </dd>
        </div>
        <div>
          <dt className="font-black uppercase opacity-70">Covered Items</dt>
          <dd className="mt-1 text-lg font-black">
            {sourceUnavailable
              ? "Unavailable"
              : money(summary.reimbursableItemAmount)}
          </dd>
        </div>
        <div>
          <dt className="font-black uppercase opacity-70">Shipping Excluded</dt>
          <dd className="mt-1 text-lg font-black">
            {sourceUnavailable
              ? "Unavailable"
              : money(summary.shippingExcludedAmount)}
          </dd>
        </div>
        <div>
          <dt className="font-black uppercase opacity-70">Rows</dt>
          <dd className="mt-1 text-lg font-black">
            {sourceUnavailable
              ? "Unavailable"
              : `${summary.protectedRowCount} protected / ${summary.unprotectedRowCount} liable`}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm opacity-85">{detail}</p>
      {sourceUnavailable ? (
        <p className="mt-2 text-xs font-semibold opacity-80">
          Seller payout ledger storage did not load, so reserve and protection
          row counts cannot be trusted yet.
        </p>
      ) : null}
      {!sourceUnavailable && summary.status !== "not_applicable" ? (
        <p className="mt-2 text-xs font-semibold opacity-80">
          {summary.sellerResponsibility}
        </p>
      ) : null}
    </section>
  );
}

function SellerProtectionMiniCard({
  summary,
}: {
  summary: Under20SellerProtectionSellerVisibilitySummary;
}) {
  return (
    <div
      className={`rounded border p-2 text-xs ${sellerProtectionTone(summary.status)}`}
    >
      <p className="font-black">Under-$20 Protection</p>
      <p className="mt-1 font-semibold">{summary.label}</p>
      <p className="mt-1">
        Reserve {money(summary.reserveAmount)} / Covered{" "}
        {money(summary.reimbursableItemAmount)}
      </p>
      <p className="mt-1 font-semibold">
        Shipping excluded: {money(summary.shippingExcludedAmount)}
      </p>
    </div>
  );
}
