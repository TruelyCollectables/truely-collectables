import Link from "next/link";
import { DEPLOY_SAFETY } from "../../../lib/deploy-safety";
import { SELLER_PROTECTION_SMOKE_COVERAGE_LINE } from "../../../lib/seller-protection-launch-contract";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const smokeChecks = [
  "Admin login and dashboard render",
  "Launch readiness page, JSON brief, Markdown brief, and handoff bundle",
  SELLER_PROTECTION_SMOKE_COVERAGE_LINE,
  "Launch Gate Drill page, JSON report, Markdown operator report, and Standard Envelope evidence validator",
  "Live Payment Launch Gate",
  "Live Shipping Launch Gate",
  "Admin shipping cockpit LetterTrack export, IMb, and delivery-evidence controls",
  "Shipping Simulation Lab with nineteen policy/adapter scenarios",
  "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
  "Shipping provider setup JSON and export packets with Standard Envelope evidence readiness",
  "Ranked shipping exceptions CSV, including seller-protection refund-proof and payout blocker support",
  "LetterTrack Standard Envelope CSV export",
  "Clean production domain",
  `Unwanted ${DEPLOY_SAFETY.unwantedAlias} alias absence`,
  `Deploy live safety contract with quota messaging, ${DEPLOY_SAFETY.unwantedAlias} alias cleanup, deployed/clean URL output, and smoke handoff`,
];

const failureMeanings = [
  {
    label: "Vercel quota capped",
    detail: `If deploy reports ${DEPLOY_SAFETY.quotaBlockCode}, ${DEPLOY_SAFETY.quotaResetInstruction}`,
  },
  {
    label: "Queued feature missing",
    detail:
      "If smoke says queued launch features are not visible, production is behind GitHub. Read the Queued launch feature failure(s) line for the exact checks, then deploy the pushed stack again when Vercel accepts it.",
  },
  {
    label: `${DEPLOY_SAFETY.unwantedAlias} responds`,
    detail: `If ${DEPLOY_SAFETY.unwantedAlias} returns successfully, remove the alias before treating production as clean.`,
  },
  {
    label: "Admin/auth failure",
    detail:
      "If admin login fails, confirm ADMIN_PASSWORD / SMOKE_ADMIN_PASSWORD shape and redeploy after secret changes.",
  },
];

export default function ProductionSmokePage() {
  return (
    <main className="min-h-screen bg-neutral-50 p-8 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-widest text-neutral-500">
              Production verification
            </p>
            <h1 className="mt-2 text-4xl font-black">Production Smoke Report</h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              Operator-facing map for the production smoke suite. This page does
              not run Vercel, charge cards, buy postage, or contact providers;
              it shows exactly what the launch smoke is expected to prove after
              a successful production deployment.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/launch-readiness" className="rounded border bg-white px-4 py-2">
              Launch Readiness
            </Link>
            <Link href="/admin/launch-gate-drill" className="rounded border bg-white px-4 py-2">
              Gate Drill
            </Link>
            <Link href="/api/admin/launch-readiness?format=handoff-bundle" className="rounded border bg-white px-4 py-2">
              Hand-off Bundle
            </Link>
          </div>
        </div>

        <section className="mb-8 rounded border border-blue-200 bg-blue-50 p-6 text-blue-950">
          <h2 className="text-2xl font-black">Launch command</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6">
            Use the one-shot launch command when Vercel accepts production
            deployments. It verifies the pushed GitHub stack, deploys
            production, then runs the smoke.
          </p>
          <pre className="mt-4 overflow-x-auto rounded bg-neutral-950 p-4 text-sm text-neutral-50">
            {`npm run launch:production`}
          </pre>
          <p className="mt-3 text-sm font-bold">
            Clean target: <code>{DEPLOY_SAFETY.cleanProductionDomain}</code>.
            The smoke refuses the unwanted{" "}
            <code>{DEPLOY_SAFETY.unwantedAlias}</code> alias as a target.
          </p>
        </section>

        <section className="mb-8 rounded border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <h2 className="text-xl font-black">Deploy live safety contract</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6">
            The production deploy helper must keep Vercel quota messaging,
            unwanted alias removal for{" "}
            <code>{DEPLOY_SAFETY.unwantedAlias}</code>, clean-domain aliasing,
            deployed URL output, clean URL output, and the{" "}
            <code>{DEPLOY_SAFETY.smokeCommand}</code> handoff intact. If Vercel returns{" "}
            <code>{DEPLOY_SAFETY.quotaBlockCode}</code>,{" "}
            {DEPLOY_SAFETY.quotaResetInstruction}
          </p>
          <h3 className="mt-5 font-black">Protected deploy sequence</h3>
          <ol className="mt-3 grid gap-2 text-sm font-semibold md:grid-cols-5">
            {DEPLOY_SAFETY.sequence.map((step, index) => (
              <li key={step} className="rounded border border-amber-200 bg-white p-3">
                <span className="mr-2 rounded bg-amber-100 px-2 py-1 text-xs font-black">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section className="mb-8 grid gap-4 lg:grid-cols-2">
          <article className="rounded border bg-white p-6">
            <h2 className="text-xl font-black">Smoke coverage</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6">
              {smokeChecks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </article>

          <article className="rounded border bg-white p-6">
            <h2 className="text-xl font-black">Failure meanings</h2>
            <div className="mt-4 space-y-3">
              {failureMeanings.map((item) => (
                <div key={item.label} className="rounded border border-neutral-200 bg-neutral-50 p-3">
                  <h3 className="font-black">{item.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-neutral-700">{item.detail}</p>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="rounded border bg-white p-6">
          <h2 className="text-xl font-black">Manual follow-up after smoke passes</h2>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <SmokeLink href="/admin/launch-readiness" label="Launch Readiness" />
            <SmokeLink href="/api/admin/launch-readiness?format=handoff-bundle" label="Seller Protection Handoff Bundle" />
            <SmokeLink href="/admin/live-payment-launch" label="Live Payment Launch" />
            <SmokeLink href="/admin/live-shipping-launch" label="Live Shipping Launch" />
            <SmokeLink href="/admin/financial-reconciliation" label="Seller Protection Reconciliation" />
            <SmokeLink href="/admin/shipping/simulations" label="Shipping Simulation Lab" />
            <SmokeLink href="/admin/shipping" label="Shipping Claims Cockpit" />
            <SmokeLink href="/admin/shipping#dry-run-cleanup" label="Dry-run Cleanup" />
            <SmokeLink href="/api/admin/shipping/lettertrack-export" label="LetterTrack CSV Export" />
            <SmokeLink href="/api/admin/shipping/exceptions" label="Shipping Exceptions CSV" />
            <SmokeLink href="/api/admin/launch-gate-drill?format=markdown" label="Gate Drill Report" />
            <SmokeLink href="/api/admin/shipping/provider-setup" label="Shipping Provider JSON" />
            <SmokeLink href="/api/admin/shipping/provider-setup?format=csv" label="Shipping Setup CSV" />
            <SmokeLink href="/api/admin/shipping/provider-setup?format=env-template" label="Shipping Env Template" />
            <SmokeLink href="/api/admin/shipping/provider-setup?format=vercel-commands" label="Shipping Vercel Commands" />
            <SmokeLink href="/api/admin/shipping/provider-setup?format=operator-checklist" label="Shipping Checklist" />
          </div>
        </section>
      </div>
    </main>
  );
}

function SmokeLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="rounded border border-neutral-200 bg-neutral-50 px-4 py-3 font-bold">
      {label}
    </Link>
  );
}
