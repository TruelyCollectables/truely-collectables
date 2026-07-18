import { readFile } from "node:fs/promises";

const sources = {
  actions: await readFile(
    new URL("../src/app/admin/payment-simulations/SimulationActions.tsx", import.meta.url),
    "utf8",
  ),
  simulationRoute: await readFile(
    new URL("../src/app/api/admin/payment-simulations/route.ts", import.meta.url),
    "utf8",
  ),
  checkoutRoute: await readFile(
    new URL("../src/app/api/admin/payment-simulations/checkout-e2e/route.ts", import.meta.url),
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

scenario("payment simulation UI exposes accessible typed feedback", () => {
  for (const fragment of [
    "type FeedbackTone",
    "Running no-money payment suite...",
    "Running Stripe sandbox payment suite...",
    "Running full checkout E2E simulation...",
    "simulationActionRunningRef",
    "Finish the current payment simulation before starting another.",
    "Wait for the payment simulation to finish before cancelling.",
    "Enable Stripe test simulation before running Stripe-touching payment tests.",
    "function paymentSimulationActionTitle",
    "function confirmedPaymentSimulationTitle",
    "Run the no-money payment simulation suite.",
    "Open the confirmation panel for the full checkout E2E simulation.",
    "Open the confirmation panel for the Stripe sandbox suite.",
    "Type ${expected} exactly before running this payment simulation.",
    "Run the confirmed full checkout E2E simulation.",
    "Run the confirmed Stripe sandbox payment suite.",
    "Close this payment simulation confirmation panel.",
    "title={paymentSimulationActionTitle",
    "title={confirmedPaymentSimulationTitle",
    "beginConfirmedRun",
    "cancelConfirmedRun",
    "ActionNotice",
    'aria-live={message.tone === "info" ? "polite" : "assertive"}',
    'role={message.tone === "error" ? "alert" : "status"}',
    'aria-busy={busy === "deterministic"}',
    'aria-busy={busy === "checkout_e2e"}',
    'aria-busy={busy === "stripe_test"}',
    "aria-disabled={busy !== null}",
    "aria-disabled={busy !== null || !stripeTestEnabled}",
  ]) {
    assert(
      sources.actions.includes(fragment),
      `Expected payment simulation feedback fragment ${fragment}.`,
    );
  }
});

scenario("payment simulation UI sends confirmations to Stripe-touching APIs", () => {
  for (const fragment of [
    "body: JSON.stringify({ mode, confirmation })",
    "body: JSON.stringify({ confirmation })",
    "Type RUN STRIPE TEST exactly before running the Stripe sandbox suite.",
    "Type RUN CHECKOUT E2E exactly before running the full checkout test.",
  ]) {
    assert(
      sources.actions.includes(fragment),
      `Expected payment simulation confirmation fragment ${fragment}.`,
    );
  }
});

scenario("Stripe sandbox simulation API enforces confirmation server-side", () => {
  for (const fragment of [
    'mode === "stripe_test"',
    'String(body.confirmation || "").trim() !== "RUN STRIPE TEST"',
    "Type RUN STRIPE TEST to confirm the Stripe sandbox simulation suite.",
  ]) {
    assert(
      sources.simulationRoute.includes(fragment),
      `Expected Stripe simulation route confirmation fragment ${fragment}.`,
    );
  }
});

scenario("checkout E2E simulation API enforces confirmation server-side", () => {
  for (const fragment of [
    "const body = await request.json().catch(() => ({}));",
    'String(body.confirmation || "").trim() !== "RUN CHECKOUT E2E"',
    "Type RUN CHECKOUT E2E to confirm the full checkout E2E simulation.",
  ]) {
    assert(
      sources.checkoutRoute.includes(fragment),
      `Expected checkout E2E route confirmation fragment ${fragment}.`,
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
  `Admin payment simulation action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
