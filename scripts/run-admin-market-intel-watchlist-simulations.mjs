import { readFile } from "node:fs/promises";

const pageSource = await readFile(
  new URL("../src/app/admin/market-intel/watchlist/page.tsx", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("uses the shared pending submit button on watchlist forms", () => {
  assert(
    pageSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected watchlist page to use the shared admin submit button.",
  );

  const submitButtonCount = (pageSource.match(/<AdminSubmitButton/g) || []).length;
  assert(
    submitButtonCount >= 3,
    "Expected add, seed, and toggle forms to use pending-aware submit buttons.",
  );
});

scenario("labels long-running watchlist actions while pending", () => {
  for (const label of [
    "Adding player...",
    "Loading watchlist...",
    "Pausing...",
    "Reactivating...",
  ]) {
    assert(
      pageSource.includes(label),
      `Expected pending label ${label} to be present.`,
    );
  }
});

scenario("explains watchlist action scope and history-safe toggles", () => {
  for (const fragment of [
    "Add this player to the shared Market Intel watchlist used by scanner, comps, and alert jobs.",
    "Saves one shared target for scanner, comp engine, deal discovery, and alert rules.",
    "Load the curated current research watchlist without deleting existing player history.",
    "Adds or refreshes curated targets; existing watchlist history is preserved.",
    "Pause ${row.subject?.name || \"this target\"} in future Market Intel scans and alerts without deleting history.",
    "Reactivate ${row.subject?.name || \"this target\"} for future Market Intel scans and alerts.",
    "Pausing keeps research history but removes this target from future scans and alerts.",
    "Reactivating returns this target to future scans, comps, and alerts.",
  ]) {
    assert(
      pageSource.includes(fragment),
      `Expected watchlist action-scope fragment ${fragment}.`,
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
  `Admin Market Intel watchlist simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
