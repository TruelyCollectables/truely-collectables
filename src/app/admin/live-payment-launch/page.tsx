import Link from "next/link";
import {
  evaluateLivePaymentLaunch,
  type LivePaymentCheckStatus,
} from "../../../lib/live-payment-launch";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { LIVE_MONEY_JSON_EVIDENCE } from "../../../lib/live-money-evidence";
import LivePaymentGateActions from "./LivePaymentGateActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function tone(status: LivePaymentCheckStatus) {
  if (status === "passed") return "border-green-200 bg-green-50 text-green-900";
  if (status === "warning") return "border-yellow-200 bg-yellow-50 text-yellow-900";
  return "border-red-200 bg-red-50 text-red-900";
}

function label(status: LivePaymentCheckStatus) {
  if (status === "passed") return "Passed";
  if (status === "warning") return "Review";
  return "Blocked";
}

function safeErrorMessage(error: { message?: string } | string | null | undefined) {
  const message =
    typeof error === "string"
      ? error
      : error?.message || "Unknown live-payment launch history error.";
  return String(message).replace(/\s+/g, " ").trim().slice(0, 220);
}

type GatePostureTone = "amber" | "emerald" | "red" | "sky";

const gatePrimaryLinkClass =
  "rounded-full bg-neutral-950 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
const gateSecondaryLinkClass =
  "rounded-full border border-neutral-300 bg-white px-4 py-2 text-sm font-black text-neutral-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
const gateEmeraldLinkClass =
  "rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-black text-emerald-950 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-100 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400";

