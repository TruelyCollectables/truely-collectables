import assert from "node:assert/strict";
import {
  assertKingmakerTransition,
  canTransitionKingmakerOpportunity,
  kingmakerDecisionToStatus,
  requireKingmakerBuyTruth,
  validateKingmakerTruth,
} from "../src/lib/kingmaker-truth";

assert.equal(canTransitionKingmakerOpportunity("new", "reviewing"), true);
assert.equal(canTransitionKingmakerOpportunity("new", "bought"), false);
assert.equal(canTransitionKingmakerOpportunity("archived", "reviewing"), false);
assert.throws(
  () => assertKingmakerTransition("new", "bought"),
  /not allowed/,
);

assert.equal(kingmakerDecisionToStatus("watch"), "watching");
assert.equal(kingmakerDecisionToStatus("make_offer"), "offer_planned");
assert.equal(kingmakerDecisionToStatus("pass"), "passed");
assert.equal(kingmakerDecisionToStatus("buy"), "reviewing");

const cleanBuy = validateKingmakerTruth({
  lifecycleStatus: "bought",
  ownerDecision: "buy",
  identityStatus: "verified_exact",
  marketStatus: "verified_completed_sales",
  purchaseLotId: "purchase-1",
});
assert.equal(cleanBuy.consistent, true);
assert.deepEqual(cleanBuy.warnings, []);

const missingPurchase = validateKingmakerTruth({
  lifecycleStatus: "bought",
  ownerDecision: "buy",
  identityStatus: "verified_exact",
  marketStatus: "verified_completed_sales",
  purchaseLotId: null,
});
assert.equal(missingPurchase.consistent, false);
assert.ok(missingPurchase.warnings.includes("bought_without_purchase_lot"));

const unverifiedBuy = validateKingmakerTruth({
  lifecycleStatus: "reviewing",
  ownerDecision: "buy",
  identityStatus: "review_required",
  marketStatus: "insufficient_sales",
  purchaseLotId: null,
});
assert.equal(unverifiedBuy.consistent, false);
assert.ok(unverifiedBuy.warnings.includes("buy_decision_without_truth_gates"));

assert.throws(
  () =>
    requireKingmakerBuyTruth({
      lifecycleStatus: "bought",
      ownerDecision: "buy",
      identityStatus: "review_required",
      marketStatus: "insufficient_sales",
      purchaseLotId: "purchase-2",
    }),
  /truth gate failed/,
);

requireKingmakerBuyTruth({
  lifecycleStatus: "bought",
  ownerDecision: "buy",
  identityStatus: "verified_exact",
  marketStatus: "verified_completed_sales",
  purchaseLotId: "purchase-3",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      project: "Project KINGMAKER Beta 1.0",
      phase: "Phase 1 Truth Engine",
      assertions: 15,
      rules: {
        unifiedOpportunityLifecycle: true,
        purchaseLedgerIsCanonicalOwnershipSource: true,
        boughtRequiresPurchaseLot: true,
        buyRequiresExactIdentity: true,
        buyRequiresVerifiedCompletedSales: true,
        terminalLifecycleTransitionsAreRestricted: true,
      },
    },
    null,
    2,
  ),
);
