import Link from "next/link";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getActiveStoreId } from "../../../lib/stores";
import { getAccountProfilesByIds } from "../../../lib/account-profiles";
import {
  isMissingPayoutReviewGuardTable,
  loadSellerPayoutRequestReviewBlockers,
  type SellerPayoutRequestReviewBlocker,
} from "../../../lib/seller-payout-review-blocks";
import PayoutLedgerActions from "./PayoutLedgerActions";
import PayoutRequestActions from "./PayoutRequestActions";

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
  created_at: string;
  updated_at: string | null;
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

  return `${parts.join(" and ")} blocking payout release.`;
}

function money(value: number | string | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
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
  const adminEvents = (adminEventData || []) as SellerPayoutAdminEvent[];
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
      : error.message || "Could not load payout review blockers.";
  }

  const profilesById = await getAccountProfilesByIds(
    [
      ...entries.map((entry) => entry.seller_account_id),
      ...platformFeeEntries.map((entry) => entry.seller_account_id),
      ...payoutRequests.map((request) => request.seller_account_id),
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
              {` ${error.message}`}
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
              checkout rake reporting: {platformFeeError.message}
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
              review: {payoutRequestError.message}
            </p>
          </section>
        ) : null}

        {adminEventError ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="text-xl font-black">Payout Audit Not Available</h2>
            <p className="mt-2 text-sm font-semibold">
              Apply the seller payout admin event migration before using audit
              history: {adminEventError.message}
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Held Payable"
            value={money(heldPayableTotal)}
            detail={`${heldEntries.length} held ledger row(s)`}
          />
          <MetricTile
            label="Eligible Rows"
            value={String(eligibleEntries.length)}
            detail="Ready once release rules are enabled"
          />
          <MetricTile
            label="Website Rake"
            value={money(allSitePlatformFeeTotal)}
            detail={`${platformFeeEntries.length} TCOS checkout fee row(s)`}
          />
          <MetricTile
            label="Blocked Requests"
            value={String(blockedOpenPayoutRequests.length)}
            detail={`${openPayoutRequests.length} open cash-out request(s)`}
          />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Payout Audit Trail</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Recent admin release, hold, review, and cash-out status events.
            </p>
          </div>

          {adminEvents.length === 0 ? (
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

          {payoutRequests.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller cash-out requests found.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {payoutRequests.map((request) => {
                const profile = profilesById.get(request.seller_account_id);
                const blocker = payoutRequestBlockers.get(request.id);
                const blockerReason = reviewBlockReason(blocker);

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
                      {request.provider_payout_reference ? (
                        <p className="mt-2 break-all text-xs font-semibold text-neutral-700">
                          Provider Ref: {request.provider_payout_reference}
                        </p>
                      ) : null}
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

          {platformFeeEntries.length === 0 ? (
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

          {entries.length === 0 ? (
            <p className="p-5 text-sm text-neutral-600">
              No seller payout ledger entries found yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {entries.map((entry) => {
                const profile = profilesById.get(entry.seller_account_id);

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
                      <PayoutLedgerActions
                        ledgerEntryId={entry.id}
                        status={entry.payout_status}
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
