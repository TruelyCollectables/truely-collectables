import assert from "node:assert/strict";
import { evaluateKingmakerLiveObservation, runKingmakerPhase5LiveExecution } from "../src/lib/kingmaker-phase-5-live-execution";

const buy = evaluateKingmakerLiveObservation({
  source: "ebay",
  sourceRecordId: "ebay-1",
  entityKey: "hockey:demidov:young-guns:201:raw",
  observedAt: "2026-08-03T05:10:00Z",
  askingPrice: 20,
  shipping: 4,
  fees: 1,
  marketValue: 50,
  confidence: 0.91,
  sellerReliability: 93,
  riskScore: 12,
  momentumScore: 24,
  sourceUrl: "https://example.com/item/1",
});
assert.equal(buy.action, "buy_now");
assert.equal(buy.expectedProfit, 25);
assert.equal(buy.fingerprint.length, 64);

const offer = evaluateKingmakerLiveObservation({
  source: "mercari",
  sourceRecordId: "mercari-1",
  entityKey: "hockey:demidov:canvas:raw",
  observedAt: "2026-08-03T05:11:00Z",
  askingPrice: 31,
  shipping: 4,
  fees: 1,
  marketValue: 49,
  confidence: 0.74,
  sellerReliability: 71,
  riskScore: 20,
  momentumScore: 5,
});
assert.equal(offer.action, "make_offer");
assert.ok((offer.recommendedOffer ?? 0) < 31);
assert.ok((offer.walkAwayPrice ?? 0) >= (offer.recommendedOffer ?? 0));

const rejected = evaluateKingmakerLiveObservation({
  source: "poshmark",
  sourceRecordId: "posh-1",
  entityKey: "shoe:new-balance:990",
  observedAt: "2026-08-03T05:12:00Z",
  askingPrice: 20,
  shipping: 8,
  fees: 2,
  marketValue: 80,
  confidence: 0.95,
  sellerReliability: 95,
  riskScore: 90,
  momentumScore: 30,
});
assert.equal(rejected.action, "reject");
assert.ok(rejected.reasons.includes("risk_above_tolerance"));

const snapshot = runKingmakerPhase5LiveExecution({
  generatedAt: "2026-08-03T05:15:00Z",
  availableCapital: 1000,
  reservePercent: 0.2,
  observations: [
    {
      source: "ebay",
      sourceRecordId: "ebay-1",
      entityKey: "hockey:demidov:young-guns:201:raw",
      observedAt: "2026-08-03T05:10:00Z",
      askingPrice: 20,
      shipping: 4,
      fees: 1,
      marketValue: 50,
      confidence: 0.91,
      sellerReliability: 93,
      riskScore: 12,
      momentumScore: 24,
    },
    {
      source: "mercari",
      sourceRecordId: "mercari-1",
      entityKey: "hockey:demidov:canvas:raw",
      observedAt: "2026-08-03T05:11:00Z",
      askingPrice: 31,
      shipping: 4,
      fees: 1,
      marketValue: 49,
      confidence: 0.74,
      sellerReliability: 71,
      riskScore: 20,
      momentumScore: 5,
    },
  ],
  offlineSources: ["comc"],
});

assert.equal(snapshot.deployableCapital, 800);
assert.equal(snapshot.buyQueue.length, 1);
assert.equal(snapshot.offerQueue.length, 1);
assert.equal(snapshot.morningIntelligence.topActions.length, 2);
assert.ok(snapshot.morningIntelligence.warnings.includes("one_or_more_sources_offline"));
assert.equal(snapshot.tcosApi.version, "v1");
assert.equal(snapshot.tcosApi.snapshotFingerprint, snapshot.fingerprint);
assert.equal(snapshot.fingerprint.length, 64);

console.log("KINGMAKER Phase 5 live execution regressions passed.");
