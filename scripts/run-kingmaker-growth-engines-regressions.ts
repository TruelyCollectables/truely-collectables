import assert from "node:assert/strict";
import { calculateKingmakerMomentum } from "../src/lib/kingmaker-market-momentum";
import { buildKingmakerAdaptiveWatchlists } from "../src/lib/kingmaker-adaptive-watchlists";
import { predictKingmakerOutcome } from "../src/lib/kingmaker-prediction-engine";
import type { KingmakerPerformanceProfile } from "../src/lib/kingmaker-learning-policy";

const heating = calculateKingmakerMomentum([
  { observedAt: "2026-07-20T00:00:00Z", medianSoldPrice: 40, activeListings: 100, soldCount: 20, averageDaysToSell: 20 },
  { observedAt: "2026-08-03T00:00:00Z", medianSoldPrice: 52, activeListings: 70, soldCount: 35, averageDaysToSell: 12 },
]);
assert.equal(heating.direction, "heating");
assert.ok(heating.score > 62);
assert.ok(heating.priceChangePercent > 20);

const cooling = calculateKingmakerMomentum([
  { observedAt: "2026-07-20T00:00:00Z", medianSoldPrice: 50, activeListings: 50, soldCount: 30, averageDaysToSell: 10 },
  { observedAt: "2026-08-03T00:00:00Z", medianSoldPrice: 35, activeListings: 100, soldCount: 15, averageDaysToSell: 24 },
]);
assert.equal(cooling.direction, "cooling");
assert.ok(cooling.score < 38);

const profile = (dimension: KingmakerPerformanceProfile["dimension"], key: string, overrides: Partial<KingmakerPerformanceProfile> = {}): KingmakerPerformanceProfile => ({
  dimension,
  key,
  sampleSize: 12,
  closedCount: 12,
  winRate: 0.75,
  averageRealizedProfit: 18,
  averageRealizedRoiPercent: 42,
  medianDaysToExit: 21,
  averageProfitPredictionError: -1,
  averageRoiPredictionError: -3,
  confidenceCalibrationError: 0.05,
  reliabilityScore: 82,
  grade: "strong",
  ...overrides,
});

const watchlists = buildKingmakerAdaptiveWatchlists({
  profiles: [
    profile("category", "hockey"),
    profile("subject", "Ivan Demidov"),
    profile("strategy", "raw-rookie-flip"),
  ],
  seeds: [
    {
      category: "Hockey",
      subject: "Ivan Demidov",
      set: "Young Guns",
      strategy: "raw-rookie-flip",
      minimumExpectedRoiPercent: 25,
      maximumDeliveredCost: 40,
    },
    {
      category: "Baseball",
      subject: "Unproven Prospect",
      minimumExpectedRoiPercent: 25,
    },
  ],
});
assert.equal(watchlists[0].status, "active");
assert.equal(watchlists[1].status, "suppressed");
assert.ok(watchlists[0].priority > watchlists[1].priority);

const prediction = predictKingmakerOutcome({
  deliveredCost: 25,
  marketEstimate: 50,
  signalConfidence: 0.88,
  momentumScore: heating.score,
  historicalOutcomes: [
    { realizedSalePrice: 48, realizedProfit: 23, realizedRoiPercent: 92, daysToExit: 18 },
    { realizedSalePrice: 55, realizedProfit: 30, realizedRoiPercent: 120, daysToExit: 24 },
    { realizedSalePrice: 51, realizedProfit: 26, realizedRoiPercent: 104, daysToExit: 20 },
  ],
});
assert.ok(prediction.expectedProfit > 20);
assert.ok(prediction.expectedRoiPercent > 80);
assert.ok(prediction.probabilityOfProfit > 0.7);
assert.ok(prediction.salePriceInterval.low < prediction.expectedSalePrice);
assert.ok(prediction.salePriceInterval.high > prediction.expectedSalePrice);
assert.equal(prediction.sampleSize, 3);

const coldPrediction = predictKingmakerOutcome({
  deliveredCost: 45,
  marketEstimate: 50,
  signalConfidence: 0.4,
  momentumScore: cooling.score,
  historicalOutcomes: [],
});
assert.ok(coldPrediction.probabilityOfProfit < prediction.probabilityOfProfit);
assert.ok(coldPrediction.profitInterval.low < 0);

console.log("KINGMAKER growth engine regressions passed.");
