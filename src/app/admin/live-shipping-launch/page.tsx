import Link from "next/link";
import {
  evaluateLiveShippingLaunch,
  type LiveShippingCheckStatus,
} from "../../../lib/live-shipping-launch";
import { buildShippingProviderSetupPacket } from "../../../lib/shipping-provider-setup";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import LiveShippingGateActions from "./LiveShippingGateActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function tone(status: LiveShippingCheckStatus) {
  if (status === "passed") return "border-green-200 bg-green-50 text-green-900";
  if (status === "warning") return "border-yellow-200 bg-yellow-50 text-yellow-900";
  return "border-red-200 bg-red-50 text-red-900";
}

function label(status: LiveShippingCheckStatus) {
  if (status === "passed") return "Passed";
  if (status === "warning") return "Review";
  return "Blocked";
}

export default async function LiveShippingLaunchPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [report, eventsResult] = await Promise.all([
    evaluateLiveShippingLaunch({ supabase, storeId }),
    supabase
      .from("live_shipping_launch_events")
      .select("id,event_type,actor,note,approval_version,created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const blocked = report.checks.filter((item) => item.status === "blocked").length;
  const passed = report.checks.filter((item) => item.status === "passed").length;
  const warning = report.checks.filter((item) => item.status === "warning").length;
  const providerSetupPacket = buildShippingProviderSetupPacket();
  const missingCredentialGroups = providerSetupPacket.credentialGroups.filter(
    (group) => group.status === "missing",
  );
  const readyCredentialGroups = providerSetupPacket.credentialGroups.filter(
    (group) => group.status === "ready",
  );
  const readyRequirements = providerSetupPacket.liveRequirements.filter(
    (requirement) => requirement.status === "ready",
  ).length;
  const evidenceContract = providerSetupPacket.standardEnvelopeEvidenceContract;

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              Real-postage control plane
            </p>
            <h1 className="mt-2 text-4xl font-black">Live Shipping Launch Gate</h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              TCOS requires a current database approval, environment kill switch,
              live purchase mode, clean dry-run residue, provider setup, and a
              passing live-shipping simulation report before live postage can be
              treated as enabled.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/shipping" className="rounded border bg-white px-4 py-2">
              Shipping Ops
            </Link>
            <Link href="/admin/shipping/simulations" className="rounded border bg-white px-4 py-2">
              Shipping Lab
            </Link>
            <Link href="/admin/launch-readiness" className="rounded border bg-white px-4 py-2">
              Launch Readiness
            </Link>
            <Link href="/admin/launch-gate-drill" className="rounded border bg-white px-4 py-2">
              Gate Drill
            </Link>
          </div>
        </div>

        <section
          className={`mb-8 rounded border p-6 ${
            report.liveShippingEnabled
              ? "border-green-300 bg-green-50"
              : "border-red-300 bg-red-50"
          }`}
        >
          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Runtime</p>
              <p className="mt-1 text-2xl font-black">
                {report.liveShippingEnabled ? "ENABLED" : "LOCKED"}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Mode</p>
              <p className="mt-1 text-2xl font-black">
                {report.purchaseMode.toUpperCase()}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Passed</p>
              <p className="mt-1 text-2xl font-black">{passed}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Review</p>
              <p className="mt-1 text-2xl font-black">{warning}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Blocked</p>
              <p className="mt-1 text-2xl font-black">{blocked}</p>
            </div>
          </div>
          <p className="mt-5 text-sm">
            Approval version: <code>{report.approvalVersion}</code>. Report
            generated {report.generatedAt}.
          </p>
          <div className="mt-5">
            <LiveShippingGateActions
              approvalDatabaseReady={report.approvalDatabaseReady}
              approvalReady={report.approvalReady}
            />
          </div>
        </section>

        <section className="mb-8 rounded border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest">
                Next shipping unlock
              </p>
              <h2 className="mt-1 text-2xl font-black">
                Provider secrets and live-adapter evidence
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6">
                Live payments are open, so the remaining launch work is shipping.
                This panel lists secret names only. It never prints secret values
                and does not contact live providers.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/api/admin/shipping/provider-setup"
                className="rounded border border-amber-300 bg-white px-4 py-2 font-black text-amber-950"
              >
                Setup JSON
              </Link>
              <Link
                href="/api/admin/shipping/provider-setup?format=csv"
                className="rounded border border-amber-300 bg-white px-4 py-2 font-black text-amber-950"
              >
                Setup CSV
              </Link>
              <Link
                href="/api/admin/shipping/provider-setup?format=env-template"
                className="rounded border border-amber-300 bg-white px-4 py-2 font-black text-amber-950"
              >
                Env Template
              </Link>
              <Link
                href="/api/admin/shipping/provider-setup?format=vercel-commands"
                className="rounded border border-amber-300 bg-white px-4 py-2 font-black text-amber-950"
              >
                Vercel Commands
              </Link>
              <Link
                href="/api/admin/shipping/provider-setup?format=operator-checklist"
                className="rounded border border-amber-300 bg-white px-4 py-2 font-black text-amber-950"
              >
                Operator Checklist
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <article className="rounded border border-amber-300 bg-white p-4">
              <p className="text-xs font-black uppercase text-neutral-500">
                Provider verdict
              </p>
              <p className="mt-2 font-black">{providerSetupPacket.decision.status}</p>
              <p className="mt-2 text-sm leading-6">
                {providerSetupPacket.decision.summary}
              </p>
              <p className="mt-2 text-xs font-bold">
                {providerSetupPacket.decision.nextAction}
              </p>
            </article>

            <article className="rounded border border-amber-300 bg-white p-4">
              <p className="text-xs font-black uppercase text-neutral-500">
                Credential groups
              </p>
              <p className="mt-2 text-2xl font-black">
                {readyCredentialGroups.length}/{providerSetupPacket.credentialGroups.length} ready
              </p>
              <div className="mt-3 space-y-2">
                {providerSetupPacket.credentialGroups.map((group) => (
                  <div
                    key={group.title}
                    className={`rounded border p-2 text-xs font-bold ${
                      group.status === "ready"
                        ? "border-green-200 bg-green-50 text-green-900"
                        : "border-amber-200 bg-amber-50 text-amber-950"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>{group.title}</span>
                      <span className="uppercase">{group.status}</span>
                    </div>
                    <p className="mt-1 font-semibold opacity-80">
                      {group.status === "ready"
                        ? `Staged: ${group.configuredKeys.join(", ")}`
                        : group.requirement}
                    </p>
                  </div>
                ))}
              </div>
              {missingCredentialGroups.length > 0 ? (
                <p className="mt-3 text-xs font-black">
                  Missing: {missingCredentialGroups.map((group) => group.title).join(", ")}
                </p>
              ) : null}
            </article>

            <article className="rounded border border-amber-300 bg-white p-4">
              <p className="text-xs font-black uppercase text-neutral-500">
                Live requirements
              </p>
              <p className="mt-2 text-2xl font-black">
                {readyRequirements}/{providerSetupPacket.liveRequirements.length} ready
              </p>
              <ul className="mt-2 space-y-1 text-sm leading-6">
                {providerSetupPacket.liveRequirements
                  .filter((requirement) => requirement.status !== "ready")
                  .slice(0, 4)
                  .map((requirement) => (
                    <li key={requirement.key}>- {requirement.label}</li>
                  ))}
              </ul>
            </article>
          </div>

          <article className="mt-5 rounded border border-amber-300 bg-white p-5">
            <p className="text-xs font-black uppercase text-neutral-500">
              Standard Envelope Evidence + Under-$20 Protection Contract
            </p>
            <h3 className="mt-2 text-xl font-black">
              {evidenceContract.evidenceProvider} is delivery evidence, not insurance
            </h3>
            <p className="mt-2 text-sm leading-6">
              {evidenceContract.trackableRequirement}{" "}
              {evidenceContract.under20ProtectionModel}
            </p>
            <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
              <div className="rounded border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-black uppercase">Seller opt-in</p>
                <p className="mt-1">{evidenceContract.sellerOptInRule}</p>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-black uppercase">Reserve / cap</p>
                <p className="mt-1">
                  {evidenceContract.reserveRate} reserve;{" "}
                  {evidenceContract.itemReimbursementCap} item-only cap
                </p>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-black uppercase">Shipping</p>
                <p className="mt-1">
                  Reimburses shipping: {evidenceContract.reimbursesShipping}.
                  Basis: {evidenceContract.reimbursementBasis}.
                </p>
              </div>
            </div>
            <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">
              Not insurance: {evidenceContract.notInsuranceNotice}
            </p>
          </article>
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
          <h2 className="text-xl font-black">Immutable Shipping Approval History</h2>
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
              No live-shipping approval or revocation has been recorded.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
