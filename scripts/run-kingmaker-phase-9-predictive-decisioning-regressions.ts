import assert from "node:assert/strict";
import {
  correlateKingmakerMarkets,
  explainKingmakerDecision,
  forecastKingmakerMetric,
  scoreKingmakerReadiness,
  simulateKingmakerPortfolio,
} from "../src/lib/kingmaker-phase-9-predictive-decisioning";

const forecast = forecastKingmakerMetric({
  metric: "queue_pressure",
  points: [
    { at: "2026-08-03T12:00:00Z", value: 20 },
    { at: "2026-08-03T13:00:00Z", value: 30 },
    { at: "2026-08-03T14:00:00Z", value: 40 },
    { at: "2026-08-03T15:00:00Z", value: 50 },
  ],
  horizonPeriods: 2,
  warningThreshold: 80,
});
assert.equal(forecast.trend, "deteriorating");
assert.equal(forecast.predicted, 70);
assert.equal(forecast.warningInPeriods, 3);
assert.equal(forecast.fingerprint, forecastKingmakerMetric({
  metric: "queue_pressure",
  points: [
    { at: "2026-08-03T15:00:00Z", value: 50 },
    { at: "2026-08-03T13:00:00Z", value: 30 },
    { at: "2026-08-03T12:00:00Z", value: 20 },
    { at: "2026-08-03T14:00:00Z", value: 40 },
  ],
  horizonPeriods: 2,
  warningThreshold: 80,
}).fingerprint);

const correlated = correlateKingmakerMarkets({
  now: "2026-08-03T16:00:00Z",
  signals: [
    { marketplace: "ebay", identityKey: "card-1", observedAt: "2026-08-03T15:00:00Z", askingPrice: 100, availableQuantity: 2, sellerScore: 95, confidence: 0.9 },
    { marketplace: "mercari", identityKey: "card-1", observedAt: "2026-08-03T15:30:00Z", askingPrice: 70, availableQuantity: 1, sellerScore: 90, confidence: 0.85 },
    { marketplace: "poshmark", identityKey: "card-2", observedAt: "2026-08-03T15:45:00Z", askingPrice: 50, availableQuantity: 1, sellerScore: 80, confidence: 0.7 },
  ],
});
assert.equal(correlated.correlations[0].identityKey, "card-1");
assert.equal(correlated.correlations[0].arbitrageCandidate, true);
assert.deepEqual(correlated.correlations[0].marketplaces, ["ebay", "mercari"]);

const simulation = simulateKingmakerPortfolio({
  availableCapital: 500,
  maxSingleExposurePct: 0.5,
  candidates: [
    { identityKey: "a", cost: 100, expectedSalePrice: 180, fees: 20, shipping: 10, confidence: 0.9, risk: 15, expectedHoldDays: 30 },
    { identityKey: "b", cost: 150, expectedSalePrice: 240, fees: 25, shipping: 10, confidence: 0.8, risk: 20, expectedHoldDays: 45 },
    { identityKey: "c", cost: 300, expectedSalePrice: 500, fees: 60, shipping: 20, confidence: 0.95, risk: 10, expectedHoldDays: 60 },
    { identityKey: "loss", cost: 50, expectedSalePrice: 40, fees: 5, shipping: 5, confidence: 1, risk: 0, expectedHoldDays: 1 },
  ],
});
assert.ok(simulation.selected.length >= 2);
assert.equal(simulation.scenarios.length, 3);
assert.ok(simulation.scenarios.find((value) => value.scenario === "conservative")!.projectedProfit > 0);
assert.ok(simulation.deployedCapital <= 500);
assert.ok(simulation.selected.every((candidate) => candidate.cost <= 250));

const ready = scoreKingmakerReadiness({
  serviceHealth: 95,
  dataFreshness: 94,
  capitalAvailability: 90,
  queuePressure: 20,
  portfolioRisk: 25,
  unresolvedCriticalIncidents: 0,
  authorizationIntegrity: true,
});
assert.equal(ready.score, 88.18);
assert.equal(ready.band, "ready");
assert.equal(ready.reasons.length, 0);

const blocked = scoreKingmakerReadiness({
  serviceHealth: 99,
  dataFreshness: 99,
  capitalAvailability: 99,
  queuePressure: 0,
  portfolioRisk: 0,
  unresolvedCriticalIncidents: 0,
  authorizationIntegrity: false,
});
assert.equal(blocked.band, "blocked");
assert.ok(blocked.reasons.includes("authorization_integrity_failed"));

const explanation = explainKingmakerDecision({
  identityKey: "card-1",
  action: "offer",
  price: 70,
  marketplace: "mercari",
  sellerScore: 90,
  confidence: 0.85,
  expectedRoi: 0.42,
  risk: 18,
  changedSignals: ["price_drop", "supply_tightening", "price_drop"],
  invalidators: ["identity mismatch", "seller cancels"],
});
assert.deepEqual(explanation.whyNow, ["price_drop", "supply_tightening"]);
assert.ok(explanation.whyPrice.includes("42%"));
assert.equal(explanation.fingerprint, explainKingmakerDecision({
  identityKey: "card-1",
  action: "offer",
  price: 70,
  marketplace: "mercari",
  sellerScore: 90,
  confidence: 0.85,
  expectedRoi: 0.42,
  risk: 18,
  changedSignals: ["supply_tightening", "price_drop"],
  invalidators: ["seller cancels", "identity mismatch"],
}).fingerprint);

assert.throws(() => forecastKingmakerMetric({ metric: "x", points: [{ at: "2026-01-01", value: 1 }], horizonPeriods: 1 }), /insufficient_history/);
assert.throws(() => correlateKingmakerMarkets({ now: "2026-08-03T16:00:00Z", signals: [{ marketplace: "", identityKey: "x", observedAt: "2026-08-03T15:00:00Z", askingPrice: 1, availableQuantity: 1, sellerScore: 1, confidence: 1 }] }), /invalid_signal_identity/);
assert.throws(() => simulateKingmakerPortfolio({ availableCapital: -1, candidates: [] }), /invalid_available_capital/);

console.log("KINGMAKER Phase 9 predictive decisioning regressions passed.");
