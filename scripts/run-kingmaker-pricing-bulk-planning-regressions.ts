import assert from "node:assert/strict";
import { buildKingmakerBulkPricingPlan, kingmakerBulkPricingPlanToCsv } from "../src/lib/kingmaker-pricing-bulk-planner";

const readyDecision = {
  schema: "tcos.kingmaker.pricingDecision.v1" as const,
  status: "ready" as const,
  suggestedListPrice: 100,
  minimumProfitableListPrice: 20,
  buyCeiling: 55,
  estimatedNetProceeds: 80,
  estimatedProfitAtCeiling: 25,
  marketMedian: 95,
  referenceMidpoint: 90,
  confidence: 0.9,
  soldCompCount: 5,
  economics: {
    targetMarginPct: 0.3,
    marketplaceFeePct: 0.08,
    paymentFeePct: 0.029,
    paymentFixedFee: 0.3,
    shippingCost: 6.99,
  },
  reviewReasons: [],
  boundary: "advisory_only" as const,
};

const plan = buildKingmakerBulkPricingPlan([
  { candidateId: "a", identityId: "id-a", acquisitionCost: 40, decision: readyDecision },
  { candidateId: "b", identityId: "id-b", acquisitionCost: 60, decision: readyDecision },
  { candidateId: "c", identityId: "id-c", acquisitionCost: null, decision: readyDecision },
  {
    candidateId: "d",
    identityId: "id-d",
    acquisitionCost: 10,
    decision: { ...readyDecision, status: "review_required" as const, suggestedListPrice: null, buyCeiling: null },
  },
]);

assert.equal(plan.totalCandidates, 4);
assert.equal(plan.rankedOpportunities.length, 1);
assert.equal(plan.rankedOpportunities[0].candidateId, "a");
assert.equal(plan.rankedOpportunities[0].estimatedProfit, 40);
assert.equal(plan.totalCapitalRequired, 40);
assert.equal(plan.totalExpectedProfit, 40);
assert.deepEqual(plan.excluded.map((row) => row.reason).sort(), [
  "above_buy_ceiling",
  "acquisition_cost_missing",
  "decision_not_ready",
].sort());
assert.equal(plan.boundary, "advisory_only");

const csv = kingmakerBulkPricingPlanToCsv(plan);
assert.match(csv, /candidate_id,identity_id/);
assert.match(csv, /a,id-a/);
assert.doesNotMatch(csv, /store_id|seller_account_id/i);

console.log("KINGMAKER Pricing bulk planning regressions passed.");
