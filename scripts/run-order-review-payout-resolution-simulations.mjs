import {
  cleanOrderReviewPayoutResolutionNote,
  orderReviewPayoutResolutionRequirements,
} from "../src/lib/order-review-payout-resolution.ts";

const scenarios = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

await scenario("requires audit note for money-moving payout resolutions", () => {
  for (const action of [
    "release_to_seller",
    "reverse_for_buyer",
    "cancel_no_payout",
  ]) {
    const missing = orderReviewPayoutResolutionRequirements({
      action,
      adminNote: "short",
    });

    assert(
      missing.includes("audit note"),
      `${action} should require a clear audit note`,
    );
  }
});

await scenario("allows hold-for-appeal without a money movement note", () => {
  const missing = orderReviewPayoutResolutionRequirements({
    action: "hold_for_appeal",
    adminNote: "",
  });

  assert(missing.length === 0, "Keeping rows held should not need a new note");
});

await scenario("accepts clear audit notes and trims note values", () => {
  const note = cleanOrderReviewPayoutResolutionNote("  seller won appeal  ");
  const missing = orderReviewPayoutResolutionRequirements({
    action: "release_to_seller",
    adminNote: note,
  });

  assert(note === "seller won appeal", "Audit note should be trimmed");
  assert(missing.length === 0, "Clear audit note should satisfy release guard");
});

const failed = scenarios.filter((item) => item.status === "failed");

for (const item of scenarios) {
  const prefix = item.status === "passed" ? "PASS" : "FAIL";
  const detail = item.error ? ` - ${item.error}` : "";
  console.log(`${prefix} ${item.name} (${item.elapsedMs}ms)${detail}`);
}

console.log(
  `Order review payout resolution simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
