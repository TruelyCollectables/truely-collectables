import assert from "node:assert/strict";
import { bridgePurchaseLedgerToKingmaker } from "../src/lib/kingmaker-purchase-ledger-bridge";
import { detectKingmakerMeaningfulChanges, type KingmakerSignalSnapshot } from "../src/lib/kingmaker-meaningful-changes";
import { buildKingmakerCommandCenter } from "../src/lib/kingmaker-command-center";

const previous: KingmakerSignalSnapshot[] = [{
  entityKey: "hockey:2025:upper deck:ivan demidov:young guns:201:base:raw",
  signalFingerprint: "old",
  status: "verified",
  score: 72,
  confidence: 0.7,
  expectedProfit: 12,
  roiPercent: 40,
  deliveredCost: 30,
  marketValue: 42,
  sellerKey: "seller-a",
  sourceDiversity: 2,
  observedAt: "2026-08-02T12:00:00.000Z",
}];
const current: KingmakerSignalSnapshot[] = [{
  entityKey: previous[0].entityKey,
  signalFingerprint: "new",
  status: "verified",
  score: 91,
  confidence: 0.88,
  expectedProfit: 25,
  roiPercent: 125,
  deliveredCost: 20,
  marketValue: 45,
  sellerKey: "seller-b",
  sourceDiversity: 3,
  observedAt: "2026-08-03T12:00:00.000Z",
}];

const changes = detectKingmakerMeaningfulChanges({ previous, current });
assert.ok(changes.some((item) => item.type === "price_drop"));
assert.ok(changes.some((item) => item.type === "confidence_gain"));
assert.ok(changes.some((item) => item.type === "profit_gain"));
assert.ok(changes.some((item) => item.type === "seller_change"));
assert.equal(new Set(changes.map((item) => item.fingerprint)).size, changes.length);

const ledger = bridgePurchaseLedgerToKingmaker([
  {
    purchaseId: "purchase-1",
    signalFingerprint: "signal-1",
    entityKey: previous[0].entityKey,
    purchasedAt: "2026-08-01T12:00:00.000Z",
    marketplace: "eBay",
    sellerKey: "seller-a",
    strategy: "rookie-value",
    askingPrice: 30,
    offerAmount: 20,
    itemPrice: 20,
    shipping: 4,
    tax: 2,
    fees: 1,
    quantity: 1,
    predictedProfit: 15,
    predictedRoiPercent: 55,
    predictedConfidence: 0.8,
    soldAmount: 45,
    soldAt: "2026-08-10T12:00:00.000Z",
  },
  {
    purchaseId: "purchase-1",
    signalFingerprint: "signal-duplicate",
    entityKey: previous[0].entityKey,
    purchasedAt: "2026-08-01T12:00:00.000Z",
    marketplace: "eBay",
    itemPrice: 1,
    shipping: 0,
    tax: 0,
    fees: 0,
  },
]);
assert.equal(ledger.accepted.length, 1);
assert.equal(ledger.rejected[0].code, "duplicate_purchase_id");
assert.equal(ledger.accepted[0].landedCost, 27);
assert.equal(ledger.totalLandedCost, 27);

const commandCenter = buildKingmakerCommandCenter({
  generatedAt: "2026-08-03T13:00:00.000Z",
  availableCapital: 1000,
  reservedCapital: 200,
  deployedCapital: 900,
  verifiedSignals: current,
  meaningfulChanges: changes,
  sellerRanks: [
    { sellerKey: "seller-b", score: 92, tier: "priority", actionableCount: 4 },
    { sellerKey: "seller-bad", score: 20, tier: "avoid", actionableCount: 10 },
  ],
  performance: {
    closedCount: 10,
    winRate: 0.4,
    averageRealizedRoiPercent: 18,
    averageProfitPredictionError: -12,
  },
  sourceHealth: [
    { source: "ebay", accepted: 10, rejected: 1, lastSuccessfulAt: "2026-08-03T12:00:00.000Z" },
    { source: "mercari", accepted: 0, rejected: 5, lastSuccessfulAt: null },
    { source: "poshmark", accepted: 0, rejected: 0, lastSuccessfulAt: null },
  ],
});
assert.equal(commandCenter.opportunityQueue.length, 1);
assert.equal(commandCenter.sellerLeaders.length, 1);
assert.ok(commandCenter.riskFlags.includes("capital_utilization_high"));
assert.ok(commandCenter.riskFlags.includes("win_rate_below_tolerance"));
assert.ok(commandCenter.riskFlags.includes("profit_predictions_overstated"));
assert.ok(commandCenter.riskFlags.includes("source_coverage_degraded"));
assert.equal(commandCenter.capital.deployable, 800);
assert.equal(commandCenter.sourceCoverage, 0.3333);

console.log("KINGMAKER Phase 4 integration regressions passed.");
