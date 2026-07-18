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

scenario("bulk candidate controls expose chunked busy and failure feedback", () => {
  for (const label of [
    "Processing selected...",
    "Recovering Card Numbers...",
    "Bulk discovery review is already running.",
    "Card-number recovery is already running.",
    "Select at least one discovery candidate first.",
    "Select at least one candidate before rejecting.",
    "No selected candidates are approval-ready.",
    "No candidates are approval-ready yet.",
    "No discovery candidates are missing exact card numbers.",
    "showBusyBlocked",
    "function cancelRejectConfirmation()",
    "function rejectSelected()",
    "aria-busy={bulkBusy}",
    "aria-busy={enrichmentBusy}",
    "aria-disabled={busy || readyCandidates.length === 0}",
    "aria-disabled={selectedReady === 0 || busy}",
    "aria-disabled={selectedCount === 0 || busy}",
    'role="alert"',
    'aria-live="assertive"',
    'role="status"',
    'aria-live="polite"',
  ]) {
    assert(
      bulkControlsSource.includes(label),
      `Expected bulk discovery feedback ${label} to be present.`,
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
    purchaseControlsSource.includes("Recording purchase and moving card..."),
    "Expected purchase recording and queue-removal pending label to be present.",
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
