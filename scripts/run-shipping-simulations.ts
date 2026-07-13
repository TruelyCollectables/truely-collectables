import { runShippingSimulationSuite } from "../src/lib/shipping-simulations";

async function main() {
  const result = await runShippingSimulationSuite();

  console.log(
    `Shipping simulation suite ${result.suite_version}: ${result.passed_count}/${result.scenario_count} passed.`,
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
