import { instaCompBatchRowActionLabel } from "../src/lib/instacomp-row-actions.ts";
import {
  normalizedInstaCompMergeIdentityKey,
  normalizedInstaCompMergeTitle,
  normalizedInstaCompMergeQuantity,
  planInstaCompSelectedQuantityMerge,
} from "../src/lib/instacomp-row-merge.ts";
import { readFile } from "node:fs/promises";

const scannerSource = await readFile(
  new URL("../src/app/admin/instacomp/InstaCompScanner.tsx", import.meta.url),
  "utf8",
);

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

scenario("plans selected duplicate row quantity merges", () => {
  const plan = planInstaCompSelectedQuantityMerge([
    {
      id: "keeper",
      title: "2024 Pokemon Pikachu #25",
      quantity: 2,
    },
    {
      id: "duplicate",
      title: " 2024   Pokemon Pikachu #25 ",
      quantity: 1,
    },
  ]);

  assert(plan.ok, "Expected matching selected rows to merge.");
  if (!plan.ok) return;

  assert(plan.keeperId === "keeper", "Expected first selected row to be keeper.");
  assert(plan.duplicateIds.join(",") === "duplicate", "Expected second row to be removed.");
  assert(plan.previousKeeperQuantity === 2, "Expected keeper quantity to be captured.");
  assert(plan.duplicateQuantity === 1, "Expected duplicate quantity to be summed.");
  assert(plan.mergedQuantity === 3, "Expected 2 + 1 to become quantity 3.");
});

scenario("normalizes real-world card title differences before merging", () => {
  assert(
    normalizedInstaCompMergeTitle("2024 Pokémon Pikachu #025") ===
      normalizedInstaCompMergeTitle("2024 Pokemon Pikachu 025"),
    "Expected accent and punctuation differences to normalize to the same merge title.",
  );

  const plan = planInstaCompSelectedQuantityMerge([
    {
      id: "keeper",
      title: "2024 Pokémon Pikachu #025",
      quantity: 2,
    },
    {
      id: "duplicate",
      title: "2024 Pokemon Pikachu 025",
      quantity: 1,
    },
  ]);

  assert(plan.ok, "Expected accent and punctuation differences to merge.");
  if (!plan.ok) return;

  assert(plan.mergedQuantity === 3, "Expected normalized Pokemon duplicate quantities to sum.");
});

scenario("merges scanned duplicate quantities by stable card identity", () => {
  assert(
    normalizedInstaCompMergeIdentityKey("2024 | Pokémon | Pikachu | 025") ===
      normalizedInstaCompMergeIdentityKey("2024 Pokemon Pikachu #025"),
    "Expected identity keys to normalize consistently.",
  );

  const plan = planInstaCompSelectedQuantityMerge([
    {
      id: "keeper",
      title: "2024 Pokemon Pikachu #025 - edited keeper title",
      identityKey: "2024 | Pokemon | Pikachu | 025",
      quantity: 2,
    },
    {
      id: "duplicate",
      title: "Pikachu scan row from another upload",
      identityKey: "2024 Pokemon Pikachu #025",
      quantity: 1,
    },
  ]);

  assert(plan.ok, "Expected matching scanned identities to merge despite title edits.");
  if (!plan.ok) return;

  assert(plan.mergedQuantity === 3, "Expected identity merge to sum 2 + 1.");
});

scenario("lets corrected scan titles override stale merge identities", () => {
  const plan = planInstaCompSelectedQuantityMerge([
    {
      id: "keeper",
      title: "2026 Pokemon Pikachu #025",
      identityKey: null,
      quantity: 2,
    },
    {
      id: "duplicate",
      title: "2026 Pokémon Pikachu 025",
      identityKey: "wrong scanner identity | charizard | 004",
      quantity: 1,
    },
  ]);

  assert(plan.ok, "Expected operator-corrected matching titles to merge.");
  if (!plan.ok) return;

  assert(
    plan.mergedQuantity === 3,
    "Expected corrected Pokemon duplicate quantities to sum 2 + 1.",
  );
});

