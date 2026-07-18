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
