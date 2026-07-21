import { readFile } from "node:fs/promises";

const sources = {
  page: await readFile(
    new URL("../src/app/admin/payment-simulations/page.tsx", import.meta.url),
    "utf8",
  ),
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
    "actionPrimaryClass",
    "actionSkyClass",
    "actionVioletClass",
    "actionNeutralClass",
    "rounded-full bg-neutral-950",
    "transition hover:-translate-y-0.5",
    "rounded-3xl border border-sky-200",
    "focus:ring-2 focus:ring-sky-200",
    "rounded-2xl border px-3 py-2 text-sm font-bold shadow-sm",
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

scenario("payment simulation page keeps history failures operator-safe", () => {
  for (const fragment of [
    "function safeErrorMessage",
    "Unknown payment simulation history error.",
    "replace(/\\s+/g, \" \").trim().slice(0, 220)",
    "const runsUnavailable = Boolean(runsResult.error)",
    "const scenariosUnavailable = Boolean(scenariosResult.error)",
    'value={runsUnavailable ? "Unavailable"',
    "Payment simulation history unavailable.",
    "counters are",
    "labeled unavailable instead of shown as zero",
    "Payment simulation scenario details unavailable.",
    "loaded the run headers but could not load the scenario",
    "Last run diagnostic: {safeErrorMessage(run.last_error)}",
    "function UnavailableNotice",
    "role=\"alert\"",
    "aria-live=\"assertive\"",
    "Diagnostic: {diagnostic}",
    "const paymentLabPosture =",
    "paymentNextAction",
    "HISTORY WARNING",
    "FAILURES NEED REVIEW",
    "LATEST RUN CLEAN",
    "NO RUNS YET",
    "Lab posture",
    "Stripe boundary",
    "Operator next step",
    "PaymentLabPostureCard",
    "SANDBOX ENABLED",
    "SANDBOX LOCKED",
    "Run First Lab",
    "Keep Evidence Fresh",
    "rounded-3xl border border-violet-200 bg-violet-50",
    "rounded-full border px-3 py-2 text-sm font-black",
    "rounded-3xl border border-rose-200 bg-rose-50",
  ]) {
    assert(
      sources.page.includes(fragment),
      `Expected payment simulation page failure-safe fragment ${fragment}.`,
    );
  }

  for (const forbidden of [
    "if (runsResult.error) throw runsResult.error",
    "if (scenariosResult.error) throw scenariosResult.error",
    "{run.last_error}",
  ]) {
    assert(
      !sources.page.includes(forbidden),
      `Expected payment simulation page not to expose raw failure fragment ${forbidden}.`,
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
