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
    "aria-busy={savingCorrections}",
    "aria-busy={refreshingComps}",
    "aria-busy={card.tradeStatus === \"adding\"}",
    "Finish the current InstaComp™ batch action before retrying this row.",
    "Draft payload copy is available after the row has a complete, draftable scan result.",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner row action feedback fragment ${fragment}.`,
    );
  }
});

scenario("scanner exposes selected duplicate quantity merge action", () => {
  for (const fragment of [
    "selectedQuantityMergeCards",
    "planInstaCompSelectedQuantityMerge",
    "quantityMergeIdentityKeyForCard",
    "identityKey: quantityMergeIdentityKeyForCard(card)",
    "mergeSelectedBatchQuantityRows",
    "Merge Selected Qty",
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
    'Finish draft creation before ${action}.',
    'Finish the current InstaComp™ scan/action before ${action}.',
    'if (showBatchBusyBlocked("merging selected duplicate quantities")) return;',
    'if (showBatchBusyBlocked("removing visible rows")) return;',
    'if (showBatchBusyBlocked("rotating this row image")) return;',
    'role="alert"',
    'aria-live="assertive"',
    'role="status"',
    'aria-live="polite"',
    'batchBusyBlockedReason("removing visible failed rows")',
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
