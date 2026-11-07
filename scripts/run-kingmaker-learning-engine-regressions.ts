import assert from "node:assert/strict";
import { evaluateKingmakerOutcome, summarizeKingmakerLearning } from "../src/lib/kingmaker-learning-engine";

const win = evaluateKingmakerOutcome({
  signalFingerprint: "signal-win",
  entityKey: "hockey:demidov",
  decision: "buy",
  decidedAt: "2026-08-01T12:00:00.000Z",
  predictedProfit: 20,
  predictedRoiPercent: 50,
  predictedConfidence: 0.9,
  landedCost: 40,
  soldAmount: 70,
  soldAt: "2026-08-11T12:00:00.000Z",
});
assert.equal(win.state, "won");
assert.equal(win.realizedProfit, 30);
assert.equal(win.realizedRoiPercent, 75);
assert.equal(win.predictionErrorProfit, 10);
assert.equal(win.predictionErrorRoiPercent, 25);
assert.equal(win.daysToExit, 10);

const loss = evaluateKingmakerOutcome({
  signalFingerprint: "signal-loss",
  entityKey: "baseball:test",
  decision: "offer",
  decidedAt: "2026-08-01T12:00:00.000Z",
  predictedProfit: 12,
  predictedRoiPercent: 40,
  paidAmount: 30,
  soldAmount: 24,
  soldAt: "2026-08-06T12:00:00.000Z",
});
assert.equal(loss.state, "lost");
assert.equal(loss.realizedProfit, -6);
assert.equal(loss.realizedRoiPercent, -20);

const watched = evaluateKingmakerOutcome({
  signalFingerprint: "signal-watch",
  entityKey: "hockey:watch",
  decision: "watch",
  decidedAt: "2026-08-01T12:00:00.000Z",
});
assert.equal(watched.state, "non_purchase");
assert.equal(watched.realizedProfit, null);

const open = evaluateKingmakerOutcome({
  signalFingerprint: "signal-open",
  entityKey: "hockey:open",
  decision: "buy",
  decidedAt: "2026-08-01T12:00:00.000Z",
  landedCost: 25,
});
assert.equal(open.state, "open");

const summary = summarizeKingmakerLearning([win, loss, watched, open]);
assert.equal(summary.closedCount, 2);
assert.equal(summary.winRate, 0.5);
assert.equal(summary.averageRealizedRoiPercent, 27.5);
assert.equal(summary.averageProfitPredictionError, -4);
assert.equal(win.outcomeFingerprint.length, 64);

console.log("KINGMAKER learning engine regressions passed.");
