import { readFile } from "node:fs/promises";
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

scenario("offer action UI exposes busy and live checkout feedback", async () => {
  const source = await readFile("src/app/admin/offers/OfferActions.tsx", "utf8");

  for (const snippet of [
    "const offerActionRunningRef = useRef(false)",
    "offerActionRunningRef.current",
    "Finish the current offer decision before starting another action.",
    "offerActionRunningRef.current = true",
    "offerActionRunningRef.current = false",
    "const offerActionBusyReason = isBusy",
    "const counterInputTitle = isBusy",
    "Finish the current offer decision before editing the counter amount.",
    "Counter amount is locked because this offer is no longer pending.",
    "Enter a counter above the buyer offer and up to ${money(productPrice)}.",
    "title={counterInputTitle}",
    'aria-busy={loading === "accepted"}',
    'aria-busy={loading === "declined"}',
    'aria-busy={loading === "counter"}',
    "aria-disabled={!canAccept || isBusy}",
    "aria-disabled={!canDecline || isBusy}",
    "aria-disabled={!canCounter || isBusy}",
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    'role={tone === "error" ? "alert" : "status"}',
    "Creating accepted-offer checkout link...",
    "Creating counter-offer checkout link...",
    "Creating checkout link...",
    "Sending counter link...",
  ]) {
    assert(source.includes(snippet), `Expected OfferActions to include ${snippet}`);
  }
});

scenario("offer status routes use pending compare-and-set updates", async () => {
  const updateStatusSource = await readFile(
    "src/app/api/offers/update-status/route.ts",
    "utf8",
  );
  const counterSource = await readFile("src/app/api/offers/counter/route.ts", "utf8");
  const staleMessage =
    "Offer is no longer pending. Refresh offers before deciding again.";

  assert(
    countOccurrences(updateStatusSource, '.eq("status", "pending")') >= 2,
    "Accept/decline route should guard both update paths by pending status.",
  );
  assert(
    counterSource.includes('.eq("status", "pending")'),
    "Counter route should guard the update by pending status.",
  );

  for (const [name, source] of [
    ["accept/decline route", updateStatusSource],
    ["counter route", counterSource],
  ]) {
    assert(source.includes(".maybeSingle()"), `${name} should tolerate stale no-row updates.`);
    assert(source.includes(staleMessage), `${name} should return a stale-offer message.`);
    assert(source.includes("{ status: 409 }"), `${name} should report stale offers as conflicts.`);
  }
});

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

const failed = [];

for (const item of scenarios) {
  try {
    await item.run();
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
