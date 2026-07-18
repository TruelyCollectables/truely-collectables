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
const importRunnerPageSource = await readFile(
  new URL("../src/app/admin/ebay/import-runner/page.tsx", import.meta.url),
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
    "const intakeActionRunningRef = useRef(false)",
    "function intakeActionBlockedReason(action: string)",
    "function showIntakeActionBlocked(action: string)",
    "Finish the current eBay inventory intake action before ${action}.",
    "intakeActionRunningRef.current = true",
    "intakeActionRunningRef.current = false",
    "const intakeActionBusy =",
    "const intakeActionBusyTitle = intakeActionBusy",
    "Pushing...",
    "Refreshing...",
    "InstaComp™ repricing...",
    "Updating...",
    "Clearing...",
    "aria-disabled={intakeActionBusy || selectedIds.length === 0}",
    "aria-disabled={intakeActionBusy || selectedPushableIds.length === 0}",
    "aria-disabled={intakeActionBusy || selectedEbayIds.length === 0}",
    "aria-disabled={intakeActionBusy}",
    "No rows are visible in the current filter.",
    "No visible rows are ready to push.",
    "No visible rows need manual or InstaComp™ help.",
    "No rows are selected.",
    "Select at least one ready or repairable row before pushing live.",
    "Select at least one row with an eBay item ID before refreshing.",
    'showIntakeActionBlocked("copying selected rows for InstaComp™ cleanup")',
    'showIntakeActionBlocked("pushing selected listings live")',
    'showIntakeActionBlocked("refreshing selected eBay data")',
    'showIntakeActionBlocked("previewing InstaComp™ prices")',
    'showIntakeActionBlocked("accepting InstaComp™ price proposals")',
    'showIntakeActionBlocked("updating selected promos")',
    'showIntakeActionBlocked("changing selected rows")',
    "selectAllPriceProposals",
    "unselectAllPriceProposals",
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
    "aria-disabled={bulkUploading}",
    "Wait for the current exact-scan upload to finish before selecting more files.",
    "disabled?: boolean;",
    "disabledReason?: string;",
    "onUnavailable?: (message: string) => void;",
    "Working...",
    "function scanUploadBlockedReason(card: CardState)",
    "Finish the bulk exact-scan upload before replacing individual scans.",
    "Wait for this scan upload to finish before choosing another file.",
    "Wait for the eBay listing action to finish before changing scans.",
    "Creating draft...",
    "Publishing...",
    "const publisherActionRunningRef = useRef(false)",
    "function listingBlockedReason(card: CardState)",
    "function openPublishConfirmation(card: CardState)",
    "function cancelPublishConfirmation(card: CardState)",
    "Finish the current eBay publisher action before starting another.",
    "Wait for exact scan uploads to finish before saving this listing.",
    "Select all policies and a location first.",
    "Upload both exact scans before creating the listing.",
    "Wait for the eBay publish action to finish before cancelling.",
    "aria-disabled={listingActionBlocked}",
    "aria-disabled={card.status === \"saving\"}",
    "aria-busy={cardSavingDraft}",
    "aria-busy={cardPublishing}",
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
  assert(
    ebayHealthSource.includes("Start the guided import workflow"),
    "Expected eBay health page to describe import controls professionally.",
  );
  assert(
    ebayHealthSource.includes("Guided eBay sync"),
    "Expected eBay health page to label import controls professionally.",
  );
  assert(
    !ebayHealthSource.includes("Import ALL active"),
    "Expected eBay health page to avoid shouted import copy.",
  );
  assert(
    !ebayHealthSource.includes("This is the big button"),
    "Expected eBay health page to avoid casual button copy.",
  );
});

scenario("eBay sync control page labels import controls professionally", () => {
  for (const fragment of [
    "Guided import",
    "Import active eBay listings",
    "Run the active-listing sync in 100-listing batches.",
  ]) {
    assert(
      syncControlSource.includes(fragment),
      `Expected eBay sync-control page professional copy fragment ${fragment}.`,
    );
  }

  for (const fragment of ["Fast lane", "Import ALL active", "One click runs"]) {
    assert(
      !syncControlSource.includes(fragment),
      `Expected eBay sync-control page to avoid casual import copy ${fragment}.`,
    );
  }
});

scenario("eBay import runner uses professional diagnostics copy", () => {
  assert(
    importRunnerPageSource.includes(
      "Browser-driven batch import with live progress and auditable diagnostics.",
    ),
    "Expected eBay import runner page to describe batch diagnostics professionally.",
  );

  for (const fragment of [
    "Import eBay safely in resumable batches",
    "clear diagnostic",
    "diagnostic sample",
    "Last batch diagnostics receipt",
    "const importRunningRef = useRef(false)",
    "An eBay import is already running.",
    "No resumable eBay import cursor is available yet.",
    "No eBay import is running right now.",
    "aria-disabled={busy}",
    "aria-disabled={busy || !canContinue}",
    "aria-disabled={!busy}",
  ]) {
    assert(
      importRunnerSource.includes(fragment),
      `Expected eBay import runner professional copy fragment ${fragment}.`,
    );
  }

  for (const fragment of ["debug sample", "raw result / debug", "timeout crap", "real errors"]) {
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
