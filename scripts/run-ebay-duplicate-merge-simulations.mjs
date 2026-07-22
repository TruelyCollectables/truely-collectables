import {
  normalizeEbayDuplicateProductIds,
  planEbayDuplicateQuantityMerge,
} from "../src/lib/ebay-duplicate-merge.ts";
import {
  reconcileEbayDuplicateKeeperSelection,
  reconcileEbayDuplicateRowSelection,
} from "../src/lib/ebay-duplicate-selection.ts";
import { readFile } from "node:fs/promises";

const duplicateFinderSource = await readFile(
  new URL("../src/app/admin/ebay/duplicates/EbayDuplicateFinderClient.tsx", import.meta.url),
  "utf8",
);
const duplicatePageSource = await readFile(
  new URL("../src/app/admin/ebay/duplicates/page.tsx", import.meta.url),
  "utf8",
);
const duplicateRouteSource = await readFile(
  new URL("../src/app/api/admin/ebay-duplicates/route.ts", import.meta.url),
  "utf8",
);

const scenarios = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectError(callback, expectedText) {
  try {
    callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(expectedText),
      `Expected error containing "${expectedText}", received "${message}"`,
    );
    return;
  }

  throw new Error(`Expected error containing "${expectedText}", but nothing threw`);
}

async function scenario(name, callback) {
  const startedAt = Date.now();

  try {
    await callback();
    scenarios.push({ name, status: "passed", elapsedMs: Date.now() - startedAt });
  } catch (error) {
    scenarios.push({
      name,
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await scenario("normalizes duplicate product IDs safely", () => {
  const ids = normalizeEbayDuplicateProductIds([
    42,
    "43",
    "43",
    0,
    -1,
    "abc",
    44.5,
    null,
  ]);

  assert(ids.join(",") === "42,43", "Only unique positive integer IDs should remain");
  assert(
    normalizeEbayDuplicateProductIds("55").join(",") === "55",
    "Scalar duplicateProductId should normalize to one ID",
  );
});

await scenario("plans multi-row duplicate quantity merge", () => {
  const plan = planEbayDuplicateQuantityMerge({
    keeperProductId: 100,
    keeperQuantity: 2,
    duplicateRows: [
      { productId: 101, quantity: 1 },
      { productId: 102, quantity: 3 },
    ],
  });

  assert(plan.keeperProductId === 100, "Keeper ID should be preserved");
  assert(
    plan.duplicateProductIds.join(",") === "101,102",
    "All non-keeper duplicate rows should be archived",
  );
  assert(plan.previousKeeperQuantity === 2, "Keeper quantity should be captured");
  assert(plan.duplicateQuantity === 4, "Duplicate quantities should be summed");
  assert(plan.mergedQuantity === 6, "Keeper should become 2 + 1 + 3 = 6");
  assert(plan.archivedDuplicateCount === 2, "Two duplicate rows should be archived");
});

await scenario("plans selected quantity two plus one duplicate merge", () => {
  const plan = planEbayDuplicateQuantityMerge({
    keeperProductId: 200,
    keeperQuantity: 2,
    duplicateRows: [{ productId: 201, quantity: 1 }],
  });

  assert(plan.previousKeeperQuantity === 2, "Keeper quantity should remain 2");
  assert(plan.duplicateQuantity === 1, "Selected duplicate quantity should be 1");
  assert(plan.mergedQuantity === 3, "Keeper should become quantity 2 + 1 = 3");
  assert(plan.archivedDuplicateCount === 1, "Only the selected duplicate should archive");
});

await scenario("filters keeper and duplicate duplicate IDs from merge plan", () => {
  const plan = planEbayDuplicateQuantityMerge({
    keeperProductId: 100,
    keeperQuantity: "2.9",
    duplicateRows: [
      { productId: 100, quantity: 99 },
      { productId: 101, quantity: "1.7" },
      { productId: 101, quantity: 5 },
      { productId: 102, quantity: -4 },
    ],
  });

  assert(
    plan.duplicateProductIds.join(",") === "101,102",
    "Keeper and repeated duplicate IDs should be ignored",
  );
  assert(plan.previousKeeperQuantity === 2, "Fractional keeper quantity should floor");
  assert(plan.duplicateQuantity === 1, "Fractional/negative duplicate quantities should be bounded");
  assert(plan.mergedQuantity === 3, "Merged quantity should use sanitized whole quantities");
});

await scenario("rejects merge with no duplicate row different from keeper", () => {
  expectError(
    () =>
      planEbayDuplicateQuantityMerge({
        keeperProductId: 100,
        keeperQuantity: 2,
        duplicateRows: [{ productId: 100, quantity: 1 }],
      }),
    "Pick at least one duplicate",
  );
});

await scenario("reconciles stale duplicate finder selections after refresh", () => {
  const groups = [
    {
      key: "pikachu::1000",
      recommendedKeeperProductId: 202,
      rows: [{ productId: 202 }, { productId: 203 }],
    },
    {
      key: "charizard::2500",
      recommendedKeeperProductId: 301,
      rows: [{ productId: 301 }, { productId: 302 }],
    },
  ];
  const keepers = reconcileEbayDuplicateKeeperSelection(groups, {
    "pikachu::1000": 201,
    "stale::999": 999,
  });
  const duplicates = reconcileEbayDuplicateRowSelection(
    groups,
    {
      "pikachu::1000": 201,
      "charizard::2500": 301,
      "stale::999": 999,
    },
    keepers,
  );

  assert(
    keepers["pikachu::1000"] === 202,
    "Expected missing keeper to reset to the refreshed recommended keeper.",
  );
  assert(
    keepers["charizard::2500"] === 301,
    "Expected new group keeper to use recommended keeper.",
  );
  assert(
    !("stale::999" in keepers),
    "Expected stale keeper groups to be dropped after refresh.",
  );
  assert(
    duplicates["pikachu::1000"] === 203,
    "Expected duplicate selection to pick a valid non-keeper row.",
  );
  assert(
    duplicates["charizard::2500"] === 302,
    "Expected duplicate selection not to target the keeper.",
  );
  assert(
    !("stale::999" in duplicates),
    "Expected stale duplicate groups to be dropped after refresh.",
  );
});

await scenario("duplicate finder previews destructive end and merge actions", () => {
  for (const fragment of [
    "type DuplicateAction",
    "type ActionNoticeTone",
    "const workingActionRef = useRef<DuplicateAction>(null)",
    "function setActiveDuplicateAction(action: DuplicateAction)",
    "function duplicateActionBlockedReason(action: string)",
    "function showDuplicateActionBlocked(action: string)",
    "function duplicateRowLabel(row: DuplicateRow | null | undefined)",
    "function duplicateRowScope(row: DuplicateRow | null | undefined)",
    "Finish the current duplicate cleanup action before ${action}.",
    "Duplicate scan is already running.",
    "showNotice",
    "showError",
    "clearMessages",
    "Previewing merge...",
    "Previewing merge for ${actionLabel}: ${duplicateScope} into keeper ${keeperScope}...",
    "Merging ${actionLabel} now: keeper ${keeperScope} will change from quantity",
    "duplicate quantity ${preview.duplicateQuantity} will be archived to 0.",
    "Previewing end/archive",
    "Previewing end/archive for duplicate ${duplicateScope}...",
    "That row is marked as the keeper",
    "Ending now: duplicate ${duplicateScope} will move from quantity",
    "const mergeActionTitle",
    "const selectedMergeTitle",
    "const endSelectedTitle",
    "Merge ${allDuplicateRows.length} duplicate row",
    "into keeper ${keeperScope}; keeper becomes quantity ${mergedQuantity}.",
    "Duplicate merge plan",
    "Merge Selected Only archives the highlighted duplicate.",
    "Merge All archives every non-keeper row.",
    "The selected",
    "End Selected Only.",
    "#{keeperRow.productId} quantity {keeperRow.quantity}",
    "{allDuplicateRows.length} row",
    "{duplicateQuantity}",
    "Selected duplicate quantity {selectedDuplicateQuantity}",
    "keeper quantity {mergedQuantity}",
    "Selected merge quantity {selectedMergedQuantity}",
    "async function mergeSelectedDuplicate(group: DuplicateGroup)",
    "mode: \"selected\"",
    "action: \"merge-duplicate\"",
    "confirm: \"MERGE_DUPLICATE\"",
    "Merge selected duplicate ${duplicateScope} into keeper ${keeperScope}; keeper becomes quantity ${selectedMergedQuantity}. Other duplicate rows stay active.",
    "Merge Selected → quantity",
    "Merge Selected Only",
    "Previewing selected merge...",
    "Merging selected...",
    "End/archive selected duplicate ${duplicateScope}; this leaves keeper ${keeperScope} untouched.",
    "Keep ${rowScope} as the survivor for this duplicate group.",
    "Select ${rowScope} as the duplicate to end or merge.",
    "Preview and end/archive duplicate ${rowScope}; quantity will become 0 after confirmation.",
    "dryRun: true",
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    'role={tone === "error" ? "alert" : "status"}',
    'aria-busy={loading}',
    "aria-disabled={loading || Boolean(workingAction)}",
    "aria-busy={groupMergingSelected}",
    "aria-busy={groupMergingAll}",
    'aria-busy={groupWorking && workingAction?.kind === "end"}',
    "aria-busy={rowEnding}",
    "aria-disabled={mergeUnavailable}",
    "aria-disabled={selectedMergeUnavailable}",
    "aria-disabled={endSelectedUnavailable}",
    "aria-disabled={selectDuplicateUnavailable}",
    "aria-disabled={endRowUnavailable}",
    "const selectDuplicateUnavailable = duplicateCleanupBusy || isKeeper",
    "const endRowUnavailable = duplicateCleanupBusy || isKeeper",
    'showDuplicateActionBlocked("starting another merge or end/archive")',
    'showDuplicateActionBlocked("changing the keeper row")',
    'showDuplicateActionBlocked("changing the duplicate row")',
    "That row is marked as the keeper. Pick a different row to end, or choose another keeper first.",
    'showDuplicateActionBlocked("rescanning duplicates")',
    "allowDuringAction?: boolean",
    "loadGroups({ preserveMessages: true, allowDuringAction: true })",
    "reconcileEbayDuplicateKeeperSelection",
    "reconcileEbayDuplicateRowSelection",
    "function selectedKeeperProductIdForGroup(group: DuplicateGroup)",
  ]) {
    assert(
      duplicateFinderSource.includes(fragment),
      `Expected duplicate finder action-safety fragment ${fragment}.`,
    );
  }
});

await scenario("duplicate finder actions use immediate keeper selection", () => {
  const helperIndex = duplicateFinderSource.indexOf(
    "function selectedKeeperProductIdForGroup(group: DuplicateGroup)",
  );
  const chooseDuplicateIndex = duplicateFinderSource.indexOf(
    "const keeperProductId = selectedKeeperProductIdForGroup(group);",
  );
  const mergeGroupIndex = duplicateFinderSource.indexOf(
    "async function mergeGroup(group: DuplicateGroup)",
  );
  const endDuplicateIndex = duplicateFinderSource.indexOf(
    "async function endDuplicate(group: DuplicateGroup, duplicateProductId: number)",
  );

  assert(helperIndex > 0, "Expected duplicate finder to centralize selected keeper lookup.");
  assert(
    duplicateFinderSource.includes("keepersRef.current[group.key] ||"),
    "Expected selected keeper lookup to prefer the immediate keeper ref.",
  );
  assert(
    chooseDuplicateIndex > helperIndex,
    "Expected duplicate-row selection to use the immediate selected keeper.",
  );
  assert(
    duplicateFinderSource.indexOf(
      "const keeperProductId = selectedKeeperProductIdForGroup(group);",
      mergeGroupIndex,
    ) > mergeGroupIndex,
    "Expected merge action to use the immediate selected keeper.",
  );
  assert(
    duplicateFinderSource.indexOf(
      "const keeperProductId = selectedKeeperProductIdForGroup(group);",
      endDuplicateIndex,
    ) > endDuplicateIndex,
    "Expected end/archive action to use the immediate selected keeper.",
  );
});

await scenario("duplicate cleanup keeps eBay provider failures operator-readable", () => {
  for (const fragment of [
    "const EBAY_DUPLICATE_PROVIDER_TIMEOUT_MS",
    "function fetchEbayJsonWithTimeout",
    "const controller = new AbortController()",
    "signal: controller.signal",
    "function ebayProviderTimeoutMessage",
    "eBay provider request timed out while",
    "Local TCOS cleanup can continue; refresh eBay sync or retry provider cleanup after the eBay connection responds.",
    "function ebayProviderFailureMessage",
    "eBay did not withdraw the duplicate offer.",
    "Local TCOS cleanup completed; refresh eBay sync or withdraw the duplicate listing from eBay.",
    "eBay did not update the keeper listing quantity.",
    "Local TCOS merge completed; refresh eBay sync or update the keeper listing quantity from eBay.",
    "providerResponse: response.ok ? undefined : data",
    "function ebaySkippedMessage(action: string, error?: unknown)",
    "eBay duplicate-offer cleanup was skipped.",
    "eBay keeper quantity update was skipped.",
    "detail: error instanceof Error ? error.message",
  ]) {
    assert(
      duplicateRouteSource.includes(fragment),
      `Expected duplicate route operator-readable provider warning fragment ${fragment}.`,
    );
  }

  for (const rawFragment of [
    "Duplicate eBay withdraw failed:",
    "Keeper eBay quantity update failed:",
    "JSON.stringify(data).slice",
    "${action} skipped: ${error.message}",
    "eBay token lookup skipped: ${error.message}",
  ]) {
    assert(
      !duplicateRouteSource.includes(rawFragment),
      `Expected duplicate route to avoid raw provider warning fragment ${rawFragment}.`,
    );
  }
});

await scenario("duplicate finder uses professional quantity labels", () => {
  for (const fragment of [
    "total quantity",
    "keeper quantity",
    "duplicate quantity",
    "archived quantity 0",
    "quantity ${row.quantity}",
    "quantity ${duplicateQuantity}",
    "quantity ${preview.previousQuantity}",
    "keeper becomes quantity",
    "Merge All → quantity",
    "Quantity {row.quantity}",
  ]) {
    assert(
      duplicateFinderSource.includes(fragment),
      `Expected duplicate finder professional quantity label ${fragment}.`,
    );
  }

  for (const roughFragment of [
    "total qty",
    "keeper qty",
    "duplicate qty",
    "archived qty",
    "becomes qty",
    "→ qty",
    "· Qty",
  ]) {
    assert(
      !duplicateFinderSource.includes(roughFragment),
      `Expected duplicate finder to avoid rough quantity shorthand ${roughFragment}.`,
    );
  }
});

await scenario("duplicate finder page uses professional command presentation", () => {
  for (const fragment of [
    "Duplicate Cleanup Desk",
    "eBay Duplicate Finder",
    "Exact-match only",
    "Quantity-safe merge",
    "Bounded eBay cleanup",
    "rounded-[2rem] border border-neutral-900 bg-neutral-950",
    "shadow-2xl shadow-neutral-950/10",
    "max-w-[1500px]",
    "border border-white/15 bg-white/10",
    "transition hover:-translate-y-0.5",
  ]) {
    assert(
      duplicatePageSource.includes(fragment),
      `Expected duplicate finder page presentation fragment ${fragment}.`,
    );
  }

  for (const roughShell of [
    'bg-[#f4f1ea]',
    'bg-[#101418]',
    "max-w-7xl",
    "border border-white/20 bg-white/[0.03]",
  ]) {
    assert(
      !duplicatePageSource.includes(roughShell),
      `Expected duplicate finder page to avoid rough shell fragment ${roughShell}.`,
    );
  }
});

await scenario("duplicate finder clears stale notices across action outcomes", () => {
  for (const fragment of [
    "setNotice(message);",
    'setError("");',
    "setError(message);",
    'setNotice("");',
    "<ActionNotice tone=\"error\">",
    '<ActionNotice tone={workingAction ? "info" : "success"}>',
    "preserveMessages?: boolean",
    "loadGroups({ preserveMessages: true, allowDuringAction: true })",
  ]) {
    assert(
      duplicateFinderSource.includes(fragment),
      `Expected duplicate finder single-notice fragment ${fragment}.`,
    );
  }
});

await scenario("duplicate API supports end/archive dry-run preview", () => {
  for (const fragment of [
    "previewArchiveDuplicate",
    "previousInventoryQuantity",
    "inventoryStatus",
    "body.dryRun === true",
    "will be archived to 0",
  ]) {
    assert(
      duplicateRouteSource.includes(fragment),
      `Expected duplicate route dry-run fragment ${fragment}.`,
    );
  }
});

const failed = scenarios.filter((item) => item.status === "failed");

for (const item of scenarios) {
  const prefix = item.status === "passed" ? "PASS" : "FAIL";
  const detail = item.error ? ` - ${item.error}` : "";
  console.log(`${prefix} ${item.name} (${item.elapsedMs}ms)${detail}`);
}

console.log(
  `eBay duplicate merge simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
