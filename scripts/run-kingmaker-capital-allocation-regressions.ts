import assert from "node:assert/strict";
import { buildKingmakerCapitalPlan } from "../src/lib/kingmaker-capital-allocation";
import type { KingmakerLearningPolicy } from "../src/lib/kingmaker-learning-policy";

const policy: KingmakerLearningPolicy = {
  status: "hold",
  confidenceAdjustment: 0,
  maximumPositionMultiplier: 1,
  minimumRequiredRoiPercent: 20,
  minimumRequiredProfit: 5,
  reasons: ["test"],
  fingerprint: "policy-1",
};

const plan = buildKingmakerCapitalPlan({
  budget: 500,
  reservePercent: 0.2,
  maximumSinglePositionPercent: 0.3,
  maximumConcentrationPercent: 0.5,
  policy,
  candidates: [
    { signalFingerprint: "a", entityKey: "card-a", source: "ebay", sellerKey: "seller-a", category: "hockey", strategy: "raw-rookie", deliveredCost: 60, expectedProfit: 45, expectedRoiPercent: 75, confidence: 0.9, reliabilityScore: 85, velocityScore: 0.8, concentrationKey: "hockey:rookies" },
    { signalFingerprint: "b", entityKey: "card-b", source: "mercari", sellerKey: "seller-b", category: "hockey", strategy: "raw-rookie", deliveredCost: 90, expectedProfit: 30, expectedRoiPercent: 33, confidence: 0.82, reliabilityScore: 70, velocityScore: 0.7, concentrationKey: "hockey:rookies" },
    { signalFingerprint: "c", entityKey: "card-c", source: "poshmark", sellerKey: "seller-c", category: "shoes", strategy: "flip", deliveredCost: 80, expectedProfit: 8, expectedRoiPercent: 10, confidence: 0.8, reliabilityScore: 70, velocityScore: 0.6 },
  ],
});

assert.equal(plan.reserveAmount, 100);
assert.equal(plan.deployableAmount, 400);
assert.equal(plan.allocations.find((item) => item.signalFingerprint === "a")?.action, "fund");
assert.equal(plan.allocations.find((item) => item.signalFingerprint === "b")?.action, "fund");
assert.equal(plan.allocations.find((item) => item.signalFingerprint === "c")?.action, "reject");
assert.ok(plan.allocatedAmount <= plan.deployableAmount);
assert.ok(plan.allocations[0].rankScore >= plan.allocations[1].rankScore);
assert.equal(plan.fingerprint.length, 64);

const tightPlan = buildKingmakerCapitalPlan({
  budget: 100,
  reservePercent: 0,
  maximumSinglePositionPercent: 0.25,
  policy: { ...policy, status: "tighten", maximumPositionMultiplier: 0.5 },
  candidates: [{ signalFingerprint: "d", entityKey: "card-d", source: "ebay", category: "hockey", strategy: "raw", deliveredCost: 30, expectedProfit: 20, expectedRoiPercent: 66, confidence: 0.9 }],
});
assert.equal(tightPlan.allocations[0].action, "watch");
assert.ok(tightPlan.allocations[0].reasons.includes("insufficient_position_or_concentration_capacity"));

console.log("KINGMAKER capital allocation regressions passed.");