scenario("blocks scanned quantity merge across different identities", () => {
  const plan = planInstaCompSelectedQuantityMerge([
    {
      id: "keeper",
      title: "Edited title",
      identityKey: "2024 Pokemon Pikachu #025",
      quantity: 2,
    },
    {
      id: "duplicate",
      title: "Edited title",
      identityKey: "2024 Pokemon Charizard #004",
      quantity: 1,
    },
  ]);

  assert(!plan.ok, "Expected different scanned identities to block merge.");
  assert(
    !plan.ok && plan.reason.includes("same scanned card"),
    `Expected scanned-identity mismatch reason, got ${plan.ok ? "ok" : plan.reason}.`,
  );
});

scenario("blocks merging selected rows with different titles", () => {
  const plan = planInstaCompSelectedQuantityMerge([
    { id: "one", title: "Pikachu", quantity: 1 },
    { id: "two", title: "Charizard", quantity: 1 },
  ]);

  assert(!plan.ok, "Expected different edited titles to block merging.");
  assert(
    !plan.ok && plan.reason.includes("same edited title"),
    `Expected clear mismatch reason, got ${plan.ok ? "ok" : plan.reason}.`,
  );
});

scenario("normalizes merge quantities to positive whole counts", () => {
  assert(normalizedInstaCompMergeQuantity("2.9") === 2, "Expected floor quantity.");
  assert(normalizedInstaCompMergeQuantity(0) === 1, "Expected zero to become one.");
  assert(normalizedInstaCompMergeQuantity("abc") === 1, "Expected invalid quantity fallback.");
});

scenario("scanner row actions expose busy and disabled reasons", () => {
  for (const fragment of [
    "copyDraftPayloadBlockedReason",
    "saveCorrectionsBlockedReason",
    "refreshCompsBlockedReason",
    "addToTradeBlockedReason",
    "aria-busy={savingCorrections}",
    "aria-busy={refreshingComps}",
    "aria-busy={card.tradeStatus === \"adding\"}",
    "Finish the current InstaComp™ batch action before retrying this row.",
    'batchBusyBlockedReason("retrying this row")',
    'batchBusyBlockedReason("saving row corrections")',
    'batchBusyBlockedReason("refreshing row comps")',
    'batchBusyBlockedReason("adding this row to trade")',
    "This card is already being added to Available for Trade.",
    "Draft payload copy is available after the row has a complete, draftable scan result.",
    "aria-disabled={!canCopyDraftPayload}",
    "aria-disabled={!canSaveCorrections}",
    "aria-disabled={!canRefreshComps}",
    "aria-disabled={!canAddToTrade}",
    "aria-disabled={!canRetry}",
    "onBlockedAction={setBatchDraftMessage}",
    "aria-disabled={!canSwapImages}",
    "aria-disabled={priceButtonsDisabled}",
    "aria-disabled={disabled}",
    "onUnavailable={(message) => setError(message)}",
    "No ${label} is available yet.",
    "No InstaComp™ suggested price is available yet.",
    "No comp-based price is available yet. Refresh comps or enter a listing price manually.",
    "Finish the current InstaComp™ batch action before rotating images.",
    "Image rotation is locked after draft creation starts.",
    "Add a back image before swapping front/back.",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner row action feedback fragment ${fragment}.`,
    );
  }
});

scenario("scanner row actions explain unavailable clicks before running handlers", () => {
  for (const fragment of [
    "if (!canCopyDraftPayload) {\n                      onBlockedAction(copyDraftPayloadBlockedReason);",
    "if (!canSaveCorrections) {\n                    onBlockedAction(saveCorrectionsBlockedReason);",
    "if (!canRefreshComps) {\n                    onBlockedAction(refreshCompsBlockedReason);",
    "if (!canAddToTrade) {\n                    onBlockedAction(addToTradeBlockedReason);",
    "if (!canRetry) {\n                    onBlockedAction(",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner unavailable row action guard fragment ${fragment}.`,
    );
  }
});

scenario("scanner test fallback uses professional review copy", () => {
  assert(
    scannerSource.includes('setName: "File-Based Review"'),
    "Expected arbitrary test uploads to use an operator-facing set label.",
  );
  assert(
    !scannerSource.includes("Filename Placeholder"),
    "Expected scanner fallback copy to avoid placeholder labels.",
  );
});

