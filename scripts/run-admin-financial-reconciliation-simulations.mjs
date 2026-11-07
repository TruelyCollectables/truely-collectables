import {
  FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH,
  cleanFinancialReconciliationNote,
  financialReconciliationDecisionError,
  financialReconciliationDecisionRequirements,
  parseFinancialReconciliationDecisionStatus,
} from "../src/lib/admin-financial-reconciliation.ts";
import { readFile } from "node:fs/promises";

const reconciliationActionsSource = await readFile(
  new URL(
    "../src/app/admin/financial-reconciliation/ReconciliationActions.tsx",
    import.meta.url,
  ),
  "utf8",
);
const reconciliationPageSource = await readFile(
  new URL(
    "../src/app/admin/financial-reconciliation/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("accepts only supported reconciliation decisions", () => {
  assert(
    parseFinancialReconciliationDecisionStatus("resolved") === "resolved",
    "resolved should parse",
  );
  assert(
    parseFinancialReconciliationDecisionStatus("ignored") === "ignored",
    "ignored should parse",
  );

  for (const status of ["", "open", "closed", "RESOLVED", null]) {
    assert(
      parseFinancialReconciliationDecisionStatus(status) === null,
      `${String(status)} should be rejected`,
    );
  }
});

scenario("requires item, status, and useful audit note", () => {
  const missing = financialReconciliationDecisionRequirements({
    itemId: "",
    status: "closed",
    resolutionNote: "ok",
  });

  assert(missing.includes("reconciliation item"), "Expected item requirement");
  assert(missing.includes("resolution status"), "Expected status requirement");
  assert(
    missing.includes(
      `audit note of at least ${FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH} characters`,
    ),
    "Expected minimum note requirement",
  );
});

scenario("allows useful resolved and ignored notes", () => {
  for (const status of ["resolved", "ignored"]) {
    assert(
      financialReconciliationDecisionError({
        itemId: "rec_123",
        status,
        resolutionNote: "Matched Stripe payout batch.",
      }) === null,
      `${status} with useful note should pass`,
    );
  }
});

scenario("trims and caps audit notes for storage", () => {
  assert(
    cleanFinancialReconciliationNote("   checked bank deposit   ") ===
      "checked bank deposit",
    "Expected note trimming",
  );
  assert(
    cleanFinancialReconciliationNote("x".repeat(1200))?.length === 1000,
    "Expected note cap",
  );
});

scenario("money-audit action UI announces busy and decision feedback", () => {
  for (const fragment of [
    "Run Previous UTC Day",
    "Reconciling...",
    "Resolving alert...",
    "Ignoring alert...",
    "Resolve Alert",
    "Ignore Alert",
    "aria-busy={busy}",
    'aria-pressed={pendingStatus === "resolved"}',
    'aria-pressed={pendingStatus === "ignored"}',
    "const reconciliationActionRunningRef = useRef(false)",
    "function reconciliationActionBlockedReason(action: string)",
    "function showReconciliationActionBlocked(action: string)",
    "Finish the current reconciliation action before ${action}.",
    "function reconciliationActionTitle",
    "const saveDecisionBlockedReason",
    "Finish the current reconciliation action first.",
    "Run the previous UTC day financial reconciliation.",
    "Open the resolution note panel for this money alert.",
    "Open the ignore-with-note panel for this money alert.",
    "Save this money alert as resolved with the audit note.",
    "Save this money alert as ignored with the audit note.",
    "Close this reconciliation decision panel without saving.",
    "title={reconciliationActionTitle",
    "reconciliationActionRunningRef.current = true",
    "reconciliationActionRunningRef.current = false",
    "function beginDecision(status: \"resolved\" | \"ignored\")",
    "function cancelDecision()",
    "aria-disabled={busy || !canSaveDecision}",
    'role={tone === "error" ? "alert" : "status"}',
    'aria-live={tone === "info" ? "polite" : "assertive"}',
  ]) {
    assert(
      reconciliationActionsSource.includes(fragment),
      `Expected reconciliation action feedback fragment ${fragment}.`,
    );
  }
});

scenario("money-audit page keeps seller-protection ledger failures readable", () => {
  for (const fragment of [
    "function safeErrorMessage",
    "const sellerProtectionAdjustmentsUnavailable = Boolean(",
    "sellerProtectionAdjustmentsResult.error",
    "Seller-protection adjustment ledger unavailable",
    "Core Stripe reconciliation loaded, but TCOS internal",
    "Do not treat the",
    "counts below as zero",
    "safeErrorMessage(sellerProtectionAdjustmentsResult.error)",
    'role="status"',
    'aria-live="polite"',
    "Seller-protection reimbursement rows are unavailable",
    "money ops view",
    '? "Unavailable"',
  ]) {
    assert(
      reconciliationPageSource.includes(fragment),
      `Expected financial reconciliation partial-ledger fragment ${fragment}.`,
    );
  }

  assert(
    !reconciliationPageSource.includes(
      "throw sellerProtectionAdjustmentsResult.error",
    ),
    "Expected seller-protection ledger failures to render inline instead of crashing the money ops page.",
  );
  assert(
    reconciliationPageSource.indexOf(
      "Seller-protection adjustment ledger unavailable",
    ) <
      reconciliationPageSource.indexOf(
        "No seller-protection reimbursement adjustments have been recorded",
      ),
    "Expected seller-protection ledger failures to render before the empty reimbursement state.",
  );
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push(item.name);
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin financial reconciliation simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
