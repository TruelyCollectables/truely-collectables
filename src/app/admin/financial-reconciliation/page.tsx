import Link from "next/link";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import ReconciliationActions from "./ReconciliationActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function severityClass(value: string) {
  if (value === "critical") return "border-rose-300 bg-rose-50 text-rose-900";
  if (value === "high") return "border-orange-200 bg-orange-50 text-orange-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export default async function FinancialReconciliationPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [runs, items] = await Promise.all([
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
  ]);

  if (runs.error) throw runs.error;
  if (items.error) throw items.error;

  const latest = runs.data?.[0] || null;
  const openItems = items.data || [];

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
