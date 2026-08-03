import assert from "node:assert/strict";
import { deriveKingmakerLearningPolicy, type KingmakerPerformanceProfile } from "../src/lib/kingmaker-learning-policy";

function profile(overrides: Partial<KingmakerPerformanceProfile> = {}): KingmakerPerformanceProfile {
  return {
    dimension: "seller",
    key: "seller-a",
    sampleSize: 10,
    closedCount: 10,
    winRate: 0.7,
    averageRealizedProfit: 18,
    averageRealizedRoiPercent: 36,
    medianDaysToExit: 20,
    averageProfitPredictionError: -2,
    averageRoiPredictionError: -4,
    confidenceCalibrationError: 0.05,
    reliabilityScore: 82,
    grade: "strong",
    ...overrides,
  };
}

const insufficient = deriveKingmakerLearningPolicy({
  profiles: [profile({ closedCount: 2, sampleSize: 2 })],
});
assert.equal(insufficient.status, "insufficient_data");
assert.equal(insufficient.maximumPositionMultiplier, 0.5);
assert.equal(insufficient.confidenceAdjustment, 0);

const expanding = deriveKingmakerLearningPolicy({ profiles: [profile()] });
assert.equal(expanding.status, "expand");
assert.equal(expanding.maximumPositionMultiplier, 1.25);
assert.equal(expanding.minimumRequiredRoiPercent, 15);
assert.ok(expanding.confidenceAdjustment > 0);

const tightening = deriveKingmakerLearningPolicy({
  profiles: [profile({
    key: "seller-b",
    winRate: 0.3,
    averageRealizedProfit: -4,
    averageRealizedRoiPercent: -12,
    averageProfitPredictionError: -15,
    averageRoiPredictionError: -35,
    confidenceCalibrationError: 0.28,
    reliabilityScore: 31,
    grade: "weak",
  })],
});
assert.equal(tightening.status, "tighten");
assert.ok(tightening.minimumRequiredRoiPercent >= 40);
assert.ok(tightening.minimumRequiredProfit >= 13);
assert.ok(tightening.maximumPositionMultiplier <= 0.5);
assert.ok(tightening.confidenceAdjustment < 0);

const holding = deriveKingmakerLearningPolicy({
  profiles: [profile({
    winRate: 0.55,
    averageRealizedRoiPercent: 16,
    reliabilityScore: 63,
    grade: "reliable",
  })],
});
assert.equal(holding.status, "hold");
assert.equal(holding.maximumPositionMultiplier, 1);

const repeat = deriveKingmakerLearningPolicy({ profiles: [profile()] });
assert.equal(expanding.fingerprint, repeat.fingerprint);

console.log("KINGMAKER learning policy regressions passed.");
