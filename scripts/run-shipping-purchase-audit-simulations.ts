import { runShippingPurchaseAttemptAuditSimulationSuite } from "../src/lib/shipping-purchase-attempt-audit-simulations";

const result = runShippingPurchaseAttemptAuditSimulationSuite();

for (const scenario of result.scenarios) {
  const marker = scenario.scenario_status === "passed" ? "PASS" : "FAIL";
  console.log(`${marker} ${scenario.scenario_key} - ${scenario.detail}`);
}

console.log(
  `Shipping purchase audit simulations: ${result.passed_count}/${result.scenario_count} passed; expected ${result.expected_scenario_count} scenarios.`,
);
const scenarioCoverageMarker =
  result.scenario_coverage_status === "passed" ? "PASS" : "FAIL";
console.log(
  `${scenarioCoverageMarker} shipping_purchase_audit_expected_scenario_count - expected ${result.expected_scenario_count}, found ${result.scenario_count}`,
);
const scenarioKeyCoverageMarker =
  result.scenario_key_coverage_status === "passed" ? "PASS" : "FAIL";
console.log(
  `${scenarioKeyCoverageMarker} shipping_purchase_audit_expected_scenario_keys - missing ${result.missing_scenario_keys.join(", ") || "none"}; unexpected ${result.unexpected_scenario_keys.join(", ") || "none"}`,
);

if (result.run_status !== "passed") {
  process.exitCode = 1;
}