scenario("scanner final tester labels avoid internal speed-gate shorthand", () => {
  for (const fragment of [
    "Parallel Scans",
    "FINAL TESTER PASS",
    "final tester speed gate",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner final tester copy fragment ${fragment}.`,
    );
  }

  assert(
    !scannerSource.includes("FAF"),
    "Expected scanner operator copy to avoid internal FAF shorthand.",
  );
});

scenario("scanner exposes selected duplicate quantity merge action", () => {
  for (const fragment of [
    "selectedQuantityMergeCards",
    "selectedQuantityMergePlan",
    "selectedQuantityMergeHelp",
    "selectedQuantityMergeDisabled",
    "planInstaCompSelectedQuantityMerge",
    "quantityMergeIdentityKeyForCard",
    "selectedQuantityMergeIdentityKeyForCard",
    "return card.customTitle.trim() ? null : quantityMergeIdentityKeyForCard(card);",
    "identityKey: selectedQuantityMergeIdentityKeyForCard(card)",
    "mergeSelectedBatchQuantityRows",
    "Merge Selected Qty",
    "Ready to merge ${selectedQuantityMergePlan.mergedRowCount} selected duplicate rows: qty ${selectedQuantityMergePlan.previousKeeperQuantity} + ${selectedQuantityMergePlan.duplicateQuantity} = ${selectedQuantityMergePlan.mergedQuantity}.",
    "qty ${mergePlan.previousKeeperQuantity} + ${mergePlan.duplicateQuantity} = ${mergePlan.mergedQuantity}",
    "persistBatchCardCorrections(mergedKeeper)",
    "persistedDuplicates.map(({ card, target }) =>",
    "cancelPersistentBatchCard(card, target)",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner selected quantity merge fragment ${fragment}.`,
    );
  }
});

