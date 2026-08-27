import Link from "next/link";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import ReconciliationActions from "./ReconciliationActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SellerProtectionAdjustment = {
  id: string;
  order_id: number | string | null;
  order_item_id: number | string | null;
  seller_account_id: string | null;
  provider_object_id: string | null;
  amount: number | string | null;
  currency: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

function money(value: unknown) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function safeErrorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message || "Unknown database error.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function date(value: unknown) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(value)))
    : "Not recorded";
}

function label(value: unknown) {
  return String(value || "unknown").replaceAll("_", " ").toUpperCase();
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function summaryNumber(summary: Record<string, unknown>, key: string) {
  const parsed = Number(summary[key] || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sellerProtectionShippingExcluded(
  adjustment: SellerProtectionAdjustment,
) {
  return Number(metadataRecord(adjustment.metadata).shipping_excluded_amount || 0);
}

function sellerProtectionAllocationCount(
  adjustment: SellerProtectionAdjustment,
) {
  const plan = metadataRecord(
    metadataRecord(adjustment.metadata).reimbursement_plan,
  );
  const allocations = plan.allocations;
  return Array.isArray(allocations) ? allocations.length : 0;
}

function severityClass(value: string) {
  if (value === "critical") return "border-rose-300 bg-rose-50 text-rose-950";
  if (value === "high") return "border-orange-200 bg-orange-50 text-orange-950";
  return "border-amber-200 bg-amber-50 text-amber-950";
}

function statusClass(value: unknown) {
  const status = String(value || "").toLowerCase();
  if (status === "balanced") return "border-emerald-300 bg-emerald-50 text-emerald-950";
  if (status === "differences_found") return "border-amber-300 bg-amber-50 text-amber-950";
  if (status === "failed") return "border-rose-300 bg-rose-50 text-rose-950";
  return "border-neutral-300 bg-white text-neutral-800";
}

export default async function FinancialReconciliationPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [runs, items, sellerProtectionAdjustmentsResult] = await Promise.all([
    supabase
      .from("stripe_reconciliation_runs")
      .select("*")
      .eq("store_id", storeId)
      .order("started_at", { ascending: false })
      .limit(20),
    supabase
      .from("stripe_reconciliation_items")
      .select("*")
      .eq("store_id", storeId)
      .eq("item_status", "open")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("financial_adjustment_ledger_entries")
      .select(
        "id,order_id,order_item_id,seller_account_id,provider_object_id,amount,currency,metadata,created_at",
      )
      .eq("store_id", storeId)
      .eq("provider", "tcos_internal")
      .eq("entry_type", "seller_protection_reimbursement")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (runs.error) throw runs.error;
  if (items.error) throw items.error;

  const latest = runs.data?.[0] || null;
  const openItems = items.data || [];
  const latestSummary = metadataRecord(latest?.summary);
  const sellerProtectionAdjustmentsUnavailable = Boolean(
    sellerProtectionAdjustmentsResult.error,
  );
  const sellerProtectionAdjustments =
    sellerProtectionAdjustmentsUnavailable
      ? []
      : ((sellerProtectionAdjustmentsResult.data ||
          []) as SellerProtectionAdjustment[]);
  const sellerProtectionReimbursedTotal = sellerProtectionAdjustments.reduce(
    (sum, adjustment) => sum + Number(adjustment.amount || 0),
    0,
  );
  const sellerProtectionShippingExcludedTotal =
    sellerProtectionAdjustments.reduce(
      (sum, adjustment) =>
        sum + sellerProtectionShippingExcluded(adjustment),
      0,
    );
  const sellerProtectionAllocationTotal = sellerProtectionAdjustments.reduce(
    (sum, adjustment) => sum + sellerProtectionAllocationCount(adjustment),
    0,
  );
  const criticalOpenCount = openItems.filter(
    (item) => String(item.severity || "").toLowerCase() === "critical",
  ).length;
  const highOpenCount = openItems.filter(
    (item) => String(item.severity || "").toLowerCase() === "high",
  ).length;
  const netDifference = Number(latest?.net_difference || 0);

  return (
    <main className="min-h-screen bg-neutral-100 px-6 py-8 text-neutral-950">
      <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 shadow-2xl">
        <div className="grid gap-6 p-6 text-white lg:grid-cols-[1.4fr_0.6fr] lg:p-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
              Money Ops Command Center
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
              Stripe Reconciliation
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-neutral-300 md:text-base">
              Daily Stripe balance activity matched against TCOS orders, refunds,
              disputes, fees, seller payables, transfers, payouts, and internal
              seller-protection reimbursements.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em]">
              <span className={`rounded-full border px-3 py-1.5 ${statusClass(latest?.run_status)}`}>
                Latest {label(latest?.run_status)}
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-neutral-100">
                {openItems.length} open alert{openItems.length === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-neutral-100">
                Net diff {money(netDifference)}
              </span>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-300">
              Operator actions
            </p>
            <div className="mt-4 grid gap-3">
              <ReconciliationActions />
              <div className="grid grid-cols-2 gap-2">
                <Link
                  href="/admin/seller-payouts"
                  className="rounded-2xl border border-white/15 bg-white px-4 py-3 text-center text-sm font-black text-neutral-950"
                >
                  Payouts
                </Link>
                <Link
                  href="/admin"
                  className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center text-sm font-black text-white"
                >
                  Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            Attention
          </p>
          <p className="mt-2 text-3xl font-black">{criticalOpenCount}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-600">
            critical open money alert{criticalOpenCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            High-priority review
          </p>
          <p className="mt-2 text-3xl font-black">{highOpenCount}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-600">
            high-severity difference{highOpenCount === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
            Last run window
          </p>
          <p className="mt-2 text-sm font-black leading-6">
            {latest ? `${date(latest.window_start)} → ${date(latest.window_end)}` : "No run recorded"}
          </p>
          <p className="mt-1 text-sm font-semibold text-neutral-600">
            Source {label(latest?.source)}
          </p>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Open Alerts" value={String(openItems.length)} />
        <Metric label="Latest Status" value={label(latest?.run_status)} />
        <Metric label="Stripe Transactions" value={String(latest?.stripe_transaction_count || 0)} />
        <Metric label="Matched" value={String(latest?.matched_count || 0)} />
        <Metric label="Stripe Net" value={money(latest?.stripe_net)} />
        <Metric label="Net Difference" value={money(latest?.net_difference)} />
      </section>

      <section className="mt-8 rounded-[2rem] border border-sky-200 bg-sky-50 p-5 text-sky-950 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">
              TCOS Internal Money Context
            </p>
            <h2 className="mt-1 text-2xl font-black">
              Seller-Protection Reimbursement Adjustments
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 opacity-85">
              These rows are TCOS internal seller-payable credits created when an
              eligible under-$20 Standard Envelope seller-protection claim is
              marked paid. They are not Stripe payouts by themselves; reconcile
              provider payout references separately before closing cash movement.
            </p>
          </div>
          <Link
            href="/admin/seller-payouts"
            className="rounded-2xl border border-sky-300 bg-white px-4 py-3 text-sm font-black text-sky-950 shadow-sm"
          >
            Review Payouts
          </Link>
        </div>
        {sellerProtectionAdjustmentsUnavailable ? (
          <div
            aria-live="polite"
            role="status"
            className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm"
          >
            <h3 className="text-lg font-black">
              Seller-protection adjustment ledger unavailable
            </h3>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6">
              Core Stripe reconciliation loaded, but TCOS internal
              seller-protection reimbursement rows did not. Do not treat the
              recent credits, item reimbursed, shipping excluded, or allocation
              counts below as zero until this warning is cleared.
            </p>
            <p className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold">
              {safeErrorMessage(sellerProtectionAdjustmentsResult.error)}
            </p>
          </div>
        ) : null}
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">
              Latest Run Reimbursed
            </dt>
            <dd className="mt-1 text-xl font-black">
              {money(
                summaryNumber(
                  latestSummary,
                  "tcos_seller_protection_reimbursements",
                ),
              )}
            </dd>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">
              Latest Run Excluded
            </dt>
            <dd className="mt-1 text-xl font-black">
              {money(
                summaryNumber(
                  latestSummary,
                  "tcos_seller_protection_shipping_excluded",
                ),
              )}
            </dd>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">
              Latest Run Adjustments
            </dt>
            <dd className="mt-1 text-xl font-black">
              {String(
                summaryNumber(
                  latestSummary,
                  "tcos_seller_protection_adjustment_count",
                ),
              )}
            </dd>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">
              Latest Run Allocations
            </dt>
            <dd className="mt-1 text-xl font-black">
              {String(
                summaryNumber(
                  latestSummary,
                  "tcos_seller_protection_allocation_count",
                ),
              )}
            </dd>
          </div>
        </dl>
        <dl className="mt-3 grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">Recent Credits</dt>
            <dd className="mt-1 text-xl font-black">
              {sellerProtectionAdjustmentsUnavailable
                ? "Unavailable"
                : String(sellerProtectionAdjustments.length)}
            </dd>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">Item Reimbursed</dt>
            <dd className="mt-1 text-xl font-black">
              {sellerProtectionAdjustmentsUnavailable
                ? "Unavailable"
                : money(sellerProtectionReimbursedTotal)}
            </dd>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">Shipping Excluded</dt>
            <dd className="mt-1 text-xl font-black">
              {sellerProtectionAdjustmentsUnavailable
                ? "Unavailable"
                : money(sellerProtectionShippingExcludedTotal)}
            </dd>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white/80 p-3 shadow-sm">
            <dt className="font-black uppercase opacity-70">Allocations</dt>
            <dd className="mt-1 text-xl font-black">
              {sellerProtectionAdjustmentsUnavailable
                ? "Unavailable"
                : String(sellerProtectionAllocationTotal)}
            </dd>
          </div>
        </dl>
        {sellerProtectionAdjustmentsUnavailable ? (
          <p className="mt-4 rounded-2xl border border-amber-200 bg-white/80 p-4 text-sm font-semibold text-amber-950 shadow-sm">
            Seller-protection reimbursement rows are unavailable. Retry the
            money ops view before deciding that no recent internal credits
            exist.
          </p>
        ) : sellerProtectionAdjustments.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {sellerProtectionAdjustments.slice(0, 4).map((adjustment) => (
              <article
                key={adjustment.id}
                className="rounded-2xl border border-sky-200 bg-white p-4 text-sm shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-black">
                      Order #{adjustment.order_id || "not linked"}
                    </p>
                    <p className="mt-1 text-xs font-semibold opacity-75">
                      Claim/provider object:{" "}
                      {adjustment.provider_object_id || "not recorded"}
                    </p>
                  </div>
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-black">
                    {money(adjustment.amount)}
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold opacity-75">
                  Shipping excluded:{" "}
                  {money(sellerProtectionShippingExcluded(adjustment))} /
                  Allocation rows:{" "}
                  {sellerProtectionAllocationCount(adjustment)}
                </p>
                <p className="mt-1 text-xs opacity-70">
                  Created {date(adjustment.created_at)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-sky-200 bg-white/80 p-4 text-sm font-semibold shadow-sm">
            No seller-protection reimbursement adjustments have been recorded
            yet.
          </p>
        )}
      </section>

      <section className="mt-8 rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Required review
            </p>
            <h2 className="mt-1 text-2xl font-black">Unmatched Money Queue</h2>
          </div>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-neutral-600">
            Notes required
          </span>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          Every resolution or intentional ignore requires an operator note.
        </p>
        <div className="mt-5 space-y-3">
          {openItems.length === 0 ? (
            <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-950">
              No unresolved Stripe money differences.
            </p>
          ) : (
            openItems.map((item) => (
              <article key={item.id} className={`rounded-2xl border p-4 shadow-sm ${severityClass(String(item.severity))}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black uppercase tracking-[0.12em]">
                      {label(item.severity)} / {label(item.mismatch_type)} / {label(item.transaction_category)}
                    </p>
                    <h3 className="mt-1 text-lg font-black">{item.title}</h3>
                    {item.detail ? <p className="mt-1 text-sm leading-6">{item.detail}</p> : null}
                    <p className="mt-3 text-xs font-black uppercase tracking-[0.12em]">
                      Stripe {money(item.stripe_amount)} / TCOS {money(item.internal_amount)} / Difference {money(item.difference_amount)}
                    </p>
                    <p className="mt-1 break-words text-xs opacity-80">
                      Stripe source: {item.stripe_source_id || "none"} / TCOS record: {item.internal_record_type || "none"} {item.internal_record_id || ""}
                    </p>
                  </div>
                  <ReconciliationActions itemId={String(item.id)} />
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="mt-8 rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Audit history
            </p>
            <h2 className="mt-1 text-2xl font-black">Recent Runs</h2>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs font-black uppercase tracking-[0.12em] text-neutral-500">
                <th className="p-3">Window</th>
                <th className="p-3">Source</th>
                <th className="p-3">Status</th>
                <th className="p-3">Matched</th>
                <th className="p-3">Unmatched</th>
                <th className="p-3">Difference</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data || []).map((run) => (
                <tr key={run.id} className="border-b border-neutral-100 last:border-0">
                  <td className="p-3">{date(run.window_start)} to {date(run.window_end)}</td>
                  <td className="p-3 font-semibold">{label(run.source)}</td>
                  <td className="p-3">
                    <span className={`rounded-full border px-2 py-1 text-xs font-black ${statusClass(run.run_status)}`}>
                      {label(run.run_status)}
                    </span>
                  </td>
                  <td className="p-3 font-semibold">{run.matched_count}</td>
                  <td className="p-3 font-semibold">{run.unmatched_count}</td>
                  <td className="p-3 font-black">{money(run.net_difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Metric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">{metricLabel}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}
