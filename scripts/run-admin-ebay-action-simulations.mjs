import { readFile } from "node:fs/promises";

const syncControlSource = await readFile(
  new URL("../src/app/admin/ebay/sync-control/page.tsx", import.meta.url),
  "utf8",
);
const inventoryIntakeSource = await readFile(
  new URL(
    "../src/app/admin/ebay/inventory-intake/EbayInventoryIntakeClient.tsx",
    import.meta.url,
  ),
  "utf8",
);
const publisherSource = await readFile(
  new URL("../src/app/admin/ebay/publish/EbayPublisher.tsx", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("eBay sync batch form uses a pending-aware submit", () => {
  assert(
    syncControlSource.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected eBay sync-control page to import the shared admin submit button.",
  );
  assert(
    syncControlSource.includes("Running eBay batch..."),
    "Expected eBay sync-control pending label.",
  );
});

scenario("eBay intake copy action reports clipboard failures inline", () => {
  for (const fragment of [
    "navigator.clipboard.writeText",
    "Chrome blocked clipboard access.",
    "setError(",
    "setNotice(",
  ]) {
    assert(
      inventoryIntakeSource.includes(fragment),
      `Expected eBay intake clipboard fragment ${fragment}.`,
    );
  }
});

scenario("eBay intake bulk actions expose busy labels and disabled states", () => {
  for (const fragment of [
    "Pushing...",
    "Refreshing...",
    "InstaComp™ repricing...",
    "Updating...",
    "Clearing...",
    "disabled={working || selectedIds.length === 0}",
  ]) {
    assert(
      inventoryIntakeSource.includes(fragment),
      `Expected eBay intake busy-state fragment ${fragment}.`,
    );
  }
});

scenario("eBay publisher locks uploads and labels listing saves", () => {
  for (const fragment of [
    "bulkUploading",
    "Uploading exact scans...",
    "disabled={bulkUploading}",
    "disabled?: boolean;",
    "Working...",
    "Creating draft...",
    "Publishing...",
  ]) {
    assert(
      publisherSource.includes(fragment),
      `Expected eBay publisher feedback fragment ${fragment}.`,
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
  `Admin eBay action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
