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
const ebayHealthSource = await readFile(
  new URL("../src/app/admin/ebay/page.tsx", import.meta.url),
  "utf8",
);
const importRunnerSource = await readFile(
  new URL("../src/app/admin/ebay/import-runner/EbayImportRunner.tsx", import.meta.url),
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
    "showError(",
    "showNotice(",
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

scenario("eBay intake actions use a single live notice channel", () => {
  for (const fragment of [
    'type ActionNoticeTone = "success" | "error" | "info";',
    "const showNotice = useCallback((message: string)",
    "const showError = useCallback((message: string)",
    "const clearMessages = useCallback(()",
    "const loadRows = useCallback(async",
    "preserveMessages?: boolean",
    "await loadRows({ preserveMessages: true })",
    "role={tone === \"error\" ? \"alert\" : \"status\"}",
    "aria-live={tone === \"info\" ? \"polite\" : \"assertive\"}",
    "aria-busy={working}",
    "aria-busy={promoWorking}",
    "aria-busy={repriceWorkingIds.length > 0}",
  ]) {
    assert(
      inventoryIntakeSource.includes(fragment),
      `Expected eBay intake live notice fragment ${fragment}.`,
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

scenario("eBay health page labels diagnostic actions for operators", () => {
  assert(
    ebayHealthSource.includes('label="Connection Test"'),
    "Expected eBay diagnostic API link to use operator-grade copy.",
  );
  assert(
    !ebayHealthSource.includes('label="Test Route"'),
    "Expected eBay health page to avoid raw developer route labels.",
  );
});

scenario("eBay import runner uses professional diagnostics copy", () => {
  for (const fragment of [
    "Import eBay safely in resumable batches",
    "clear diagnostic",
    "diagnostic sample",
    "Last batch diagnostics receipt",
  ]) {
    assert(
      importRunnerSource.includes(fragment),
      `Expected eBay import runner professional copy fragment ${fragment}.`,
    );
  }

  for (const fragment of ["debug sample", "raw result / debug", "timeout crap"]) {
    assert(
      !importRunnerSource.includes(fragment),
      `Expected eBay import runner to avoid rough operator copy ${fragment}.`,
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
