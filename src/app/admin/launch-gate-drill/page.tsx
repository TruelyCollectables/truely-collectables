import Link from "next/link";
import {
  runLaunchGateDrill,
  type LaunchGatePosture,
  type LaunchGatePostureStatus,
  type LaunchGateDrillStatus,
} from "../../../lib/launch-gate-drill";
import type { ProviderSetupActionPlanStep } from "../../../lib/shipping-provider-setup";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function tone(status: LaunchGateDrillStatus) {
  if (status === "passed") return "border-green-200 bg-green-50 text-green-900";
  if (status === "warning") return "border-yellow-200 bg-yellow-50 text-yellow-900";
  return "border-red-200 bg-red-50 text-red-900";
}

function label(status: LaunchGateDrillStatus) {
  if (status === "passed") return "Passed";
  if (status === "warning") return "Review";
  return "Failed";
}

function postureTone(status: LaunchGatePostureStatus) {
  if (status === "ready") return "border-green-300 bg-green-50 text-green-950";
  if (status === "locked") return "border-blue-300 bg-blue-50 text-blue-950";
  if (status === "review") return "border-yellow-300 bg-yellow-50 text-yellow-950";
  return "border-red-300 bg-red-50 text-red-950";
}

function postureLabel(status: LaunchGatePostureStatus) {
  if (status === "ready") return "Ready";
  if (status === "locked") return "Locked Safe";
  if (status === "review") return "Review";
  return "Blocked";
}

function listValue(items: string[]) {
  return items.length > 0 ? items.join(", ") : "none";
}