export default async function LivePaymentLaunchPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [report, eventsResult] = await Promise.all([
    evaluateLivePaymentLaunch({ supabase, storeId }),
    supabase
      .from("live_payment_launch_events")
      .select("id,event_type,actor,note,approval_version,created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const {
    approvalBlockingCount,
    blockedCount,
    launchLockCount,
    passedCount,
    warningCount,
  } = report.summary;
  const paymentGatePosture = report.livePaymentsEnabled
    ? "RUNTIME ENABLED"
    : approvalBlockingCount > 0
      ? "APPROVAL BLOCKERS"
      : launchLockCount > 0
        ? "LAUNCH LOCKED"
        : "READY FOR FINAL WINDOW";
  const paymentPostureTone: GatePostureTone = report.livePaymentsEnabled
    ? "emerald"
    : approvalBlockingCount > 0
      ? "red"
      : launchLockCount > 0
        ? "amber"
        : "sky";
  const paymentNextStep =
    approvalBlockingCount > 0
      ? "Clear approval blockers"
      : launchLockCount > 0
        ? "Hold final runtime switch"
        : report.livePaymentsEnabled
          ? "Monitor live checkout"
          : "Prepare final approval";

  return (
    <main className="min-h-screen bg-neutral-50 px-6 py-8 text-neutral-950">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">
                Real-money control plane
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight">
                Live Payment Launch Gate
              </h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
                TCOS requires matching live Stripe infrastructure, a current
                database approval, and the environment kill switch. Missing
                either lock keeps every Stripe Checkout creation path closed.
              </p>
              <p className="mt-2 text-xs font-bold text-neutral-400">
                Report generated: {report.generatedAt}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/launch-readiness"
                className={gateSecondaryLinkClass}
              >
                Launch Readiness
              </Link>
              <Link
                href="/admin/launch-gate-drill"
                className={gateSecondaryLinkClass}
              >
                Gate Drill
              </Link>
              <Link
                href="/admin/payment-simulations"
                className={gatePrimaryLinkClass}
              >
                Payment Lab
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <GatePostureCard
            detail={report.summary.operatorSummary}
            label="Payment gate posture"
            status={paymentGatePosture}
            tone={paymentPostureTone}
          />
          <GatePostureCard
            detail={`${approvalBlockingCount} approval blocker(s) must be cleared before recording a database approval.`}
            label="Database approval"
            status={report.approvalReady ? "APPROVAL READY" : "NOT APPROVABLE"}
            tone={report.approvalReady ? "emerald" : "red"}
          />
          <GatePostureCard
            detail={`Runtime is ${report.livePaymentsEnabled ? "open" : "closed"}; ${launchLockCount} launch lock(s) still guard Stripe Checkout creation.`}
            label="Operator next step"
            status={paymentNextStep.toUpperCase()}
            tone={report.livePaymentsEnabled ? "emerald" : "amber"}
          />
        </section>

        <section
          className={`rounded-3xl border p-6 shadow-sm ring-1 ${
            report.livePaymentsEnabled
              ? "border-green-300 bg-green-50 ring-green-900/10"
              : "border-red-300 bg-red-50 ring-red-900/10"
          }`}
        >
          <div className="grid gap-4 md:grid-cols-5">
            <GateMetric
              label="Runtime"
              value={report.livePaymentsEnabled ? "ENABLED" : "LOCKED"}
            />
            <GateMetric
              label="Stripe Mode"
              value={report.paymentMode.toUpperCase()}
            />
            <GateMetric label="Passed" value={passedCount} />
            <GateMetric
              label="Approval Blockers"
              value={approvalBlockingCount}
            />
            <GateMetric label="Launch Locks" value={launchLockCount} />
          </div>
          <p className="mt-5 rounded-2xl border border-current/20 bg-white/70 p-4 text-sm font-bold leading-6">
            Operator summary: {report.summary.operatorSummary}
          </p>
          <p className="mt-5 text-sm font-semibold leading-6">
            Approval version: <code>{report.approvalVersion}</code>. Total
            blocked: {blockedCount}. Review warnings: {warningCount}.
          </p>
          <div className="mt-5">
            <LivePaymentGateActions
              approvalDatabaseReady={report.approvalDatabaseReady}
              approvalReady={report.approvalReady}
            />
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
                Operator next actions
              </p>
              <h2 className="mt-2 text-2xl font-black">
                What remains before live money
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
                Approval blockers must be cleared before database approval can be
                recorded. Launch locks are intentional final controls that keep live
                Checkout closed until the go-live window.
              </p>
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-black">
              {approvalBlockingCount} approval blocker(s), {launchLockCount}{" "}
              launch lock(s)
            </div>
          </div>
          {report.summary.nextActions.length ? (
            <ol className="mt-5 space-y-3">
              {report.summary.nextActions.map((item) => (
                <li
                  key={item.key}
                  className={`rounded-2xl border p-4 ${tone(item.status)}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-black">{item.label}</p>
                    <span className="rounded-full border border-current bg-white/70 px-2 py-1 text-xs font-black uppercase">
                      {approvalBlockingCount > 0 &&
                      item.status === "blocked" &&
                      item.key !== "database_approval" &&
                      item.key !== "runtime_switch"
                        ? "Approval blocker"
                        : item.status === "blocked"
                          ? "Launch lock"
                          : label(item.status)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6">{item.detail}</p>
                  <p className="mt-2 text-sm font-bold leading-6">Next: {item.action}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-5 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-900">
              No live-payment approval blockers or launch locks remain. Continue with final
              operator approval, runtime switch review, and post-launch monitoring.
            </p>
          )}
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm ring-1 ring-emerald-900/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest">
                Final evidence packet
              </p>
              <h2 className="mt-2 text-2xl font-black">
                {LIVE_MONEY_JSON_EVIDENCE.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
                Archive this read-only JSON proof before approving the database
                lock or changing the runtime switch. The evidence command must
                show the accepted go-live state during the final launch window.
              </p>
            </div>
            <Link
              href="/api/admin/launch-readiness?format=handoff-bundle"
              className={gateEmeraldLinkClass}
            >
              Hand-off Bundle
            </Link>
          </div>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Post-smoke raw JSON command
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.statusCommand}
              </dd>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Final-window raw preflight command
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.preflightCommand}
              </dd>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Post-smoke archive helper
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.archiveCommand}
              </dd>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Final-window preflight archive helper
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.preflightArchiveCommand}
              </dd>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">Schema</dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.schema}
              </dd>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Accepted go-live states
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.readyStates.join(", ")}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm font-semibold leading-6">
            Halt if the JSON evidence is missing or reports{" "}
            <span className="font-mono text-xs">
              {LIVE_MONEY_JSON_EVIDENCE.blockedStates.join(", ")}
            </span>
            . Do not change{" "}
            <code className="rounded bg-white px-1 py-0.5">
              TCOS_LIVE_PAYMENTS_ENABLED
            </code>{" "}
            while any halt state is present.
          </p>
          <p className="mt-2 text-sm font-semibold leading-6">
            Timestamped helper output writes under{" "}
            <code className="rounded bg-white px-1 py-0.5">
              {LIVE_MONEY_JSON_EVIDENCE.archiveDirectory}
            </code>
            . {LIVE_MONEY_JSON_EVIDENCE.readOnlyGuarantee}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <h3 className="font-black uppercase text-emerald-700">
                Supabase bootstrap environment
              </h3>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.supabaseBootstrap.map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-white p-3">
              <h3 className="font-black uppercase text-emerald-700">
                Final live-payment runtime environment
              </h3>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.environmentChecklist.finalLivePaymentRuntime.map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {report.checks.map((item) => (
            <article
              key={item.key}
              className={`rounded-2xl border p-5 shadow-sm ${tone(item.status)}`}
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="font-black">{item.label}</h2>
                <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
                  {label(item.status)}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6">{item.detail}</p>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-black/[0.02]">
          <h2 className="text-xl font-black">Immutable Approval History</h2>
          {eventsResult.error ? (
            <HistoryUnavailableNotice
              diagnostic={safeErrorMessage(eventsResult.error)}
            />
          ) : eventsResult.data?.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Event</th>
                    <th className="py-2 pr-4">Operator</th>
                    <th className="py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsResult.data.map((event) => (
                    <tr key={event.id} className="border-b align-top">
                      <td className="py-3 pr-4">{event.created_at}</td>
                      <td className="py-3 pr-4 font-bold uppercase">
                        {event.event_type}
                      </td>
                      <td className="py-3 pr-4">{event.actor}</td>
                      <td className="py-3">{event.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">
              No approval or revocation has been recorded.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function GatePostureCard({
  detail,
  label: labelText,
  status,
  tone: cardTone,
}: {
  detail: string;
  label: string;
  status: string;
  tone: GatePostureTone;
}) {
  const className =
    cardTone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950 ring-emerald-900/10"
      : cardTone === "sky"
        ? "border-sky-200 bg-sky-50 text-sky-950 ring-sky-900/10"
        : cardTone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-950 ring-amber-900/10"
          : "border-red-200 bg-red-50 text-red-950 ring-red-900/10";

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

function HistoryUnavailableNotice({ diagnostic }: { diagnostic: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950 shadow-sm ring-1 ring-rose-900/10"
    >
      <p className="font-black">Approval history unavailable.</p>
      <p className="mt-2 font-semibold leading-6">
        This panel is paused instead of showing an empty approval trail. The
        live-payment gate remains governed by the current launch checks above.
      </p>
      <p className="mt-2 text-xs font-bold">Diagnostic: {diagnostic}</p>
    </div>
  );
}

function GateMetric({
  label: metricLabel,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-current/20 bg-white/70 p-4 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
        {metricLabel}
      </p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
