import { instaCompBatchRowActionLabel } from "../src/lib/instacomp-row-actions.ts";

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("labels row correction saves while the action is active", () => {
  assert(
    instaCompBatchRowActionLabel({
      action: "saving_corrections",
      fallback: "Save Corrections",
    }) === "Saving Corrections...",
    "Expected active correction saves to get an explicit busy label."
  );
});

scenario("labels row comp refreshes while the action is active", () => {
  assert(
    instaCompBatchRowActionLabel({
      action: "refreshing_comps",
      fallback: "Refresh Comps",
    }) === "Refreshing Comps...",
    "Expected active comp refreshes to get an explicit busy label."
  );
});

scenario("keeps the normal row action label when idle", () => {
  assert(
    instaCompBatchRowActionLabel({
      action: null,
      fallback: "Save Corrections",
    }) === "Save Corrections",
    "Expected idle rows to keep their normal action label."
  );
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
  `InstaComp™ row action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`
);

if (failed.length > 0) {
  process.exitCode = 1;
}
