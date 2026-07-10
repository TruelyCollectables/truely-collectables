import Link from "next/link";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getStripeTestSecretKey } from "../../../lib/stripe-credentials";
import SimulationActions from "./SimulationActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SimulationRun = {
  id: string;
  run_mode: string;
  run_status: string;
  suite_version: string;
  scenario_count: number;
  passed_count: number;
  failed_count: number;
  skipped_count: number;
  last_error: string | null;
  started_at: string;
  completed_at: string | null;
};

type SimulationScenario = {
  id: string;
  run_id: string;
  scenario_key: string;
  scenario_status: string;
  detail: string;
  assertions: Record<string, unknown> | null;
  provider_object_ids: Record<string, unknown> | null;
};

function label(value: unknown) {
  return String(value || "not_set").replaceAll("_", " ").toUpperCase();
}

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not completed";
}

function tone(status: string) {
  if (status === "passed") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-900";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export default async function PaymentSimulationsPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const stripeTestEnabled = Boolean(getStripeTestSecretKey());
  const runsResult = await supabase
    .from("payment_simulation_runs")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (runsResult.error) throw runsResult.error;
  const runs = (runsResult.data || []) as SimulationRun[];
  const scenariosResult = runs.length
    ? await supabase
        .from("payment_simulation_scenarios")
        .select("*")
        .eq("store_id", storeId)
        .in(
          "run_id",
          runs.map((run) => run.id),
        )
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (scenariosResult.error) throw scenariosResult.error;
  const scenarios = (scenariosResult.data || []) as SimulationScenario[];
  const scenariosByRun = new Map<string, SimulationScenario[]>();
  for (const scenario of scenarios) {
    const rows = scenariosByRun.get(scenario.run_id) || [];
    rows.push(scenario);
    scenariosByRun.set(scenario.run_id, rows);
  }
  const latest = runs[0] || null;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-violet-300">
              TCOS Payment Reliability
            </p>
            <h1 className="mt-2 text-4xl font-black">Payment Simulation Lab</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Regression checks for 8% fee allocation, declines, idempotency,
              refunds, disputes, payout recovery, money reconciliation, and a
              disposable storefront checkout-to-refund transaction.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/financial-reconciliation" className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold">
              Money Audit
            </Link>
            <Link href="/admin/order-review-cases" className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold">
              Cases
            </Link>
            <Link href="/admin" className="rounded-md bg-violet-300 px-4 py-2 text-sm font-bold text-neutral-950">
              Command Center
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="rounded-md border border-violet-200 bg-violet-50 p-5">
          <h2 className="text-xl font-black">Safety Boundary</h2>
          <p className="mt-2 text-sm">
            The no-money suite never contacts Stripe. The sandbox suite is
            hard-locked to an <code>sk_test_</code> key, tags every provider
            object, and quarantines its webhook events from TCOS financial data.
            The full checkout drill temporarily creates a non-eBay product and
            test-tagged order, verifies the real TCOS rows, then removes them.
          </p>
          <p className="mt-2 text-sm font-bold">
            Stripe sandbox: {stripeTestEnabled ? "ENABLED" : "LOCKED"}. Subscription renewals are excluded while the monthly plan is on hold.
          </p>
          <div className="mt-4">
            <SimulationActions stripeTestEnabled={stripeTestEnabled} />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-5">
          <Metric label="Latest" value={label(latest?.run_status)} />
          <Metric label="Scenarios" value={String(latest?.scenario_count || 0)} />
          <Metric label="Passed" value={String(latest?.passed_count || 0)} />
          <Metric label="Failed" value={String(latest?.failed_count || 0)} />
          <Metric label="Skipped" value={String(latest?.skipped_count || 0)} />
        </section>

        <section className="space-y-4">
          {runs.length === 0 ? (
            <p className="rounded-md border bg-white p-5 text-sm text-neutral-600">
              No payment reliability runs have been recorded yet.
            </p>
          ) : (
            runs.map((run) => (
              <article key={run.id} className="rounded-md border bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-neutral-500">
                      {label(run.run_mode)} / Suite {run.suite_version}
                    </p>
                    <h2 className="mt-1 text-xl font-black">{label(run.run_status)}</h2>
                    <p className="mt-1 text-xs text-neutral-600">
                      {date(run.started_at)} to {date(run.completed_at)}
                    </p>
                  </div>
                  <p className={`rounded border px-3 py-2 text-sm font-black ${tone(run.run_status)}`}>
                    {run.passed_count} passed / {run.failed_count} failed / {run.skipped_count} skipped
                  </p>
                </div>
                {run.last_error ? (
                  <p className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-900">
                    {run.last_error}
                  </p>
                ) : null}
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {(scenariosByRun.get(run.id) || []).map((scenario) => (
                    <section key={scenario.id} className={`rounded border p-4 ${tone(scenario.scenario_status)}`}>
                      <p className="text-xs font-black uppercase">
                        {label(scenario.scenario_status)} / {label(scenario.scenario_key)}
                      </p>
                      <p className="mt-2 text-sm font-semibold">{scenario.detail}</p>
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-black">Audit details</summary>
                        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(
                            {
                              assertions: scenario.assertions || {},
                              provider_objects: scenario.provider_object_ids || {},
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </section>
                  ))}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-white p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{metricLabel}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}
