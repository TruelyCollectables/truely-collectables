import assert from "node:assert/strict";
import { evaluateKingmakerOutcome } from "../src/lib/kingmaker-learning-engine";
import { runKingmakerPhase4Cycle } from "../src/lib/kingmaker-phase-4-control-plane";
import type { KingmakerLearningRecord } from "../src/lib/kingmaker-performance-profiles";

function record(index: number, soldAmount: number, sellerKey = "trusted"): KingmakerLearningRecord {
  const input = {
    signalFingerprint: `historical-${index}`,
    entityKey: `hockey:demidov:${index}`,
    decision: "buy" as const,
    decidedAt: `2026-0${Math.min(index, 7)}-01T00:00:00Z`,
    source: "ebay",
    sellerKey,
    predictedProfit: 18,
    predictedRoiPercent: 87,
    predictedConfidence: 0.9,
    landedCost: 30,
    soldAmount,
    soldAt: `2026-0${Math.min(index, 7)}-20T00:00:00Z`,
  };
  return {
    input,
    outcome: evaluateKingmakerOutcome(input),
    category: "hockey",
    subject: "ivan demidov",
    set: "young guns",
    strategy: "raw-rookie-value",
  };
}

const records = [record(1, 55), record(2, 58), record(3, 52), record(4, 60), record(5, 54), record(6, 57)];
const entityKey = "hockey:2025:upper deck:ivan demidov:young guns:201:base:raw";
const cycle = runKingmakerPhase4Cycle({
  generatedAt: "2026-08-03T14:00:00Z",
  availableCapital: 1000,
  reservedCapital: 200,
  previousSignals: [{
    entityKey,
    signalFingerprint: "previous",
    status: "verified",
    score: 72,
    confidence: 0.72,
    expectedProfit: 14,
    roiPercent: 46,
    deliveredCost: 30,
    marketValue: 44,
    sellerKey: "trusted",
    sourceDiversity: 2,
    observedAt: "2026-08-02T14:00:00Z",
  }],
  currentSignals: [{
    entityKey,
    signalFingerprint: "current",
    status: "verified",
    score: 92,
    confidence: 0.9,
    expectedProfit: 29,
    roiPercent: 138,
    deliveredCost: 21,
    marketValue: 50,
    sellerKey: "trusted",
    sourceDiversity: 3,
    observedAt: "2026-08-03T14:00:00Z",
  }],
  learningRecords: records,
  candidates: [{
    signalFingerprint: "current",
    entityKey,
    source: "ebay",
    sellerKey: "trusted",
    category: "hockey",
    strategy: "raw-rookie-value",
    deliveredCost: 21,
    expectedProfit: 29,
    expectedRoiPercent: 138,
    confidence: 0.9,
    reliabilityScore: 88,
    velocityScore: 0.8,
    concentrationKey: "hockey:rookies",
    marketEstimate: 50,
    historicalOutcomes: [
      { realizedSalePrice: 55, realizedProfit: 34, realizedRoiPercent: 161.9, daysToExit: 19 },
      { realizedSalePrice: 52, realizedProfit: 31, realizedRoiPercent: 147.6, daysToExit: 24 },
    ],
    marketPoints: [
      { observedAt: "2026-07-20T00:00:00Z", medianSoldPrice: 42, activeListings: 100, soldCount: 25, averageDaysToSell: 22 },
      { observedAt: "2026-08-03T00:00:00Z", medianSoldPrice: 51, activeListings: 72, soldCount: 38, averageDaysToSell: 13 },
    ],
  }],
  sellerProfiles: [{
    sellerKey: "trusted",
    source: "ebay",
    sampleSize: 12,
    winRate: 0.83,
    averageRealizedRoiPercent: 72,
    reliabilityScore: 91,
    medianDaysToExit: 20,
    cancellationRate: 0.01,
    issueRate: 0.01,
  }],
  portfolioPositions: [{
    positionKey: "owned-1",
    category: "hockey",
    subject: "ivan demidov",
    quantity: 2,
    landedCost: 20,
    marketValue: 48,
    confidence: 0.9,
    liquidity: 0.8,
    volatility: 0.2,
    acquiredAt: "2026-07-01T00:00:00Z",
  }],
  watchlistSeeds: [{
    category: "hockey",
    subject: "ivan demidov",
    set: "young guns",
    strategy: "raw-rookie-value",
    minimumExpectedRoiPercent: 25,
    maximumDeliveredCost: 40,
  }],
  sourceHealth: [
    { source: "ebay", accepted: 20, rejected: 1, lastSuccessfulAt: "2026-08-03T13:55:00Z" },
    { source: "instacomp", accepted: 12, rejected: 0, lastSuccessfulAt: "2026-08-03T13:50:00Z" },
  ],
});

assert.equal(cycle.policy.status, "expand");
assert.equal(cycle.capitalPlan.allocations[0].action, "fund");
assert.equal(cycle.sellerRanks[0].tier, "priority");
assert.equal(cycle.watchlists[0].status, "active");
assert.equal(cycle.predictions[0].momentum?.direction, "heating");
assert.ok(cycle.predictions[0].prediction.probabilityOfProfit > 0.7);
assert.ok(cycle.meaningfulChanges.some((change) => change.type === "price_drop"));
assert.equal(cycle.commandCenter.opportunityQueue.length, 1);
assert.equal(cycle.commandCenter.sourceCoverage, 1);
assert.equal(cycle.fingerprint.length, 64);
assert.equal(runKingmakerPhase4Cycle({
  generatedAt: "2026-08-03T14:00:00Z",
  availableCapital: 0,
  reservedCapital: 0,
  previousSignals: [],
  currentSignals: [],
  learningRecords: [],
  candidates: [],
  sellerProfiles: [],
  portfolioPositions: [],
  watchlistSeeds: [],
  sourceHealth: [],
}).warnings.includes("no_deployable_capital"), true);

console.log("KINGMAKER Phase 4 control plane regressions passed.");
