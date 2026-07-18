import {
  adminOfferDecisionError,
  adminOfferDecisionRequirements,
  canApplyAdminOfferDecision,
  normalizedOfferMoney,
} from "../src/lib/admin-offer-decision.ts";

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("locks every offer money action after pending status", () => {
  for (const action of ["accepted", "declined", "countered"]) {
    const missing = adminOfferDecisionRequirements({
      action,
      offerStatus: "accepted",
      offerAmount: 50,
      counterAmount: 75,
      productPrice: 100,
      productQuantity: 1,
    });

    assert(
      missing.includes("pending offer status"),
      `${action} should require pending status.`,
    );
  }
});

scenario("accept requires available inventory and a positive offer", () => {
  assert(
    canApplyAdminOfferDecision({
      action: "accepted",
      offerStatus: "pending",
      offerAmount: "42.499",
      productPrice: "100.00",
      productQuantity: 2,
    }),
    "A valid pending offer with inventory should be acceptable.",
  );

  const error = adminOfferDecisionError({
    action: "accepted",
    offerStatus: "pending",
    offerAmount: 0,
    productPrice: 100,
    productQuantity: 0,
  });

  assert(
    error ===
      "Offer action needs: available product quantity, positive offer amount.",
    `Unexpected accept error: ${error}`,
  );
});

scenario("counter must be above offer and no higher than asking", () => {
  assert(
    canApplyAdminOfferDecision({
      action: "countered",
      offerStatus: "pending",
      offerAmount: 75,
      counterAmount: 90,
      productPrice: 100,
      productQuantity: 1,
    }),
    "A counter between offer and asking price should be allowed.",
  );

  const missing = adminOfferDecisionRequirements({
    action: "countered",
    offerStatus: "pending",
    offerAmount: 75,
    counterAmount: 125,
    productPrice: 100,
    productQuantity: 1,
  });

  assert(
    missing.includes("counter at or below asking price"),
    "Counter above asking should be blocked.",
  );

  assert(
    adminOfferDecisionRequirements({
      action: "countered",
      offerStatus: "pending",
      offerAmount: 75,
      counterAmount: 75,
      productPrice: 100,
      productQuantity: 1,
    }).includes("counter above buyer offer"),
    "Counter at or below buyer offer should be blocked.",
  );
});

scenario("normalizes offer money to checkout-safe cents", () => {
  assert(normalizedOfferMoney("10.236") === 10.24, "Expected cent rounding");
  assert(normalizedOfferMoney("abc") === null, "Expected invalid money to return null");
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
  `Admin offer decision simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) process.exitCode = 1;
