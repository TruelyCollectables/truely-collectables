import { runShippingSimulationSuite } from "../src/lib/shipping-simulations";

async function main() {
  const result = await runShippingSimulationSuite();

  console.log(
    `Shipping simulation suite ${result.suite_version}: ${result.passed_count}/${result.scenario_count} passed; expected ${result.expected_scenario_count} scenarios.`,
  );

  const scenarioCoverageMarker =
    result.scenario_coverage_status === "passed" ? "PASS" : "FAIL";
  console.log(
    `${scenarioCoverageMarker} shipping_simulation_expected_scenario_count - expected ${result.expected_scenario_count}, found ${result.scenario_count}`,
  );
  const scenarioKeyCoverageMarker =
    result.scenario_key_coverage_status === "passed" ? "PASS" : "FAIL";
  console.log(
    `${scenarioKeyCoverageMarker} shipping_simulation_expected_scenario_keys - missing ${result.missing_scenario_keys.join(", ") || "none"}; unexpected ${result.unexpected_scenario_keys.join(", ") || "none"}`,
  );

  for (const scenario of result.scenarios) {
    const marker = scenario.scenario_status === "passed" ? "PASS" : "FAIL";
    console.log(`${marker} ${scenario.scenario_key} - ${scenario.detail}`);
  }

  console.log(
    `Live shipping approval: ${result.live_approval.approval_status} (${result.live_approval.requirements_ready_count}/${result.live_approval.requirements_count} requirements ready).`,
  );

  if (result.live_approval.blockers.length > 0) {
    console.log("Live shipping blockers:");
    for (const blocker of result.live_approval.blockers) {
      console.log(`- ${blocker}`);
    }
  }

  if (result.run_status !== "passed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
