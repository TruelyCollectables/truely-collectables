import {
  canRemoveInstaCompBatchRow,
  instaCompBatchRowRemovalBlockedReason,
  instaCompBatchRowRemovalLabel,
} from "../src/lib/instacomp-row-removal.ts";
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

scenario("allows row removal while a batch scan is running", () => {
  assert(
    canRemoveInstaCompBatchRow({
      batchDrafting: false,
      draftStatus: "idle",
      isRemoving: false,
    }),
    "Expected non-drafting scan rows to remain removable."
  );

  assert(
    instaCompBatchRowRemovalLabel({ status: "scanning" }) === "End / Remove",
    "Expected active scan rows to make the end/remove action explicit."
  );

  assert(
    instaCompBatchRowRemovalLabel({ status: "queued" }) === "End / Remove",
    "Expected queued scan rows to make the end/remove action explicit."
  );
});

scenario("blocks only dangerous draft handoff removal states", () => {
  assert(
    instaCompBatchRowRemovalBlockedReason({
      batchDrafting: true,
      draftStatus: "idle",
      isRemoving: false,
    }) === "Finish or stop draft creation before removing an InstaComp™ row.",
    "Expected batch drafting to block removal."
  );

  assert(
    instaCompBatchRowRemovalBlockedReason({
      batchDrafting: false,
      draftStatus: "drafting",
      isRemoving: false,
    }) ===
      "This row is creating a draft right now. Remove it after drafting finishes.",
    "Expected row drafting to block removal."
  );
});

scenario("prevents duplicate row removal clicks", () => {
  assert(
    !canRemoveInstaCompBatchRow({
      batchDrafting: false,
      draftStatus: "idle",
      isRemoving: true,
    }),
    "Expected a row already being removed to block duplicate removal."
  );

  assert(
    instaCompBatchRowRemovalLabel({ status: "done", isRemoving: true }) ===
      "Removing...",
    "Expected pending removal to get a clear button label."
  );
});

scenario("row removal has a synchronous click guard", () => {
  for (const fragment of [
    "const removingBatchCardIdsRef = useRef<Set<string>>(new Set())",
    "removingBatchCardIdsRef.current.has(cardId)",
    "removingBatchCardIdsRef.current.add(cardId)",
    "removingBatchCardIdsRef.current.delete(cardId)",
    "removingBatchCardIdsRef.current.clear()",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner synchronous removal guard fragment ${fragment}.`,
    );
  }
});

scenario("makes wrong scan row removal explicit", () => {
  assert(
    instaCompBatchRowRemovalLabel({
      status: "done",
      operatorMarkedWrong: true,
    }) === "Remove Wrong Row",
    "Expected operator-marked wrong scan rows to get an explicit removal label."
  );
});

scenario("tombstones removed persistent rows so active workers skip them", () => {
  for (const fragment of [
    "removedBatchCardIdsRef",
    "removedPersistentItemIdsRef",
    "removedPersistentClientIdsRef",
    "batchCardAbortControllersRef",
    "persistentRemovalTargetForBatchCard",
    "rememberRemovedPersistentBatchCard",
    "claimedPersistentItemWasRemoved",
    "abortBatchCardScan",
    "abortController.signal.aborted",
    "cancelPersistentItem",
    "removedBatchCardIdsRef.current.has(card.id)",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner removal tombstone fragment ${fragment}.`,
    );
  }
});

scenario("uses saved binding targets when cancelling removed rows", () => {
  for (const fragment of [
    "card.persistentJobId || binding?.jobId || null",
    "card.persistentItemId || binding?.itemId || null",
    "const persistentTarget = persistentRemovalTargetForBatchCard(card)",
    "const isPersisted = Boolean(persistentTarget.jobId && persistentTarget.itemId)",
    "cancelPersistentBatchCard(card, persistentTarget)",
    "target: persistentRemovalTargetForBatchCard(card)",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner persistent cancellation fragment ${fragment}.`,
    );
  }
});

scenario("row remove button exposes busy and blocked feedback", () => {
  for (const fragment of [
    "const removeBlockedReason = instaCompBatchRowRemovalBlockedReason",
    "aria-disabled={!canRemove}",
    "aria-busy={isRemoving}",
    "if (!canRemove) {\n                    onBlockedAction(removeBlockedReason || \"This row cannot be removed right now.\");",
    'role="status"',
    "Remove blocked:",
    "Ended active scan for ${cardTitle} and removed it from this batch.",
    "Ended pending scan for ${cardTitle} and removed it from this batch.",
    "End this queued or active scan row",
    "Removing row and cancelling saved InstaComp™ storage when present...",
  ]) {
    assert(
      scannerSource.includes(fragment),
      `Expected scanner removal feedback fragment ${fragment}.`,
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
  `InstaComp™ row removal simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`
);

if (failed.length > 0) {
  process.exitCode = 1;
}
