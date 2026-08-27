import Link from "next/link";
import { runShippingPurchaseAttemptAuditSimulationSuite } from "../../../../lib/shipping-purchase-attempt-audit-simulations";
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

function listValue(values: readonly string[]) {
  return values.length > 0 ? values.join(", ") : "none";
}

export default async function ShippingSimulationsPage() {
  const result = await runShippingSimulationSuite();
  const purchaseAudit = runShippingPurchaseAttemptAuditSimulationSuite();
  const scenarioCoveragePassed =
    result.scenario_coverage_status === "passed" &&
    result.scenario_key_coverage_status === "passed";
  const purchaseAuditCoveragePassed =
    purchaseAudit.scenario_coverage_status === "passed" &&
    purchaseAudit.scenario_key_coverage_status === "passed";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ecfeff_0,#f8fafc_40%,#fff7ed_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <header className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="bg-[radial-gradient(circle_at_top_left,rgba(103,232,249,0.24),transparent_34%),linear-gradient(135deg,#0f172a,#111827_55%,#164e63)] p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                TCOS Shipping Reliability
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                Shipping Simulation Lab
              </h1>
              <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
                Deterministic no-postage checks for Standard Envelope routing,
                Ground Advantage fallback, seller coverage, adapter profiles, and
                dry-run provider purchase plumbing. It also verifies provider
                purchase-attempt audit text for live-gate, missing-setup, dry-run,
                and packet-output cases.
              </p>
            </div>
            <div className="grid min-w-[300px] grid-cols-3 gap-3 rounded-3xl border border-white/10 bg-white/[0.06] p-4 shadow-xl shadow-black/20">
              <HeaderStat label="Shipping" value={label(result.run_status)} />
              <HeaderStat
                label="Scenarios"
                value={`${result.passed_count}/${result.scenario_count}`}
              />
              <HeaderStat
                label="Live Gate"
                value={label(result.live_approval.approval_status)}
              />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/admin/shipping"
              className="rounded-full bg-white px-4 py-2.5 text-sm font-black text-neutral-950 shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-200 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              Shipping Ops
            </Link>
            <Link
              href="/admin"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:border-white hover:bg-white/15 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              Command Center
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        <section className="rounded-3xl border border-blue-200 bg-blue-50 p-5 text-blue-950 shadow-sm ring-1 ring-blue-950/5">
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
          className={`rounded-3xl border p-5 shadow-sm ring-1 ring-black/[0.02] ${
            scenarioCoveragePassed
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest opacity-75">
                Scenario coverage guardrail
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {scenarioCoveragePassed ? "Expected manifest confirmed" : "Scenario drift detected"}
              </h2>
              <p className="mt-2 max-w-4xl text-sm font-semibold">
                Count status: {label(result.scenario_coverage_status)}. Key status:{" "}
                {label(result.scenario_key_coverage_status)}.
              </p>
            </div>
            <div className="grid min-w-64 grid-cols-2 gap-2 text-sm">
              <Metric
                label="Expected"
                value={String(result.expected_scenario_count)}
              />
              <Metric label="Actual" value={String(result.scenario_count)} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Metric
              label="Missing Scenario Keys"
              value={listValue(result.missing_scenario_keys)}
            />
            <Metric
              label="Unexpected Scenario Keys"
              value={listValue(result.unexpected_scenario_keys)}
            />
          </div>

          <details className="mt-4 rounded-2xl border border-current bg-white/60 p-3 text-sm shadow-inner">
            <summary className="cursor-pointer font-black">
              Expected scenario key manifest
            </summary>
            <ol className="mt-3 list-decimal space-y-1 pl-5 font-semibold">
              {result.expected_scenario_keys.map((scenarioKey) => (
                <li key={scenarioKey}>{scenarioKey}</li>
              ))}
            </ol>
          </details>
        </section>

        <section className="rounded-3xl border border-indigo-200 bg-indigo-50 p-5 text-indigo-950 shadow-sm ring-1 ring-indigo-950/5">
          <p className="text-xs font-black uppercase tracking-widest opacity-75">
            Seller-protection money trail
          </p>
          <h2 className="mt-1 text-2xl font-black">
            {result.seller_protection_allocation_contract.title}
          </h2>
          <p className="mt-2 max-w-4xl text-sm font-semibold">
            This first-class contract makes the under-$20 Standard Envelope
            allocation rule visible before launch: opted-in sellers can be
            reimbursed for protected item sale amount only, shipping stays
            excluded, and non-opted-in sellers remain liable for buyer refunds
            when delivery evidence fails TCOS rules.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Metric
              label="Scenario Proof"
              value={result.seller_protection_allocation_contract.scenarioKey}
            />
            <Metric
              label="Item-only reimbursement"
              value={
                result.seller_protection_allocation_contract
                  .itemOnlyReimbursementRule
              }
            />
            <Metric
              label="Shipping exclusion"
              value={
                result.seller_protection_allocation_contract
                  .shippingExclusionRule
              }
            />
            <Metric
              label="No opt-in liability"
              value={
                result.seller_protection_allocation_contract
                  .nonOptedInSellerLiabilityRule
              }
            />
          </div>
          <p className="mt-4 rounded-2xl border border-indigo-300 bg-white p-3 text-sm font-bold shadow-sm">
            {result.seller_protection_allocation_contract.operatorProof}
          </p>
        </section>

        <section
          className={`rounded-3xl border p-5 shadow-sm ring-1 ring-black/[0.02] ${
            purchaseAuditCoveragePassed
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest opacity-75">
                Purchase Attempt Audit Coverage
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {purchaseAuditCoveragePassed
                  ? "Audit manifest confirmed"
                  : "Purchase audit drift detected"}
              </h2>
              <p className="mt-2 max-w-4xl text-sm font-semibold">
                These no-postage checks protect the provider purchase-attempt
                audit text shown in blocked-event cards, order label cards,
                shipping exception CSV rows, and label packets.
              </p>
            </div>
            <div className="grid min-w-64 grid-cols-2 gap-2 text-sm">
              <Metric
                label="Audit Expected"
                value={String(purchaseAudit.expected_scenario_count)}
              />
              <Metric
                label="Audit Actual"
                value={String(purchaseAudit.scenario_count)}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Metric label="Audit Status" value={label(purchaseAudit.run_status)} />
            <Metric
              label="Audit Scenario Keys"
              value={label(purchaseAudit.scenario_key_coverage_status)}
            />
            <Metric label="Audit Failed" value={String(purchaseAudit.failed_count)} />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Metric
              label="Missing Purchase Audit Keys"
              value={listValue(purchaseAudit.missing_scenario_keys)}
            />
            <Metric
              label="Unexpected Purchase Audit Keys"
              value={listValue(purchaseAudit.unexpected_scenario_keys)}
            />
          </div>

          <details className="mt-4 rounded-2xl border border-current bg-white/60 p-3 text-sm shadow-inner">
            <summary className="cursor-pointer font-black">
              Expected purchase audit scenario key manifest
            </summary>
            <ol className="mt-3 list-decimal space-y-1 pl-5 font-semibold">
              {purchaseAudit.expected_scenario_keys.map((scenarioKey) => (
                <li key={scenarioKey}>{scenarioKey}</li>
              ))}
            </ol>
          </details>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {purchaseAudit.scenarios.map((scenario) => (
              <article
                key={scenario.scenario_key}
                className={`rounded-2xl border p-4 shadow-sm ${tone(
                  scenario.scenario_status,
                )}`}
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
          </div>
        </section>

        <section
          className={`rounded-3xl border p-5 shadow-sm ring-1 ring-black/[0.02] ${tone(
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
            <div className="mt-4 rounded-2xl border border-current bg-white/60 p-3 shadow-inner">
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
              className={`rounded-3xl border p-5 shadow-sm ring-1 ring-black/[0.02] ${tone(
                scenario.scenario_status,
              )}`}
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
    <div className="rounded-2xl border border-neutral-200 bg-white/95 p-4 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase text-neutral-500">{metricLabel}</p>
      <p className="mt-2 break-words text-xl font-black">{value}</p>
    </div>
  );
}

function HeaderStat({
  label: metricLabel,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-400">
        {metricLabel}
      </p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  );
}
