import { runShippingPurchaseAttemptAuditSimulationSuite } from "../src/lib/shipping-purchase-attempt-audit-simulations";

const result = runShippingPurchaseAttemptAuditSimulationSuite();

for (const scenario of result.scenarios) {
  const marker = scenario.scenario_status === "passed" ? "PASS" : "FAIL";
  console.log(`${marker} ${scenario.scenario_key} - ${scenario.detail}`);
}

console.log(
  `Shipping purchase audit simulations: ${result.passed_count}/${result.scenario_count} passed; expected ${result.expected_scenario_count} scenarios.`,
);

if (result.run_status !== "passed") {
  process.exitCode = 1;
}