export default async function LaunchGateDrillPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const report = await runLaunchGateDrill({ supabase, storeId });

  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              No-money runtime smoke
            </p>
            <h1 className="mt-2 text-4xl font-black">Launch Gate Drill</h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              This admin drill exercises the payment and shipping runtime gates
              without creating Checkout Sessions, Stripe money objects, provider
              labels, or postage purchases.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/launch-readiness" className="rounded border bg-white px-4 py-2">
              Launch Readiness
            </Link>
            <Link
              href="/api/admin/launch-gate-drill?format=markdown"
              className="rounded border bg-white px-4 py-2"
            >
              Download Drill Report
            </Link>
            <Link href="/admin/live-payment-launch" className="rounded border bg-white px-4 py-2">
              Payment Gate
            </Link>
            <Link href="/admin/live-shipping-launch" className="rounded border bg-white px-4 py-2">
              Shipping Gate
            </Link>
          </div>
        </div>

        <section
          className={`mb-8 rounded border p-6 ${
            report.summary.failed === 0
              ? "border-green-300 bg-green-50"
              : "border-red-300 bg-red-50"
          }`}
        >
          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Result</p>
              <p className="mt-1 text-2xl font-black">
                {report.summary.failed === 0 ? "PASSED" : "FAILED"}
              </p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Passed</p>
              <p className="mt-1 text-2xl font-black">{report.summary.passed}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Review</p>
              <p className="mt-1 text-2xl font-black">{report.summary.warning}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Failed</p>
              <p className="mt-1 text-2xl font-black">{report.summary.failed}</p>
            </div>
            <div>
              <p className="text-xs font-black uppercase text-neutral-500">Store</p>
              <p className="mt-1 text-sm font-black break-all">{report.storeId}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="font-black">Payment Runtime</dt>
              <dd>
                {report.payment.paymentMode.toUpperCase()} mode, live payments{" "}
                {report.payment.livePaymentsEnabled ? "enabled" : "locked"}.
              </dd>
            </div>
            <div>
              <dt className="font-black">Shipping Runtime</dt>
              <dd>
                {report.shipping.purchaseMode.toUpperCase()} mode, live shipping{" "}
                {report.shipping.liveShippingEnabled ? "enabled" : "locked"}.
                Standard Envelope evidence validator is{" "}
                {report.shipping.standardEnvelopeEvidenceContractReady
                  ? "ready"
                  : "blocked"}.
              </dd>
            </div>
            <div>
              <dt className="font-black">Provider Purchase-Attempt Audit Suite</dt>
              <dd>
                {report.shipping.purchaseAttemptAuditRunStatus.toUpperCase()} —{" "}
                {report.shipping.purchaseAttemptAuditScenarioCount}/
                {report.shipping.purchaseAttemptAuditExpectedScenarioCount}{" "}
                scenarios, key coverage{" "}
                {report.shipping.purchaseAttemptAuditKeyCoverageStatus}.
                Missing purchase audit keys:{" "}
                {listValue(report.shipping.purchaseAttemptAuditMissingScenarioKeys)}.
                Unexpected purchase audit keys:{" "}
                {listValue(report.shipping.purchaseAttemptAuditUnexpectedScenarioKeys)}.
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm">Report generated {report.generatedAt}.</p>
        </section>

        <section className="mb-8 grid gap-4 md:grid-cols-2">
          <PostureCard title="Payment Launch Posture" posture={report.posture.payment} />
          <PostureCard title="Shipping Launch Posture" posture={report.posture.shipping} />
        </section>

        <ShippingProviderUnlockPlan
          actionPlan={report.shipping.providerSetupActionPlan}
        />

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

        <section className="mt-8 rounded border border-blue-200 bg-blue-50 p-6 text-blue-950">
          <h2 className="text-xl font-black">Side-effect Guardrails</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6">
            {report.sideEffectPolicy.assurance}
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded border border-blue-200 bg-white p-4">
              <h3 className="font-black">Allowed during this drill</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
                {report.sideEffectPolicy.allowedOperations.map((operation) => (
                  <li key={operation}>{operation}</li>
                ))}
              </ul>
            </div>
            <div className="rounded border border-blue-200 bg-white p-4">
              <h3 className="font-black">Not allowed during this drill</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
                {report.sideEffectPolicy.forbiddenOperations.map((operation) => (
                  <li key={operation}>{operation}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded border bg-white p-6">
          <h2 className="text-xl font-black">What This Proves</h2>
          <div className="mt-4 grid gap-4 text-sm leading-6 md:grid-cols-3">
            <p>
              Test-mode payment paths remain available for simulations without
              live-money side effects.
            </p>
            <p>
              Invalid payment credentials fail closed before a Checkout path can
              continue.
            </p>
            <p>
              Current live payment and shipping runtime locks match the admin
              launch reports.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function ShippingProviderUnlockPlan({
  actionPlan,
}: {
  actionPlan: ProviderSetupActionPlanStep[];
}) {
  return (
    <section className="mb-8 rounded border border-indigo-200 bg-indigo-50 p-6 text-indigo-950">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest">
            Runtime-smoke shipping handoff
          </p>
          <h2 className="mt-1 text-xl font-black">
            Shipping Provider Unlock Action Plan
          </h2>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6">
            The drill is no-money and no-postage, but it still repeats the
            no-secret provider setup sequence so operators know why shipping is
            locked safe after the runtime checks pass.
          </p>
        </div>
        <Link
          href="/api/admin/shipping/provider-setup?format=operator-checklist"
          className="rounded border border-indigo-300 bg-white px-4 py-2 text-sm font-black"
        >
          Operator Checklist
        </Link>
      </div>

      <ol className="mt-4 grid gap-3 lg:grid-cols-5">
        {actionPlan.map((step) => (
          <li
            key={step.order}
            className={`rounded border p-3 ${
              step.status === "ready"
                ? "border-green-200 bg-green-50 text-green-950"
                : step.status === "guarded"
                  ? "border-red-200 bg-white text-red-950"
                  : "border-amber-200 bg-white text-amber-950"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-black">
                {step.order}. {step.title}
              </h3>
              <span className="rounded border border-current px-2 py-1 text-[10px] font-black uppercase">
                {step.status}
              </span>
            </div>
            <p className="mt-2 text-xs font-semibold">{step.detail}</p>
            <p className="mt-2 text-xs font-black">{step.action}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-wrap gap-3 text-sm font-black">
        <Link
          href="/api/admin/shipping/provider-setup?format=env-template"
          className="rounded border border-indigo-300 bg-white px-3 py-2"
        >
          Env Template
        </Link>
        <Link
          href="/api/admin/shipping/provider-setup?format=vercel-commands"
          className="rounded border border-indigo-300 bg-white px-3 py-2"
        >
          Vercel Commands
        </Link>
        <Link
          href="/admin/live-shipping-launch"
          className="rounded border border-indigo-300 bg-white px-3 py-2"
        >
          Live Shipping Gate
        </Link>
      </div>
    </section>
  );
}

function PostureCard({
  title,
  posture,
}: {
  title: string;
  posture: LaunchGatePosture;
}) {
  const visibleBlockedChecks = posture.blockedChecks.slice(0, 5);
  const hiddenBlockedCount = Math.max(
    posture.blockedChecks.length - visibleBlockedChecks.length,
    0,
  );

  return (
    <article className={`rounded border p-5 ${postureTone(posture.status)}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest opacity-70">
            {title}
          </p>
          <h2 className="mt-1 text-xl font-black">{posture.label}</h2>
        </div>
        <span className="rounded border border-current px-2 py-1 text-xs font-black uppercase">
          {postureLabel(posture.status)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6">{posture.detail}</p>

      {visibleBlockedChecks.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase opacity-70">
            Blocking launch checks
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {visibleBlockedChecks.map((check) => (
              <span
                key={check}
                className="rounded border border-current px-2 py-1 text-xs font-bold"
              >
                {check}
              </span>
            ))}
            {hiddenBlockedCount > 0 ? (
              <span className="rounded border border-current px-2 py-1 text-xs font-bold">
                +{hiddenBlockedCount} more
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="text-xs font-black uppercase opacity-70">Next actions</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6">
          {posture.nextActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}
