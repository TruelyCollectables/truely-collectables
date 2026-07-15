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

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              Real-money control plane
            </p>
            <h1 className="mt-2 text-4xl font-black">Live Payment Launch Gate</h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              TCOS requires matching live Stripe infrastructure, a current database
              approval, and the environment kill switch. Missing either lock keeps
              every Stripe Checkout creation path closed.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/admin/launch-readiness" className="rounded border bg-white px-4 py-2">
              Launch Readiness
            </Link>
            <Link href="/admin/launch-gate-drill" className="rounded border bg-white px-4 py-2">
              Gate Drill
            </Link>
            <Link href="/admin/payment-simulations" className="rounded border bg-white px-4 py-2">
              Payment Lab
            </Link>
          </div>
        </div>

        <section
          className={`mb-8 rounded border p-6 ${
            report.livePaymentsEnabled
              ? "border-green-300 bg-green-50"
              : "border-red-300 bg-red-50"
          }`}
        >
          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Runtime</p>
              <p className="mt-1 text-2xl font-black">
                {report.livePaymentsEnabled ? "ENABLED" : "LOCKED"}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Stripe Mode</p>
              <p className="mt-1 text-2xl font-black">{report.paymentMode.toUpperCase()}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Passed</p>
              <p className="mt-1 text-2xl font-black">{passedCount}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Approval Blockers</p>
              <p className="mt-1 text-2xl font-black">{approvalBlockingCount}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Launch Locks</p>
              <p className="mt-1 text-2xl font-black">{launchLockCount}</p>
            </div>
          </div>
          <p className="mt-5 rounded border border-current/20 bg-white/60 p-4 text-sm font-bold leading-6">
            Operator summary: {report.summary.operatorSummary}
          </p>
          <p className="mt-5 text-sm">
            Approval version: <code>{report.approvalVersion}</code>. Report generated {report.generatedAt}.
            Total blocked: {blockedCount}. Review warnings: {warningCount}.
          </p>
          <div className="mt-5">
            <LivePaymentGateActions
              approvalDatabaseReady={report.approvalDatabaseReady}
              approvalReady={report.approvalReady}
            />
          </div>
        </section>

        <section className="mb-8 rounded border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-neutral-500">
                Operator next actions
              </p>
              <h2 className="mt-2 text-2xl font-black">What remains before live money</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                Approval blockers must be cleared before database approval can be
                recorded. Launch locks are intentional final controls that keep live
                Checkout closed until the go-live window.
              </p>
            </div>
            <div className="rounded border bg-neutral-50 px-4 py-3 text-sm font-bold">
              {approvalBlockingCount} approval blocker(s), {launchLockCount} launch lock(s)
            </div>
          </div>
          {report.summary.nextActions.length ? (
            <ol className="mt-5 space-y-3">
              {report.summary.nextActions.map((item) => (
                <li key={item.key} className={`rounded border p-4 ${tone(item.status)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-black">{item.label}</p>
                    <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
                      {approvalBlockingCount > 0 && item.status === "blocked" && item.key !== "database_approval" && item.key !== "runtime_switch"
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
            <p className="mt-5 rounded border border-green-200 bg-green-50 p-4 text-sm font-bold text-green-900">
              No live-payment approval blockers or launch locks remain. Continue with final
              operator approval, runtime switch review, and post-launch monitoring.
            </p>
          )}
        </section>

        <section className="mb-8 rounded border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
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
              className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-bold"
            >
              Hand-off Bundle
            </Link>
          </div>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Post-smoke raw JSON command
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.statusCommand}
              </dd>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Final-window raw preflight command
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.preflightCommand}
              </dd>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Post-smoke archive helper
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.archiveCommand}
              </dd>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">
                Final-window preflight archive helper
              </dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.preflightArchiveCommand}
              </dd>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-3">
              <dt className="font-black uppercase text-emerald-700">Schema</dt>
              <dd className="mt-1 font-mono text-xs">
                {LIVE_MONEY_JSON_EVIDENCE.schema}
              </dd>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-3">
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
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {report.checks.map((item) => (
            <article key={item.key} className={`rounded border p-5 ${tone(item.status)}`}>
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

        <section className="mt-8 rounded border bg-white p-6">
          <h2 className="text-xl font-black">Immutable Approval History</h2>
          {eventsResult.error ? (
            <p className="mt-3 text-sm text-red-700">{eventsResult.error.message}</p>
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
                      <td className="py-3 pr-4 font-bold uppercase">{event.event_type}</td>
                      <td className="py-3 pr-4">{event.actor}</td>
                      <td className="py-3">{event.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">No approval or revocation has been recorded.</p>
          )}
        </section>
      </div>
    </main>
  );
}