scenario("selected quantity merge cannot leave the batch stuck busy", () => {
  for (const fragment of [
    "const quantityMergeRunningRef = useRef(false)",
    "quantityMergeRunningRef.current",
    "Finish the current InstaComp™ quantity merge before merging again.",
    "quantityMergeRunningRef.current = true",
    "setBatchRunning(true)",
    "Merging selected duplicate rows into",
    "} finally {\n      quantityMergeRunningRef.current = false;\n      setBatchRunning(false);\n    }",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner selected quantity merge cleanup fragment ${fragment}.`,
    );
  }
});

scenario("scanner blocked batch controls explain why nothing ran", () => {
  for (const fragment of [
    "function batchBusyBlockedReason(action: string)",
    "function showBatchBusyBlocked(action: string)",
    "No InstaComp™ batch is running right now.",
    "Pause is already requested. Current mini-pack will finish first.",
    "Finish preparing the saved InstaComp™ lot before scanning.",
    "Finish draft creation before scanning the batch.",
    "Finish the current InstaComp™ scan/action before scanning again.",
    "No draftable rows are available to select.",
    "selectedOperatorMarkedProblemBatchCardIds",
    "removeSelectedOperatorMarkedProblemBatchCards",
    '"removing selected marked problem rows"',
    "Remove Selected Problems",
    "Select wrong or needs-more-info rows before removing marked problems.",
    "Use Process Marked Problems to rerun them, or Remove Selected Problems to drop bad scans.",
    "No visible InstaComp™ rows are available to export as CSV.",
    "No visible InstaComp™ rows are available to export as JSON.",
    'batchBusyBlockedReason("exporting visible trial results")',
    'batchBusyBlockedReason("copying visible trial results")',
    'batchBusyBlockedReason("exporting selected draft payload")',
    'batchBusyBlockedReason("copying selected draft payload")',
    'batchBusyBlockedReason("exporting selected clean draft payload")',
    'batchBusyBlockedReason("copying selected clean draft payload")',
    'batchBusyBlockedReason("exporting visible draft payload")',
    'batchBusyBlockedReason("copying visible draft payload")',
    'batchBusyBlockedReason("exporting visible clean draft payload")',
    'batchBusyBlockedReason("copying visible clean draft payload")',
    'batchBusyBlockedReason("copying the current view summary")',
    'batchBusyBlockedReason("copying the current view CSV")',
    'batchBusyBlockedReason("copying the current view JSON")',
    'showBatchBusyBlocked("clearing draft errors")',
    'showBatchBusyBlocked(\n        selected ? "selecting visible draftable rows" : "deselecting visible rows"\n      )',
    'showBatchBusyBlocked("selecting visible ready rows")',
    'showBatchBusyBlocked("selecting visible clean rows")',
    'showBatchBusyBlocked("selecting visible clean ready rows")',
    'showBatchBusyBlocked("deselecting visible review rows")',
    'showBatchBusyBlocked("deselecting visible ready review rows")',
    'showBatchBusyBlocked("deselecting visible review fix rows")',
    'showBatchBusyBlocked("deselecting visible clean fix rows")',
    'showBatchBusyBlocked("deselecting visible fix rows")',
    'batchBusyBlockedReason("retrying visible failed rows")',
    'batchBusyBlockedReason(\n      reviewState === "wrong"',
    'batchBusyBlockedReason("saving row corrections")',
    'batchBusyBlockedReason("saving selected corrections")',
    "Finish TCOS Card DB processing before saving selected corrections.",
    'batchBusyBlockedReason("refreshing row comps")',
    'batchBusyBlockedReason("refreshing selected comps")',
    "Finish TCOS Card DB processing before refreshing selected comps.",
    "TCOS Card DB processing is already running.",
    'batchBusyBlockedReason("processing the saved lot into the TCOS Card DB")',
    "function testModelBusyBlockedReason(action: string)",
    "Finish the current InstaComp™ test run before ${action}.",
    "function showTestModelBusyBlocked(action: string)",
    'showTestModelBusyBlocked("running a smoke check")',
    'showTestModelBusyBlocked("exporting test evidence")',
    'showTestModelBusyBlocked("copying test evidence")',
    'showTestModelBusyBlocked("exporting smoke check rows")',
    'showTestModelBusyBlocked("copying smoke check rows")',
    'showTestModelBusyBlocked("exporting smoke check JSON")',
    'showTestModelBusyBlocked("copying smoke check JSON")',
    'showTestModelBusyBlocked("exporting failure CSV")',
    'showTestModelBusyBlocked("copying failure CSV")',
    'showTestModelBusyBlocked("exporting failure JSON")',
    'showTestModelBusyBlocked("copying failure JSON")',
    'showTestModelBusyBlocked("copying failure summary")',
    'showTestModelBusyBlocked("exporting the fixture manifest")',
    'showTestModelBusyBlocked("copying the fixture manifest")',
    'showTestModelBusyBlocked("copying the QA summary")',
    'showTestModelBusyBlocked("exporting the test run ledger CSV")',
    'showTestModelBusyBlocked("copying the test run ledger CSV")',
    'showTestModelBusyBlocked("exporting the test run ledger JSON")',
    'showTestModelBusyBlocked("copying the test run ledger JSON")',
    'showTestModelBusyBlocked("copying the test run ledger summary")',
    'showTestModelBusyBlocked("clearing the test run ledger")',
    'showTestModelBusyBlocked("running all test cycles")',
    'showTestModelBusyBlocked("running the full test cycle")',
    'showTestModelBusyBlocked("running the draft test cycle")',
    'showTestModelBusyBlocked("loading single-card test scan images")',
    'showTestModelBusyBlocked("resetting the test lab")',
    "Finish the current single-card InstaComp™ scan before loading test images.",
    "Finish the current single-card InstaComp™ scan before resetting the test lab.",
    "InstaComp™ is already running for this card.",
    "function showTestModelProblemRows(",
    "No ${label.toLocaleLowerCase()} are available to show.",
    "function clearTestModelRunLedger()",
    "No test run ledger records are available to clear.",
    "Cleared the test run ledger.",
    "batchBusyBlockedReason(`exporting ${label} report rows`)",
    "creating ${options.blockedScopeLabel} draft listings",
    "Exported ${visibleBatchCards.length} visible row",
    "as CSV.",
    "as JSON.",
    'batchBusyBlockedReason("creating draft listings")',
    'batchBusyBlockedReason(\n      selected ? "selecting draftable rows" : "deselecting draftable rows"\n    )',
    'Finish draft creation before ${action}.',
    'Finish the current InstaComp™ scan/action before ${action}.',
    "aria-disabled={\n              batchRunning ||\n              batchDrafting ||\n              persistentJobPreparing ||\n              !batchCards.length",
    "aria-disabled={!batchRunning || batchPauseRequested}",
    "aria-disabled={batchRunning || batchDrafting || batchErrorCount === 0}",
    "aria-disabled={createDraftButtonDisabled}",
    "aria-disabled={batchRunning || batchDrafting || batchDraftableCount === 0}",
    "aria-disabled={batchRunning || batchDrafting || readyDraftableCount === 0}",
    "aria-disabled={batchRunning || batchDrafting || selectedDraftFixCount === 0}",
    "aria-disabled={!visibleBatchCards.length}",
    "aria-disabled={\n              batchRunning || batchDrafting || visibleTrialResultCount === 0\n            }",
    "aria-disabled={selectedQuantityMergeDisabled}",
    "aria-disabled={exportDraftPayloadDisabled}",
    "aria-disabled={createSelectedReadyDraftButtonDisabled}",
    "aria-disabled={exportCleanDraftPayloadDisabled}",
    "aria-disabled={batchRunning || batchDrafting || visibleReadyCount === 0}",
    "aria-disabled={\n                batchRunning || batchDrafting || visibleCleanReadyCount === 0\n              }",
    "aria-disabled={batchRunning || batchDrafting || visibleDraftFixCount === 0}",
    "aria-disabled={batchRunning || batchDrafting || visibleReviewCount === 0}",
    "aria-disabled={batchRunning || batchDrafting || visibleFailedCount === 0}",
    "aria-disabled={\n                  batchRunning || batchDrafting || visibleBatchCards.length === 0\n                }",
    "aria-disabled={batchRunning || batchDrafting || visibleDraftableCount === 0}",
    "aria-disabled={batchRunning || batchDrafting || visibleCleanCount === 0}",
    "aria-disabled={\n                batchRunning || batchDrafting || visibleReadyReviewCount === 0\n              }",
    "aria-disabled={\n                batchRunning || batchDrafting || visibleReviewDraftFixCount === 0\n              }",
    "aria-disabled={\n                batchRunning || batchDrafting || visibleCleanDraftFixCount === 0\n              }",
    "aria-disabled={batchRunning || batchDrafting || visibleDraftErrorCount === 0}",
    "aria-disabled={batchRunning || batchDrafting || visibleDraftedCount === 0}",
    "aria-disabled={\n              batchRunning || batchDrafting || selectedReviewableBatchCards.length === 0\n            }",
    "aria-disabled={\n              batchRunning ||\n              batchDrafting ||\n              batchKnowledgeSaving ||\n              selectedSavableCorrectionCount === 0",
    "aria-disabled={\n              batchRunning ||\n              batchDrafting ||\n              batchKnowledgeSaving ||\n              selectedRefreshableCompCount === 0",
    "aria-disabled={\n              batchRunning ||\n              batchDrafting ||\n              batchKnowledgeSaving ||\n              !persistentJob ||\n              batchDoneCount === 0",
    "aria-disabled={batchRunning || batchDrafting}",
    "aria-disabled={loading || batchRunning || batchDrafting}",
    "aria-disabled={batchRunning || batchDrafting || !batchCards.length}",
    "aria-disabled={\n                batchRunning || batchDrafting || (!batchCards.length && !result)\n              }",
    "aria-disabled={batchRunning || batchDrafting || !testModelChecks.length}",
    "aria-disabled={\n                batchRunning ||\n                batchDrafting ||\n                (testModelFailedCount === 0 && testModelProblemRowCount === 0)\n              }",
    "aria-disabled={loading || !frontImage}",
    "aria-disabled={item.count === 0}",
    'if (showBatchBusyBlocked("merging selected duplicate quantities")) return;',
    "busyAction: string",
    "if (showBatchBusyBlocked(busyAction)) return;",
    '"removing visible failed rows"',
    '"removing visible drafted rows"',
    'if (showBatchBusyBlocked("rotating this row image")) return;',
    'role="alert"',
    'aria-live="assertive"',
    'role="status"',
    'aria-live="polite"',
    'batchBusyBlockedReason("removing visible failed rows")',
    'batchBusyBlockedReason("removing visible drafted rows")',
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner blocked-control feedback fragment ${fragment}.`,
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
  `InstaComp™ row action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`
);

if (failed.length > 0) {
  process.exitCode = 1;
}
