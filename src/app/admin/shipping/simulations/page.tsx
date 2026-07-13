import Link from "next/link";
import { runShippingSimulationSuite } from "../../../../lib/shipping-simulations";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function label(value: unknown) {
  return String(value || "not_set").replaceAll("_", " ").toUpperCase();
}

function tone(status: string) {
  if (status === "passed") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "ready_to_request_live_mode") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-rose-200 bg-rose-50 text-rose-900";
}

export default async function ShippingSimulationsPage() {
  const result = await runShippingSimulationSuite();

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              TCOS Shipping Reliability
            </p>
            <h1 className="mt-2 text-4xl font-black">Shipping Simulation Lab</h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              Deterministic no-postage checks for Standard Envelope routing,
              Ground Advantage fallback, seller coverage, adapter profiles, and
              dry-run provider purchase plumbing.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/shipping" className="rounded bg-neutral-950 px-4 py-2 font-bold text-white">
              Shipping Ops
            </Link>
            <Link href="/admin" className="rounded border bg-white px-4 py-2 font-bold">
              Command Center
            </Link>
          </div>
        </div>

        <section className="rounded border border-blue-200 bg-blue-50 p-5 text-blue-950">
          <h2 className="text-xl font-black">Safety Boundary</h2>
          <p className="mt-2 text-sm font-semibold">
            This suite does not buy postage, contact USPS, contact Coverage, or
            write database rows. It exercises TCOS policy logic and the dry-run
            adapter only.
          </p>
          <p className="mt-2 text-sm">
            API endpoint for automated checks:{" "}
            <code>POST /api/admin/shipping/simulations</code>
          </p>
        </section>

        <section className="grid gap-3 md:grid-cols-6">
          <Metric label="Suite" value={result.suite_version} />
          <Metric label="Status" value={label(result.run_status)} />
          <Metric
            label="Scenario Coverage"
            value={`${result.scenario_count}/${result.expected_scenario_count}`}
          />
          <Metric
            label="Scenario Keys"
            value={label(result.scenario_key_coverage_status)}
          />
          <Metric label="Passed" value={String(result.passed_count)} />
          <Metric label="Failed" value={String(result.failed_count)} />
        </section>

        <section
          className={`rounded border p-5 ${tone(
            result.live_approval.approval_status,
          )}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest opacity-75">
                Live shipping approval report
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {label(result.live_approval.approval_status)}
              </h2>
              <p className="mt-2 max-w-4xl text-sm font-semibold">
                {result.live_approval.detail}
              </p>
              <p className="mt-2 text-sm font-black">
                {result.live_approval.next_action}
              </p>
            </div>
            <div className="grid min-w-64 grid-cols-2 gap-2 text-sm">
              <Metric
                label="Requirements"
                value={`${result.live_approval.requirements_ready_count}/${result.live_approval.requirements_count}`}
              />
              <Metric
                label="Mode"
                value={label(result.live_approval.purchase_mode)}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Metric
              label="Setup Verdict"
              value={label(result.live_approval.provider_setup_status)}
            />
            <Metric
              label="Simulation Status"
              value={label(result.live_approval.simulation_status)}
            />
            <Metric
              label="Blockers"
              value={String(result.live_approval.blockers.length)}
            />
          </div>

          {result.live_approval.blockers.length > 0 ? (
            <div className="mt-4 rounded border border-current bg-white/60 p-3">
              <h3 className="font-black">Live shipping blockers</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-bold">
                {result.live_approval.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          {result.scenarios.map((scenario) => (
            <article
              key={scenario.scenario_key}
              className={`rounded border p-5 ${tone(scenario.scenario_status)}`}
            >
              <p className="text-xs font-black uppercase">
                {label(scenario.scenario_status)} / {label(scenario.scenario_key)}
              </p>
              <p className="mt-2 text-sm font-semibold">{scenario.detail}</p>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-black">Assertions</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(scenario.assertions, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function Metric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-white p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{metricLabel}</p>
      <p className="mt-2 break-words text-xl font-black">{value}</p>
    </div>
  );
}
