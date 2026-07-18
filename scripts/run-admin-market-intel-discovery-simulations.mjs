import { readFile } from "node:fs/promises";

const discoveryPageSource = await readFile(
  new URL("../src/app/admin/market-intel/discovery/page.tsx", import.meta.url),
  "utf8",
);
const bulkControlsSource = await readFile(
  new URL(
    "../src/app/admin/market-intel/discovery/BulkCandidateControls.tsx",
    import.meta.url,
  ),
  "utf8",
);
const purchaseControlsSource = await readFile(
  new URL(
    "../src/app/admin/market-intel/discovery/PurchaseCandidateControls.tsx",
    import.meta.url,
  ),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

scenario("discovery page uses shared pending submits for scan and review forms", () => {
  assert(
    discoveryPageSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected discovery page to import the shared admin submit button.",
  );
  assert(
    count(discoveryPageSource, /<AdminSubmitButton/g) >= 3,
    "Expected scan, approve, and reject forms to use pending-aware submits.",
  );

  for (const label of [
    "Scanning eBay...",
    "Approving and scoring...",
    "Rejecting...",
  ]) {
    assert(
      discoveryPageSource.includes(label),
      `Expected discovery pending label ${label} to be present.`,
    );
  }
});

scenario("bulk candidate controls lock selected actions during submit", () => {
  assert(
    bulkControlsSource.includes("useFormStatus"),
    "Expected bulk controls to use form status for native POST submissions.",
  );
  assert(
    bulkControlsSource.includes("function BulkSubmitButton"),
    "Expected a dedicated bulk submit component.",
  );

  for (const label of [
    "Approving selected...",
    "Rejecting selected...",
  ]) {
    assert(
      bulkControlsSource.includes(label),
      `Expected bulk pending label ${label} to be present.`,
    );
  }
});

scenario("purchase candidate controls show a recording state", () => {
  assert(
    purchaseControlsSource.includes("useFormStatus"),
    "Expected purchase controls to use form status for native POST submissions.",
  );
  assert(
    purchaseControlsSource.includes("function PurchaseSubmitButton"),
    "Expected a dedicated purchase submit component.",
  );
  assert(
    purchaseControlsSource.includes("Recording purchase..."),
    "Expected purchase recording pending label to be present.",
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
  `Admin Market Intel discovery simulations: ${
    scenarios.length - failed.length
  }/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
