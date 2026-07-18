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
    'aria-busy={busy}',
    'aria-busy={resolutionBusy}',
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
    'aria-busy={busy === "stage"}',
    'aria-busy={busy === "submit"}',
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
    "ActionNotice",
    'aria-busy={busy}',
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
