import {
  FINANCIAL_RECONCILIATION_NOTE_MIN_LENGTH,
  cleanFinancialReconciliationNote,
  financialReconciliationDecisionError,
  financialReconciliationDecisionRequirements,
  parseFinancialReconciliationDecisionStatus,
} from "../src/lib/admin-financial-reconciliation.ts";

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
