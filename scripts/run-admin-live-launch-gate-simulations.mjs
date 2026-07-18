import { readFile } from "node:fs/promises";

const sources = {
  payment: await readFile(
    new URL(
      "../src/app/admin/live-payment-launch/LivePaymentGateActions.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  shipping: await readFile(
    new URL(
      "../src/app/admin/live-shipping-launch/LiveShippingGateActions.tsx",
      import.meta.url,
    ),
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
    `Open the confirmation panel for live ${noun} approval.`,
    `Open the confirmation panel for emergency live ${noun} revocation.`,
    `Live ${noun} gate submission is already running.`,
    `Record the emergency live ${noun} revocation in the immutable audit log.`,
    `Record the live ${noun} approval in the immutable audit log.`,
    `Wait for the live ${noun} gate submission to finish before cancelling.`,
    "aria-busy={busy === \"approve\"}",
    "aria-busy={busy === \"revoke\"}",
    "aria-busy={busy}",
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
