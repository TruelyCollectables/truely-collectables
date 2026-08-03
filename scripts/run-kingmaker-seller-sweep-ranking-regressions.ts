import assert from "node:assert/strict";
import { rankKingmakerSellerSweep } from "../src/lib/kingmaker-seller-sweep-ranking";

const candidates = [
  { signalFingerprint: "a", entityKey: "card-a", source: "ebay", sellerKey: "trusted", category: "hockey", strategy: "rookie", deliveredCost: 20, expectedProfit: 20, expectedRoiPercent: 100, confidence: 0.9 },
  { signalFingerprint: "b", entityKey: "card-b", source: "ebay", sellerKey: "trusted", category: "hockey", strategy: "rookie", deliveredCost: 25, expectedProfit: 18, expectedRoiPercent: 72, confidence: 0.85 },
  { signalFingerprint: "c", entityKey: "card-c", source: "mercari", sellerKey: "risky", category: "shoes", strategy: "flip", deliveredCost: 30, expectedProfit: 15, expectedRoiPercent: 50, confidence: 0.8 },
];

const ranked = rankKingmakerSellerSweep({
  candidates,
  sellers: [
    { sellerKey: "trusted", source: "ebay", sampleSize: 14, winRate: 0.79, averageRealizedRoiPercent: 48, reliabilityScore: 91, medianDaysToExit: 24, cancellationRate: 0.01, issueRate: 0.02 },
    { sellerKey: "risky", source: "mercari", sampleSize: 12, winRate: 0.33, averageRealizedRoiPercent: -5, reliabilityScore: 28, medianDaysToExit: 80, cancellationRate: 0.25, issueRate: 0.3 },
    { sellerKey: "new", source: "poshmark", sampleSize: 2, winRate: 1, averageRealizedRoiPercent: 100, reliabilityScore: 95, medianDaysToExit: 10 },
  ],
});

assert.equal(ranked[0].sellerKey, "trusted");
assert.equal(ranked[0].tier, "priority");
assert.equal(ranked[0].candidateCount, 2);
assert.equal(ranked.find((seller) => seller.sellerKey === "risky")?.tier, "avoid");
assert.equal(ranked.find((seller) => seller.sellerKey === "new")?.tier, "developing");
assert.equal(ranked.find((seller) => seller.sellerKey === "new")?.maximumExposureMultiplier, 0.5);
assert.equal(ranked[0].fingerprint.length, 64);

console.log("KINGMAKER seller sweep ranking regressions passed.");
