import { readFile } from "node:fs/promises";

const sources = {
  queue: await readFile(
    new URL("../src/app/admin/shipping/ShippingQueueActions.tsx", import.meta.url),
    "utf8",
  ),
  dryRunCleanup: await readFile(
    new URL("../src/app/admin/shipping/DryRunCleanupActions.tsx", import.meta.url),
    "utf8",
  ),
  orderLabelActions: await readFile(
    new URL(
      "../src/app/admin/orders/[id]/ShippingLabelActions.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  trackingForm: await readFile(
    new URL("../src/app/admin/orders/[id]/TrackingForm.tsx", import.meta.url),
    "utf8",
  ),
  claimActions: await readFile(
    new URL("../src/app/admin/shipping/ShippingClaimActions.tsx", import.meta.url),
    "utf8",
  ),
};

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("shipping queue actions expose live notices and specific busy labels", () => {
  for (const fragment of [
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    "Saving Coverage policy...",
    "Saving tracking...",
    "Recording LetterTrack IMb...",
    "Recording delivery evidence...",
    "Marking order shipped...",
    "shippingQueueActionRef",
    "Finish the current shipping queue action first.",
    "function shippingQueueActionTitle",
    "requiredMissing: readonly (string | null | undefined)[]",
    "const missing = requiredMissing.filter",
    "Required: ${missing.join(\", \")}.",
    "title={shippingQueueActionTitle",
    "Save Coverage policy proof for this shipping label.",
    "Save the carrier and tracking number for this order.",
    "Record the LetterTrack IMb or tracking reference for this order.",
    "Record delivery evidence copied from LetterTrack or the carrier.",
    "Save tracking and mark this order shipped.",
    "aria-busy={saving}",
    "aria-busy={shipping}",
    "aria-disabled={saving || requiredMissing.length > 0}",
    "aria-disabled={shipping || requiredMissing.length > 0}",
  ]) {
    assert(
      sources.queue.includes(fragment),
      `Expected shipping queue feedback fragment ${fragment}.`,
    );
  }
});

scenario("dry-run cleanup confirmation reports busy and live feedback", () => {
  for (const fragment of [
    "function explainDryRunCleanupBlock(action: string)",
    "Finish the current dry-run cleanup action first.",
    "Confirm the dry-run cleanup acknowledgement before retiring proof.",
    "Add a cleanup note before ${action}.",
    "aria-disabled={retiring || !cleanupNoteReady}",
    "aria-disabled={confirmDisabled}",
    "aria-disabled={retiring}",
    "function isBlockingNotice(message: string)",
    "role={isBlockingNotice(message) ? \"alert\" : \"status\"}",
    "Retiring + opening real label form...",
    "Retiring simulated proof...",
    "aria-busy={retiring}",
    "aria-live={",
    "Retiring dry-run shipping proof...",
  ]) {
    assert(
      sources.dryRunCleanup.includes(fragment),
      `Expected dry-run cleanup feedback fragment ${fragment}.`,
    );
  }
});

scenario("order shipping label actions announce async provider work", () => {
  for (const fragment of [
    "Preparing label + Coverage record...",
    "Checking provider purchase readiness...",
    "Opening Coverage claim draft...",
    "Preparing label record...",
    "Checking provider readiness...",
    "Opening Coverage claim...",
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    "aria-busy={preparing}",
    "aria-busy={purchasing}",
    "aria-busy={openingClaim}",
    "const shippingActionRunningRef = useRef(false)",
    "function shippingActionBlockedReason(action: string)",
    "function showShippingActionBlocked(action: string)",
    "Finish the current shipping label action before ${action}.",
    "shippingActionRunningRef.current = true",
    "shippingActionRunningRef.current = false",
    "aria-disabled={busy}",
    "aria-disabled={providerActionsBlocked}",
  ]) {
    assert(
      sources.orderLabelActions.includes(fragment),
      `Expected order shipping-label feedback fragment ${fragment}.`,
    );
  }
});

scenario("manual shipping proof forms lock while any order shipping action is busy", () => {
  for (const fragment of [
    "Recording manual label + Coverage...",
    "Recording external label void...",
    "aria-disabled={busy || manualPurchaseMissing.length > 0}",
    "aria-disabled={busy || voidMissing.length > 0}",
    'showShippingActionBlocked("recording manual label purchase")',
    'showShippingActionBlocked("recording an external label void")',
    'showShippingActionBlocked("opening the manual purchase form")',
    'showShippingActionBlocked("opening the external void form")',
    "aria-busy={recording}",
    "aria-busy={voiding}",
  ]) {
    assert(
      sources.orderLabelActions.includes(fragment),
      `Expected manual proof locking fragment ${fragment}.`,
    );
  }
});

scenario("order tracking form announces save and shipped feedback", () => {
  for (const fragment of [
    "type FeedbackTone",
    "Saving tracking...",
    "Saving tracking and marking shipped...",
    "Order marked shipped. Refreshing...",
    "trackingActionRunningRef",
    "Finish the current tracking action first.",
    "Save this tracking carrier and tracking number.",
    "Save tracking and mark this order shipped.",
    "aria-busy={saving}",
    "aria-busy={shipping}",
    "aria-disabled={!canSubmitTracking}",
    "aria-disabled={!canSubmitShipment}",
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    'role="status"',
    'role="alert"',
    'aria-live="assertive"',
  ]) {
    assert(
      sources.trackingForm.includes(fragment),
      `Expected order tracking-form feedback fragment ${fragment}.`,
    );
  }
});

scenario("shipping claim status actions expose typed live feedback", () => {
  for (const fragment of [
    "type ClaimActionMessage",
    "claimStatusActionRef",
    "Finish the current coverage claim status action first.",
    "Updating coverage claim...",
    "Coverage claim updated.",
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    'role={tone === "error" ? "alert" : "status"}',
    "setMessage({",
    'tone: "error"',
    'tone: "success"',
    "aria-disabled={disabled}",
    "aria-busy={pendingStatus === action.status}",
    "<ActionNotice tone={message.tone}>{message.text}</ActionNotice>",
  ]) {
    assert(
      sources.claimActions.includes(fragment),
      `Expected shipping claim feedback fragment ${fragment}.`,
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
  `Admin shipping action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
