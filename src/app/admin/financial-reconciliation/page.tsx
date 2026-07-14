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
  if (value === "critical") return "border-rose-300 bg-rose-50 text-rose-900";
  if (value === "high") return "border-orange-200 bg-orange-50 text-orange-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
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
  if (sellerProtectionAdjustmentsResult.error) {
    throw sellerProtectionAdjustmentsResult.error;
  }

  const latest = runs.data?.[0] || null;
  const openItems = items.data || [];
  const latestSummary = metadataRecord(latest?.summary);
  const sellerProtectionAdjustments =
    (sellerProtectionAdjustmentsResult.data || []) as SellerProtectionAdjustment[];
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

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black">Stripe Reconciliation</h1>
          <p className="mt-2 max-w-3xl text-neutral-600">
            Daily Stripe balance activity matched against TCOS orders, refunds,
            disputes, fees, seller payables, transfers, and payouts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ReconciliationActions />
          <Link href="/admin/seller-payouts" className="rounded border bg-white px-4 py-2 text-sm font-bold">
            Payouts
          </Link>
          <Link href="/admin" className="rounded border bg-white px-4 py-2 text-sm font-bold">
            Dashboard
          </Link>
        </div>
      </div>

      <section className="mt-8 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Open Alerts" value={String(openItems.length)} />
        <Metric label="Latest Status" value={label(latest?.run_status)} />
        <Metric label="Stripe Transactions" value={String(latest?.stripe_transaction_count || 0)} />
        <Metric label="Matched" value={String(latest?.matched_count || 0)} />
        <Metric label="Stripe Net" value={money(latest?.stripe_net)} />
        <Metric label="Net Difference" value={money(latest?.net_difference)} />
      </section>

      <section className="mt-8 rounded border border-sky-200 bg-sky-50 p-5 text-sky-950">
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
            className="rounded border border-sky-300 bg-white px-3 py-2 text-sm font-black text-sky-950"
          >
            Review Payouts
          </Link>
        </div>
        <dl className="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div className="rounded border border-sky-200 bg-white/70 p-3">
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
          <div className="rounded border border-sky-200 bg-white/70 p-3">
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
          <div className="rounded border border-sky-200 bg-white/70 p-3">
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
          <div className="rounded border border-sky-200 bg-white/70 p-3">
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
          <div className="rounded border border-sky-200 bg-white/70 p-3">
            <dt className="font-black uppercase opacity-70">Recent Credits</dt>
            <dd className="mt-1 text-xl font-black">
              {String(sellerProtectionAdjustments.length)}
            </dd>
          </div>
          <div className="rounded border border-sky-200 bg-white/70 p-3">
            <dt className="font-black uppercase opacity-70">Item Reimbursed</dt>
            <dd className="mt-1 text-xl font-black">
              {money(sellerProtectionReimbursedTotal)}
            </dd>
          </div>
          <div className="rounded border border-sky-200 bg-white/70 p-3">
            <dt className="font-black uppercase opacity-70">Shipping Excluded</dt>
            <dd className="mt-1 text-xl font-black">
              {money(sellerProtectionShippingExcludedTotal)}
            </dd>
          </div>
          <div className="rounded border border-sky-200 bg-white/70 p-3">
            <dt className="font-black uppercase opacity-70">Allocations</dt>
            <dd className="mt-1 text-xl font-black">
              {String(sellerProtectionAllocationTotal)}
            </dd>
          </div>
        </dl>
        {sellerProtectionAdjustments.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {sellerProtectionAdjustments.slice(0, 4).map((adjustment) => (
              <article
                key={adjustment.id}
                className="rounded border border-sky-200 bg-white p-3 text-sm"
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
                  <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-black">
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
          <p className="mt-4 rounded border border-sky-200 bg-white/70 p-3 text-sm font-semibold">
            No seller-protection reimbursement adjustments have been recorded
            yet.
          </p>
        )}
      </section>

      <section className="mt-8 rounded border bg-white p-5">
        <h2 className="text-2xl font-black">Unmatched Money Queue</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Every resolution or intentional ignore requires an operator note.
        </p>
        <div className="mt-5 space-y-3">
          {openItems.length === 0 ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
              No unresolved Stripe money differences.
            </p>
          ) : (
            openItems.map((item) => (
              <article key={item.id} className={`rounded border p-4 ${severityClass(String(item.severity))}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide">
                      {label(item.severity)} / {label(item.mismatch_type)} / {label(item.transaction_category)}
                    </p>
                    <h3 className="mt-1 font-black">{item.title}</h3>
                    {item.detail ? <p className="mt-1 text-sm">{item.detail}</p> : null}
                    <p className="mt-2 text-xs font-semibold">
                      Stripe {money(item.stripe_amount)} / TCOS {money(item.internal_amount)} / Difference {money(item.difference_amount)}
                    </p>
                    <p className="mt-1 text-xs">
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

      <section className="mt-8 rounded border bg-white p-5">
        <h2 className="text-2xl font-black">Recent Runs</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b"><th className="p-2">Window</th><th className="p-2">Source</th><th className="p-2">Status</th><th className="p-2">Matched</th><th className="p-2">Unmatched</th><th className="p-2">Difference</th></tr></thead>
            <tbody>
              {(runs.data || []).map((run) => (
                <tr key={run.id} className="border-b border-neutral-100">
                  <td className="p-2">{date(run.window_start)} to {date(run.window_end)}</td>
                  <td className="p-2">{label(run.source)}</td>
                  <td className="p-2 font-bold">{label(run.run_status)}</td>
                  <td className="p-2">{run.matched_count}</td>
                  <td className="p-2">{run.unmatched_count}</td>
                  <td className="p-2">{money(run.net_difference)}</td>
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
    <div className="rounded border bg-white p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{metricLabel}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}
