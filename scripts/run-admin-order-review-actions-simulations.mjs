import { readFile } from "node:fs/promises";

const sources = {
  caseQueue: await readFile(
    new URL("../src/app/admin/order-review-cases/CaseQueueActions.tsx", import.meta.url),
    "utf8",
  ),
  stripeEvidence: await readFile(
    new URL("../src/app/admin/order-review-cases/StripeEvidenceActions.tsx", import.meta.url),
    "utf8",
  ),
  orderDetailReview: await readFile(
    new URL(
      "../src/app/admin/orders/[id]/OrderReviewCasesPanel.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  orderDetailPage: await readFile(
    new URL("../src/app/admin/orders/[id]/page.tsx", import.meta.url),
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

scenario("case queue actions expose accessible save and payout feedback", () => {
  for (const fragment of [
    "type FeedbackTone",
    "Saving case...",
    "Case saved.",
    "Applying payout resolution...",
    "ActionMessage",
    "caseActionRunningRef",
    "payoutResolutionRunningRef",
    "Case save is already running.",
    "Payout resolution is already running.",
    "No seller payout rows are tied to this case scope.",
    'aria-busy={busy}',
    'aria-busy={resolutionBusy}',
    "aria-disabled={payoutResolutionDisabled}",
    'aria-live={message.tone === "info" ? "polite" : "assertive"}',
    'role={message.tone === "error" ? "alert" : "status"}',
  ]) {
    assert(
      sources.caseQueue.includes(fragment),
      `Expected case queue feedback fragment ${fragment}.`,
    );
  }
});

scenario("case queue submits the visible effective payout action", () => {
  for (const fragment of [
    "const effectiveResolutionAction",
    "selectedResolutionOption?.[0] || resolutionAction",
    "action: effectiveResolutionAction",
  ]) {
    assert(
      sources.caseQueue.includes(fragment),
      `Expected effective payout action fragment ${fragment}.`,
    );
  }

  assert(
    sources.caseQueue.indexOf("const effectiveResolutionAction") <
      sources.caseQueue.indexOf("action: effectiveResolutionAction"),
    "Expected effective payout action to be derived before being submitted.",
  );
});

scenario("stripe evidence actions expose accessible staged and submit feedback", () => {
  for (const fragment of [
    "type FeedbackTone",
    "Generating and staging Stripe evidence...",
    "Evidence staged in Stripe for review.",
    "Submitting final evidence to Stripe...",
    "Evidence submitted to Stripe.",
    "Type SUBMIT TO STRIPE exactly before final submission.",
    "evidenceActionRunningRef",
    "beginSubmitConfirmation",
    "Stripe evidence action is already running.",
    "Stage Stripe evidence before final submission.",
    "Evidence is already",
    "const stageButtonTitle",
    "const submitButtonTitle",
    "const finalSubmitTitle",
    "const cancelSubmitTitle",
    "Generate and stage editable Stripe dispute evidence.",
    "Open the final Stripe evidence submission confirmation.",
    "Submit final evidence to Stripe and the issuing bank.",
    "Close this Stripe final-submission confirmation.",
    "title={stageButtonTitle}",
    "title={submitButtonTitle}",
    "title={finalSubmitTitle}",
    "title={cancelSubmitTitle}",
    'aria-busy={busy === "stage"}',
    'aria-busy={busy === "submit"}',
    "aria-disabled={busy !== null || stageLocked}",
    "aria-disabled={busy !== null || !canSubmit}",
    'aria-live={message.tone === "info" ? "polite" : "assertive"}',
    'role={message.tone === "error" ? "alert" : "status"}',
  ]) {
    assert(
      sources.stripeEvidence.includes(fragment),
      `Expected Stripe evidence feedback fragment ${fragment}.`,
    );
  }
});

scenario("order detail case opener exposes typed live feedback", () => {
  for (const fragment of [
    "type FeedbackTone",
    "Opening order review case...",
    "Case opened. Seller payout rows held:",
    "Add a clear case title before opening review.",
    "createCaseRunningRef",
    "Order review case is already opening.",
    "ActionNotice",
    'aria-busy={busy}',
    "aria-disabled={busy || !canCreateCase}",
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    "Order review case is opening.",
    "Open a review case and apply the selected holds.",
  ]) {
    assert(
      sources.orderDetailReview.includes(fragment),
      `Expected order detail case opener feedback fragment ${fragment}.`,
    );
  }
});

scenario("order detail page keeps linked order records failure-safe", () => {
  for (const fragment of [
    "function safeErrorMessage",
    "function UnavailableNotice",
    "const evidenceUnavailable = Boolean(evidenceError)",
    "const payoutLedgerUnavailable = Boolean(payoutLedgerError)",
    "const platformFeeLedgerUnavailable = Boolean(platformFeeLedgerError)",
    "const shippingLabelsUnavailable = Boolean(shippingLabelsError)",
    "const shippingTrackingEventsUnavailable = Boolean(",
    "const shippingCoverageClaimsUnavailable = Boolean(shippingCoverageClaimsError)",
    "Platform fee ledger unavailable.",
    "Seller payout ledger unavailable.",
    "Shipping label records unavailable.",
    "Tracking event history unavailable.",
    "Coverage claim history unavailable.",
    "Evidence packet history unavailable.",
    "safeErrorMessage(error)",
    "safeErrorMessage(orderReviewCasesError)",
    "safeErrorMessage(orderReviewCaseEventsError)",
    "error={platformFeeLedgerError}",
    "error={payoutLedgerError}",
    "error={shippingLabelsError}",
    "error={shippingTrackingEventsError}",
    "error={shippingCoverageClaimsError}",
    "error={evidenceError}",
    "cannot prove whether TCOS checkout fee rows exist",
    "do not release funds or treat this seller queue as clear",
    "cannot prove whether a label record",
    "delivery scans, provider events, and LetterTrack evidence cannot be trusted",
    "claim status cannot be trusted",
    "chargeback packets and delivery proof cannot be treated as missing",
  ]) {
    assert(
      sources.orderDetailPage.includes(fragment),
      `Expected order detail unavailable-state fragment ${fragment}.`,
    );
  }

  for (const forbidden of [
    "{payoutLedgerError.message}",
    "{shippingLabelsError.message}",
    "{shippingTrackingEventsError.message}",
    "{shippingCoverageClaimsError.message}",
    "{evidenceError.message}",
    "tableError={orderReviewCasesError?.message || null}",
    "eventsError={orderReviewCaseEventsError?.message || null}",
  ]) {
    assert(
      !sources.orderDetailPage.includes(forbidden),
      `Order detail page must not render raw error fragment ${forbidden}.`,
    );
  }

  for (const [unavailable, empty, label] of [
    [
      "Seller payout ledger unavailable.",
      "No seller payout ledger entries have been created for this order yet.",
      "seller payout ledger",
    ],
    [
      "Shipping label records unavailable.",
      "No label record has been prepared yet.",
      "shipping labels",
    ],
    [
      "Tracking event history unavailable.",
      "No tracking events have been recorded yet.",
      "tracking events",
    ],
    [
      "Coverage claim history unavailable.",
      "No loss/damage coverage claims have been opened.",
      "coverage claims",
    ],
    [
      "Evidence packet history unavailable.",
      "No evidence packet has been created for this order yet.",
      "evidence packets",
    ],
  ]) {
    const unavailableIndex = sources.orderDetailPage.indexOf(unavailable);
    const emptyIndex = sources.orderDetailPage.indexOf(empty, unavailableIndex);

    assert(unavailableIndex >= 0, `Expected ${label} unavailable state.`);
    assert(emptyIndex >= 0, `Expected ${label} empty state.`);
    assert(
      unavailableIndex < emptyIndex,
      `Expected ${label} unavailable state to render before its empty state.`,
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
  `Admin order review action simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
