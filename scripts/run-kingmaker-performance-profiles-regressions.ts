import assert from "node:assert/strict";
import { evaluateKingmakerOutcome, type KingmakerDecisionOutcomeInput } from "../src/lib/kingmaker-learning-engine";
import { buildKingmakerPerformanceProfiles, type KingmakerLearningRecord } from "../src/lib/kingmaker-performance-profiles";

function record(input: KingmakerDecisionOutcomeInput, extra: Omit<KingmakerLearningRecord, "input" | "outcome">): KingmakerLearningRecord {
  return { input, outcome: evaluateKingmakerOutcome(input), ...extra };
}

const records: KingmakerLearningRecord[] = [
  record({
    signalFingerprint: "signal-1", entityKey: "card-1", decision: "buy", decidedAt: "2026-01-01T00:00:00Z",
    source: "ebay", sellerKey: "seller-a", predictedProfit: 20, predictedRoiPercent: 50, predictedConfidence: 0.85,
    landedCost: 40, soldAmount: 70, soldAt: "2026-01-11T00:00:00Z",
  }, { category: "hockey", subject: "ivan demidov", set: "young guns", strategy: "rookie-value" }),
  record({
    signalFingerprint: "signal-2", entityKey: "card-2", decision: "buy", decidedAt: "2026-02-01T00:00:00Z",
    source: "ebay", sellerKey: "seller-a", predictedProfit: 18, predictedRoiPercent: 45, predictedConfidence: 0.8,
    landedCost: 40, soldAmount: 65, soldAt: "2026-02-21T00:00:00Z",
  }, { category: "hockey", subject: "ivan demidov", set: "young guns", strategy: "rookie-value" }),
  record({
    signalFingerprint: "signal-3", entityKey: "card-3", decision: "buy", decidedAt: "2026-03-01T00:00:00Z",
    source: "mercari", sellerKey: "seller-a", predictedProfit: 15, predictedRoiPercent: 35, predictedConfidence: 0.75,
    landedCost: 50, soldAmount: 75, soldAt: "2026-03-16T00:00:00Z",
  }, { category: "hockey", subject: "ivan demidov", set: "young guns", strategy: "rookie-value" }),
  record({
    signalFingerprint: "signal-4", entityKey: "card-4", decision: "buy", decidedAt: "2026-04-01T00:00:00Z",
    source: "poshmark", sellerKey: "seller-b", predictedProfit: 15, predictedRoiPercent: 30, predictedConfidence: 0.9,
    landedCost: 50, soldAmount: 40, soldAt: "2026-06-30T00:00:00Z",
  }, { category: "baseball", subject: "prospect x", set: "bowman", strategy: "prospect-speculation" }),
  record({
    signalFingerprint: "signal-5", entityKey: "card-5", decision: "watch", decidedAt: "2026-05-01T00:00:00Z",
    source: "ebay", sellerKey: "seller-a", predictedProfit: 12, predictedRoiPercent: 25, predictedConfidence: 0.7,
  }, { category: "hockey", subject: "ivan demidov", set: "young guns", strategy: "rookie-value" }),
];

const sellers = buildKingmakerPerformanceProfiles(records, "seller");
assert.equal(sellers.length, 2);
assert.equal(sellers[0].key, "seller-a");
assert.equal(sellers[0].closedCount, 3);
assert.equal(sellers[0].wins, 3);
assert.equal(sellers[0].winRate, 1);
assert.ok(sellers[0].reliabilityScore > sellers[1].reliabilityScore);
assert.equal(sellers[0].grade === "elite" || sellers[0].grade === "strong", true);
assert.equal(sellers[1].losses, 1);
assert.equal(sellers[1].grade, "unproven");

const categories = buildKingmakerPerformanceProfiles(records, "category");
const hockey = categories.find((profile) => profile.key === "hockey");
assert.ok(hockey);
assert.equal(hockey?.sampleSize, 4);
assert.equal(hockey?.openCount, 0);
assert.equal(hockey?.averageRealizedProfit, 26.6667);
assert.equal(hockey?.medianDaysToExit, 15);

const strategies = buildKingmakerPerformanceProfiles(records, "strategy");
assert.equal(strategies[0].key, "rookie-value");
assert.equal(strategies[0].fingerprint.length, 64);

const repeated = buildKingmakerPerformanceProfiles(records, "seller");
assert.equal(repeated[0].fingerprint, sellers[0].fingerprint);

console.log("KINGMAKER performance profile regressions passed.");
