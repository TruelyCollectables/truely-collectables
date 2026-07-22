import { readFile } from "node:fs/promises";

const sources = {
  payment: await readFile(
    new URL(
      "../src/app/admin/live-payment-launch/LivePaymentGateActions.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  paymentPage: await readFile(
    new URL("../src/app/admin/live-payment-launch/page.tsx", import.meta.url),
    "utf8",
  ),
  shipping: await readFile(
    new URL(
      "../src/app/admin/live-shipping-launch/LiveShippingGateActions.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  shippingPage: await readFile(
    new URL("../src/app/admin/live-shipping-launch/page.tsx", import.meta.url),
    "utf8",
  ),
};

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertGateFeedback(source, noun) {
  const capitalized = noun[0].toUpperCase() + noun.slice(1);

  for (const fragment of [
    `Apply the live-${noun} launch gate migration before recording approval.`,
    `Clear the live-${noun} approval blockers before recording approval.`,
    `Finish the current live-${noun} gate action first.`,
    "const gateActionRunningRef = useRef(false)",
    "gateActionRunningRef.current",
    "gateActionRunningRef.current = true",
    "gateActionRunningRef.current = false",
    "function beginAction(action: \"approve\" | \"revoke\")",
    "function cancelAction()",
    `Open the confirmation panel for live ${noun} approval.`,
    `Open the confirmation panel for emergency live ${noun} revocation.`,
    `Live ${noun} gate submission is already running.`,
    `Record the emergency live ${noun} revocation in the immutable audit log.`,
    `Record the live ${noun} approval in the immutable audit log.`,
    `Wait for the live ${noun} gate submission to finish before cancelling.`,
    "aria-busy={busy === \"approve\"}",
    "aria-busy={busy === \"revoke\"}",
    "aria-busy={busy}",
    "aria-disabled={!approvalReady || !approvalDatabaseReady || busy !== null}",
    "aria-disabled={busy !== null}",
    "aria-disabled={busy}",
    'role="alert"',
    'aria-live="assertive"',
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    "onSubmit={() => void submit(pendingAction)}",
    `APPROVE LIVE ${capitalized.toUpperCase()}`,
    `REVOKE LIVE ${capitalized.toUpperCase()}`,
    "gateActionPanelClass",
    "gateApproveButtonClass",
    "gateRevokeButtonClass",
    "gateNeutralButtonClass",
    "gateInputClass",
    "rounded-3xl border border-current/20 bg-white/80",
    "rounded-full bg-emerald-700",
    "rounded-full bg-red-700",
    "transition hover:-translate-y-0.5",
    "focus:ring-2 focus:ring-sky-200",
    "rounded-2xl border px-3 py-2 text-sm font-bold shadow-sm",
  ]) {
    assert(
      source.includes(fragment),
      `Expected live ${noun} gate feedback fragment ${fragment}.`,
    );
  }
}

scenario("live payment gate actions announce and explain approval controls", () => {
  assertGateFeedback(sources.payment, "payment");
});

scenario("live shipping gate actions announce and explain approval controls", () => {
  assertGateFeedback(sources.shipping, "shipping");
});

scenario("live launch pages keep approval history failures operator-safe", () => {
  for (const [label, source, unavailableCopy, defaultError] of [
    [
      "payment",
      sources.paymentPage,
      "Approval history unavailable.",
      "Unknown live-payment launch history error.",
    ],
    [
      "shipping",
      sources.shippingPage,
      "Shipping approval history unavailable.",
      "Unknown live-shipping launch history error.",
    ],
  ]) {
    for (const fragment of [
      "function safeErrorMessage",
      "replace(/\\s+/g, \" \").trim().slice(0, 220)",
      unavailableCopy,
      "This panel is paused instead of showing an empty approval trail.",
      "Diagnostic: {diagnostic}",
      "role=\"alert\"",
      "aria-live=\"assertive\"",
      defaultError,
    ]) {
      assert(
        source.includes(fragment),
        `Expected live ${label} launch page history failure fragment ${fragment}.`,
      );
    }

    assert(
      !source.includes("{eventsResult.error.message}"),
      `Expected live ${label} launch page to avoid rendering raw history provider errors.`,
    );
  }
});

scenario("live launch pages expose first-screen gate posture", () => {
  for (const fragment of [
    "type GatePostureTone",
    "gatePrimaryLinkClass",
    "gateSecondaryLinkClass",
    "GatePostureCard",
    "rounded-full bg-neutral-950",
    "transition hover:-translate-y-0.5",
    "ring-1 ring-black/[0.02]",
  ]) {
    assert(
      sources.paymentPage.includes(fragment),
      `Expected live payment page posture/polish fragment ${fragment}.`,
    );
    assert(
      sources.shippingPage.includes(fragment),
      `Expected live shipping page posture/polish fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "const paymentGatePosture =",
    "RUNTIME ENABLED",
    "APPROVAL BLOCKERS",
    "LAUNCH LOCKED",
    "READY FOR FINAL WINDOW",
    "Payment gate posture",
    "Database approval",
    "Operator next step",
    "NOT APPROVABLE",
    "Monitor live checkout",
    "Hold final runtime switch",
  ]) {
    assert(
      sources.paymentPage.includes(fragment),
      `Expected live payment page gate posture fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "const shippingGatePosture =",
    "BLOCKERS PRESENT",
    "REVIEW WARNINGS",
    "Shipping gate posture",
    "Provider readiness",
    "SECRETS NEEDED",
    "PROVIDER READY",
    "Load provider secrets",
    "Monitor live postage",
    "gateAmberLinkClass",
    "rounded-3xl border border-indigo-200 bg-indigo-50",
  ]) {
    assert(
      sources.shippingPage.includes(fragment),
      `Expected live shipping page gate posture fragment ${fragment}.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin live launch gate simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
