import {
  canRemoveInstaCompBatchRow,
  instaCompBatchRowRemovalBlockedReason,
  instaCompBatchRowRemovalLabel,
} from "../src/lib/instacomp-row-removal.ts";

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
