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

function safeErrorMessage(error: { message?: string } | string | null | undefined) {
  const message =
    typeof error === "string"
      ? error
      : error?.message || "Unknown payment simulation history error.";
  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
}

const paymentPrimaryActionClass =
  "rounded-full bg-violet-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:-translate-y-0.5 hover:bg-violet-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300";
const paymentSecondaryActionClass =
  "rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-white/15 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300";

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
  const runsUnavailable = Boolean(runsResult.error);
  const runs = runsUnavailable ? [] : ((runsResult.data || []) as SimulationRun[]);
  const scenariosResult = runs.length && !runsUnavailable
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
  const scenariosUnavailable = Boolean(scenariosResult.error);
  const scenarios = scenariosUnavailable
    ? []
    : ((scenariosResult.data || []) as SimulationScenario[]);
  const scenariosByRun = new Map<string, SimulationScenario[]>();
  for (const scenario of scenarios) {
    const rows = scenariosByRun.get(scenario.run_id) || [];
    rows.push(scenario);
    scenariosByRun.set(scenario.run_id, rows);
  }
  const latest = runs[0] || null;
  const failedRuns = runs.filter(
    (run) => run.run_status === "failed" || Number(run.failed_count || 0) > 0,
  ).length;
  const latestFailed = Boolean(
    latest &&
      (latest.run_status === "failed" || Number(latest.failed_count || 0) > 0),
  );
  const paymentLabPosture = runsUnavailable
    ? "HISTORY WARNING"
    : latestFailed
      ? "FAILURES NEED REVIEW"
      : latest
        ? "LATEST RUN CLEAN"
        : "NO RUNS YET";
  const paymentLabTone = runsUnavailable || !latest
    ? "amber"
    : latestFailed
      ? "rose"
      : "emerald";
  const paymentNextAction = runsUnavailable
    ? {
        cta: "Run No-Money Suite",
        detail:
          "History did not load, but the no-money suite can still prove the deterministic payment checks without contacting Stripe.",
      }
    : latestFailed
      ? {
          cta: "Open Money Audit",
          detail:
            "The latest run has failed assertions. Review money reconciliation and case evidence before accepting payment reliability.",
        }
      : latest
        ? {
            cta: "Keep Evidence Fresh",
            detail:
              "Latest payment simulation history is clean. Re-run the lab before release windows or payment code changes.",
          }
        : {
            cta: "Run First Lab",
            detail:
              "No payment reliability evidence has been recorded yet. Start with the no-money suite, then use sandbox tests only when needed.",
          };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f5f3ff_0,#f8fafc_40%,#fff7ed_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 bg-[radial-gradient(circle_at_top_left,rgba(196,181,253,0.26),transparent_34%),linear-gradient(135deg,#111827,#18181b_55%,#312e81)] p-6 md:flex-row md:items-end md:justify-between lg:p-8">
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
            <Link
              href="/admin/financial-reconciliation"
              className={paymentSecondaryActionClass}
            >
              Money Audit
            </Link>
            <Link
              href="/admin/order-review-cases"
              className={paymentSecondaryActionClass}
            >
              Cases
            </Link>
            <Link href="/admin" className={paymentPrimaryActionClass}>
              Command Center
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5 shadow-sm ring-1 ring-violet-900/10">
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

        <section className="grid gap-4 lg:grid-cols-3">
          <PaymentLabPostureCard
            detail={paymentNextAction.detail}
            label="Lab posture"
            status={paymentLabPosture}
            tone={paymentLabTone}
          />
          <PaymentLabPostureCard
            detail={
              stripeTestEnabled
                ? "Stripe-touching tests are available, but they still require exact typed confirmations before any sandbox object is created."
                : "Stripe-touching tests are locked because no test secret key is loaded. The deterministic no-money suite remains available."
            }
            label="Stripe boundary"
            status={stripeTestEnabled ? "SANDBOX ENABLED" : "SANDBOX LOCKED"}
            tone={stripeTestEnabled ? "sky" : "amber"}
          />
          <PaymentLabPostureCard
            detail={`${failedRuns} recorded run(s) need review before the payment lab can be treated as release-clean.`}
            label="Operator next step"
            status={paymentNextAction.cta.toUpperCase()}
            tone={failedRuns > 0 ? "rose" : "emerald"}
          />
        </section>

        <section className="grid gap-3 md:grid-cols-5">
          <Metric label="Latest" value={runsUnavailable ? "Unavailable" : label(latest?.run_status)} />
          <Metric label="Scenarios" value={runsUnavailable ? "Unavailable" : String(latest?.scenario_count || 0)} />
          <Metric label="Passed" value={runsUnavailable ? "Unavailable" : String(latest?.passed_count || 0)} />
          <Metric label="Failed" value={runsUnavailable ? "Unavailable" : String(latest?.failed_count || 0)} />
          <Metric label="Skipped" value={runsUnavailable ? "Unavailable" : String(latest?.skipped_count || 0)} />
        </section>

        {runsUnavailable ? (
          <UnavailableNotice
            title="Payment simulation history unavailable."
            diagnostic={safeErrorMessage(runsResult.error)}
          >
            TCOS could not load payment simulation runs, so the counters are
            labeled unavailable instead of shown as zero. The action buttons
            remain available under the safety boundary above.
          </UnavailableNotice>
        ) : scenariosUnavailable ? (
          <UnavailableNotice
            title="Payment simulation scenario details unavailable."
            diagnostic={safeErrorMessage(scenariosResult.error)}
          >
            TCOS loaded the run headers but could not load the scenario
            breakdown. Review the latest run status before treating the drill as
            complete.
          </UnavailableNotice>
        ) : null}

        <section className="space-y-4">
          {runsUnavailable ? null : runs.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-neutral-300 bg-white/95 p-5 text-sm font-semibold text-neutral-600 shadow-sm ring-1 ring-black/[0.02]">
              No payment reliability runs have been recorded yet.
            </p>
          ) : (
            runs.map((run) => (
              <article
                key={run.id}
                className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]"
              >
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
                  <p className={`rounded-full border px-3 py-2 text-sm font-black ${tone(run.run_status)}`}>
                    {run.passed_count} passed / {run.failed_count} failed / {run.skipped_count} skipped
                  </p>
                </div>
                {run.last_error ? (
                  <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-900">
                    Last run diagnostic: {safeErrorMessage(run.last_error)}
                  </p>
                ) : null}
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {(scenariosByRun.get(run.id) || []).map((scenario) => (
                    <section
                      key={scenario.id}
                      className={`rounded-2xl border p-4 shadow-sm ${tone(scenario.scenario_status)}`}
                    >
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
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase text-neutral-500">{metricLabel}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function PaymentLabPostureCard({
  detail,
  label: labelText,
  status,
  tone: cardTone,
}: {
  detail: string;
  label: string;
  status: string;
  tone: "amber" | "emerald" | "rose" | "sky";
}) {
  const className =
    cardTone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950 ring-emerald-900/10"
      : cardTone === "rose"
        ? "border-rose-200 bg-rose-50 text-rose-950 ring-rose-900/10"
        : cardTone === "sky"
          ? "border-sky-200 bg-sky-50 text-sky-950 ring-sky-900/10"
          : "border-amber-200 bg-amber-50 text-amber-950 ring-amber-900/10";

  return (
    <article className={`rounded-3xl border p-5 shadow-sm ring-1 ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">
        {labelText}
      </p>
      <p className="mt-3 w-fit rounded-full border border-current bg-white/70 px-3 py-1 text-xs font-black">
        {status}
      </p>
      <p className="mt-4 text-sm font-semibold leading-6">{detail}</p>
    </article>
  );
}

function UnavailableNotice({
  children,
  diagnostic,
  title,
}: {
  children: React.ReactNode;
  diagnostic: string;
  title: string;
}) {
  return (
    <section
      role="alert"
      aria-live="assertive"
      className="rounded-3xl border border-rose-200 bg-rose-50 p-5 text-rose-950 shadow-sm ring-1 ring-rose-900/10"
    >
      <h2 className="text-lg font-black">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6">{children}</p>
      <p className="mt-2 text-xs font-bold">Diagnostic: {diagnostic}</p>
    </section>
  );
}
