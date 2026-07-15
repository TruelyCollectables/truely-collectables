import Link from "next/link";
import { DEPLOY_SAFETY } from "../../../lib/deploy-safety";
import { buildSellerMarketplaceReceiptHandoffContract } from "../../../lib/seller-marketplace-receipt-handoff";
import { SELLER_PROTECTION_SMOKE_COVERAGE_LINE } from "../../../lib/seller-protection-launch-contract";
import { LIVE_MONEY_JSON_EVIDENCE } from "../../../lib/live-money-evidence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const sellerMarketplaceReceiptHandoff =
  buildSellerMarketplaceReceiptHandoffContract();
const sellerMarketplaceReceiptHandoffControlsText =
  sellerMarketplaceReceiptHandoff.controlsSentence;

const smokeChecks = [
  "Admin login and dashboard render with Shipping Provider Unlock Action Plan",
  "Launch readiness page, JSON brief, Markdown brief, and handoff bundle",
  "Launch readiness and handoff exports show missing/unexpected purchase-audit key drift",
  SELLER_PROTECTION_SMOKE_COVERAGE_LINE,
  "Launch Gate Drill page, JSON report, Markdown operator report, live-money runway, Shipping Provider Unlock Action Plan, and Standard Envelope evidence validator",
  "Live Payment Launch Gate",
  "Live Shipping Launch Gate with Shipping Provider Unlock Action Plan and Purchase-Audit Key Drift card",
  "Admin shipping cockpit LetterTrack export, IMb, and delivery-evidence controls",
  "Shipping Simulation Lab with twenty policy/adapter scenarios plus five provider purchase-audit scenarios",
  "Shipping purchase-attempt audit simulations for live-gate, missing-setup, dry-run, and packet-output text",
  "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
  "Shipping provider setup JSON and export packets with Standard Envelope evidence readiness",
  "Ranked shipping exceptions CSV, including seller-protection refund-proof and payout blocker support",
  "LetterTrack Standard Envelope CSV export",
  "Seller marketplace packet intake guardrail for cross-list prep only, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation",
  "Seller marketplace page renders Marketplace Packet Intake guidance, ready-row handoff, needs-work handoff, and prep-only export wording",
  `Seller marketplace receipt handoff controls for ${sellerMarketplaceReceiptHandoffControlsText}`,
  "Seller inventory, order, and payout workspaces render login gates before exposing seller-owned data",
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

const manualVerificationChecks = [
  {
    label: "Git tip and clean domain",
    href: "/api/admin/launch-readiness",
    proof:
      "Launch readiness JSON reports the current origin/main Git SHA, main ref, and clean production domain.",
    ifBlocked:
      "Treat this as deploy lag; rerun deploy/smoke after Vercel accepts the pushed stack.",
  },
  {
    label: "Launch gate drill evidence",
    href: "/api/admin/launch-gate-drill?format=markdown",
    proof:
      "Markdown report shows no-money/no-postage side-effect guardrails, passed payment/shipping gates, live-money runway counts, and no missing/unexpected purchase-audit keys.",
    ifBlocked:
      "Keep live changes paused and rerun the drill after fixing the failed payment, shipping, or provider-audit row.",
  },
  {
    label: "Live money runway proof",
    href: "/admin/launch-gate-drill",
    proof:
      "Launch Gate Drill shows the Live money runway panel with approval-blocker count, launch-lock count, warning count, live Checkout state, and next live-money actions before any runtime switch is changed.",
    ifBlocked:
      "Do not approve live payments or set TCOS_LIVE_PAYMENTS_ENABLED=true until the live-money runway matches the dedicated Live Payment Launch Gate and every approval blocker is intentionally cleared.",
  },
  {
    label: "Live money JSON evidence",
    href: "/admin/live-payment-launch",
    proof:
      `Archive \`${LIVE_MONEY_JSON_EVIDENCE.statusCommand}\` output with schema ${LIVE_MONEY_JSON_EVIDENCE.schema} after smoke passes; during the final go-live window, archive \`${LIVE_MONEY_JSON_EVIDENCE.preflightCommand}\` showing ${LIVE_MONEY_JSON_EVIDENCE.readyStates.join(" or ")} before any runtime switch change.`,
    ifBlocked:
      `Do not approve live payments or set TCOS_LIVE_PAYMENTS_ENABLED=true when the JSON evidence is missing, ${LIVE_MONEY_JSON_EVIDENCE.blockedStates.join(", ")}.`,
  },
  {
    label: "Live shipping lock posture",
    href: "/admin/live-shipping-launch",
    proof:
      "Live shipping remains locked while provider credentials, live adapter evidence, Coverage tests, webhooks, reconciliation, simulations, and admin approval are incomplete.",
    ifBlocked:
      "Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run and TCOS_LIVE_SHIPPING_ENABLED=false until every blocker is cleared intentionally.",
  },
  {
    label: "Seller protection money trail",
    href: "/admin/financial-reconciliation",
    proof:
      "Seller-protection reimbursement adjustments show the 2% reserve, $20 cap, shipping-excluded amount, and ledger path.",
    ifBlocked:
      "Do not mark protected claims paid until buyer refund proof and reimbursement allocation evidence are present.",
  },
  {
    label: "Shipping operations exports",
    href: "/admin/shipping",
    proof:
      "Shipping cockpit links LetterTrack CSV, exception CSV, claim packets, IMb recording, and delivery-evidence review actions.",
    ifBlocked:
      "Keep affected orders in shipping review and export the exception CSV before touching payouts.",
  },
  {
    label: "Seller marketplace packet intake",
    href: "/seller/marketplaces",
    proof:
      "Seller Connections shows the Marketplace Packet Intake card and states packets are cross-list prep only, with no publishing, postage purchase, Coverage policy creation, payout release, fulfillment, insurance, or automatic under-$20 protection activation.",
    ifBlocked:
      "Keep marketplace packets as internal prep files only and send sellers back through ready or needs-work Seller Inventory rows before any external marketplace action.",
  },
  {
    label: "Seller marketplace receipt handoff",
    href: sellerMarketplaceReceiptHandoff.route,
    proof:
      `Seller Connections shows ${sellerMarketplaceReceiptHandoffControlsText} in the ${sellerMarketplaceReceiptHandoff.proofText} before operators rely on marketplace API receipt handoffs.`,
    ifBlocked:
      "Do not rely on chat history or raw provider errors for marketplace debugging; capture a safe receipt or trail only after the deployed Seller Connections page shows the handoff controls.",
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
            {DEPLOY_SAFETY.quotaResetInstruction}{" "}
            Use the exact read-only local retry status command{" "}
            <code>{DEPLOY_SAFETY.quotaStatusCommand}</code>.{" "}
            {DEPLOY_SAFETY.quotaStatusDescription}{" "}
            {DEPLOY_SAFETY.quotaUploadWarning} Marker:{" "}
            <code>{DEPLOY_SAFETY.quotaCooldownMarkerPath}</code>. Override only
            intentionally with <code>{DEPLOY_SAFETY.quotaRetryOverrideEnv}</code>{" "}
            or <code>{DEPLOY_SAFETY.quotaRetryOverrideFlag}</code>.{" "}
            {DEPLOY_SAFETY.quotaMarkerClearCondition}
            {" "}
            {DEPLOY_SAFETY.deployResultRequirement}
            {" "}
            {DEPLOY_SAFETY.vercelCliRequirement}
            {" "}
            {DEPLOY_SAFETY.scopeRequirement}
            {" "}
            {DEPLOY_SAFETY.unwantedAliasCleanupRequirement}
            {" "}
            {DEPLOY_SAFETY.targetHostRequirement}
            {" "}
            {DEPLOY_SAFETY.smokeTargetRequirement}
            {" "}
            {DEPLOY_SAFETY.quotaEarlyStopRequirement}
          </p>
          <h3 className="mt-5 font-black">Protected deploy sequence</h3>
          <ol className="mt-3 grid gap-2 text-sm font-semibold md:grid-cols-3 xl:grid-cols-6">
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

        <section className="mb-8 rounded border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
          <h2 className="text-xl font-black">Production go/no-go ladder</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6">
            Use this ladder when deciding whether to keep going, split the run,
            or halt for Vercel quota. It is deliberately conservative: verify
            first, launch only when quota is open, and ship only after smoke
            proves the clean production domain.
          </p>
          <ol className="mt-4 grid gap-3 lg:grid-cols-5">
            {DEPLOY_SAFETY.decisionLadder.map((step) => (
              <li key={step.label} className="rounded border border-emerald-200 bg-white p-4">
                <h3 className="font-black">{step.label}</h3>
                <code className="mt-2 block break-words rounded bg-emerald-100 px-2 py-1 text-xs font-bold">
                  {step.command}
                </code>
                <p className="mt-2 text-sm leading-6 text-emerald-900">{step.outcome}.</p>
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

        <section className="mb-8 rounded border border-emerald-200 bg-emerald-50 p-6 text-emerald-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">
                {sellerMarketplaceReceiptHandoff.title}
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6">
                Production smoke uses the shared seller marketplace receipt
                handoff contract. The proof target is{" "}
                <code>{sellerMarketplaceReceiptHandoff.route}</code>, and the
                page must show {sellerMarketplaceReceiptHandoff.proofText} plus
                every required receipt control before operators use downloaded
                marketplace API receipt handoffs.
              </p>
            </div>
            <Link
              href={sellerMarketplaceReceiptHandoff.route}
              className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-bold"
            >
              Open Seller Marketplaces
            </Link>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div className="rounded border border-emerald-200 bg-white p-4">
              <h3 className="font-black">Required controls</h3>
              <p className="mt-2 text-sm font-semibold">
                {sellerMarketplaceReceiptHandoffControlsText}
              </p>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-4">
              <h3 className="font-black">Covered operations</h3>
              <p className="mt-2 text-sm font-semibold">
                {sellerMarketplaceReceiptHandoff.operations.join(", ")}
              </p>
            </div>
            <div className="rounded border border-emerald-200 bg-white p-4">
              <h3 className="font-black">Safe-use boundary</h3>
              <p className="mt-2 text-sm font-semibold">
                {sellerMarketplaceReceiptHandoff.safeUseBoundary}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded border bg-white p-6">
          <h2 className="text-xl font-black">Manual follow-up after smoke passes</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-neutral-700">
            Post-smoke manual verification checklist: follow these in order,
            capture the listed proof, and halt the launch lane at the first
            blocker instead of assuming a green smoke means every operator
            artifact is ready.
          </p>
          <div className="mt-4 grid gap-3">
            {manualVerificationChecks.map((check, index) => (
              <article
                key={check.label}
                className="rounded border border-neutral-200 bg-neutral-50 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-black">
                    {index + 1}. {check.label}
                  </h3>
                  <Link
                    href={check.href}
                    className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-bold"
                  >
                    Open proof target
                  </Link>
                </div>
                <p className="mt-3 text-sm leading-6 text-neutral-800">
                  <span className="font-black">Proof to capture:</span>{" "}
                  {check.proof}
                </p>
                <p className="mt-2 text-sm leading-6 text-neutral-800">
                  <span className="font-black">If blocked:</span>{" "}
                  {check.ifBlocked}
                </p>
              </article>
            ))}
          </div>
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
