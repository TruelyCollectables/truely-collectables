import Link from "next/link";
import {
  evaluateLivePaymentLaunch,
  type LivePaymentCheckStatus,
} from "../../../lib/live-payment-launch";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
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
  const blocked = report.checks.filter((item) => item.status === "blocked").length;
  const passed = report.checks.filter((item) => item.status === "passed").length;

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
          <div className="grid gap-4 md:grid-cols-4">
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
              <p className="mt-1 text-2xl font-black">{passed}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Blocked</p>
              <p className="mt-1 text-2xl font-black">{blocked}</p>
            </div>
          </div>
          <p className="mt-5 text-sm">
            Approval version: <code>{report.approvalVersion}</code>. Report generated {report.generatedAt}.
          </p>
          <div className="mt-5">
            <LivePaymentGateActions approvalReady={report.approvalReady} />
          </div>
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
