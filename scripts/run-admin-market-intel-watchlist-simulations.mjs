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
