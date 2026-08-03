import assert from "node:assert/strict";
import { buildKingmakerPersistencePlan, normalizeKingmakerEbayBrowseItem } from "../src/lib/kingmaker-phase-5-persistence-bridge";
import type { KingmakerCommandCenterDecision } from "../src/lib/kingmaker-phase-5-command-center";

const normalized = normalizeKingmakerEbayBrowseItem({
  item: {
    itemId: "v1|123|0",
    title: "2025 Upper Deck Ivan Demidov Young Guns",
    itemWebUrl: "https://www.ebay.com/itm/123",
    price: { value: "20.00", currency: "USD" },
    shippingOptions: [{ shippingCost: { value: "4.25" } }],
    seller: { username: "seller", feedbackPercentage: "98.7" },
    itemCreationDate: "2026-08-03T12:00:00Z",
  },
  entityKey: "hockey:2025:upper-deck:ivan-demidov:young-guns:201:base:raw",
  marketValue: 50,
  confidence: 0.91,
  riskScore: 12,
  momentumScore: 20,
});
assert.equal(normalized.accepted, true);
assert.equal(normalized.observation?.askingPrice, 20);
assert.equal(normalized.observation?.shipping, 4.25);
assert.equal(normalized.observation?.sellerReliability, 98.7);

const rejected = normalizeKingmakerEbayBrowseItem({
  item: {
    itemId: "123",
    itemWebUrl: "javascript:alert(1)",
    price: { value: "20", currency: "CAD" },
    itemCreationDate: "bad",
  },
  entityKey: "card",
  marketValue: 50,
  confidence: 0.9,
  riskScore: 10,
  momentumScore: 5,
});
assert.equal(rejected.accepted, false);
assert.ok(rejected.errors.includes("unsupported_currency"));
assert.ok(rejected.errors.includes("unsafe_ebay_url"));

const decision: KingmakerCommandCenterDecision = {
  entityKey: "card",
  source: "ebay",
  action: "buy_now",
  deliveredCost: 24.25,
  expectedProfit: 25.75,
  expectedRoiPercent: 106.19,
  recommendedOffer: null,
  walkAwayPrice: null,
  confidence: 0.91,
  riskScore: 12,
  reasons: ["verified_high_conviction_opportunity"],
  fingerprint: "decision-fingerprint",
  sourceRecordId: "v1|123|0",
  sourceUrl: "https://www.ebay.com/itm/123",
  observedAt: "2026-08-03T12:00:00Z",
  age: "hot",
  executionPriority: 140,
  sellerReliability: 98.7,
  momentumScore: 20,
  authorizationStatus: "pending",
  lifecycleStatus: "proposed",
};

const adapterRun = {
  source: "ebay" as const,
  startedAt: "2026-08-03T12:00:00Z",
  completedAt: "2026-08-03T12:00:02Z",
  scanned: 10,
  observations: normalized.observation ? [normalized.observation] : [],
  rejected: 2,
  retries: 0,
  rateLimited: false,
};

const event = {
  type: "decision_created" as const,
  source: "ebay" as const,
  occurredAt: "2026-08-03T12:00:02Z",
  decisionFingerprint: decision.fingerprint,
  metadata: { action: "buy_now", priority: 140 },
  fingerprint: "event-fingerprint",
};

const plan = buildKingmakerPersistencePlan({
  generatedAt: "2026-08-03T12:00:02Z",
  cycleFingerprint: "cycle-fingerprint",
  snapshot: { version: "v1" },
  decisions: [decision],
  adapterRuns: [adapterRun],
  events: [event],
  ownerActions: [{
    decisionFingerprint: decision.fingerprint,
    action: "approve",
    ownerId: "owner-1",
    amount: 24.25,
    requestedAt: "2026-08-03T12:00:03Z",
    idempotencyKey: "owner-1:decision-fingerprint:approve",
  }],
});

assert.equal(plan.operations.length, 4);
assert.equal(plan.decisionCount, 1);
assert.equal(plan.adapterRunCount, 1);
assert.equal(plan.ownerActionCount, 1);
assert.equal(plan.operations[0].table, "tcos_kingmaker_live_cycles");
assert.equal(plan.operations[1].mode, "upsert");
assert.equal(plan.operations[2].row.status, "healthy");
assert.equal(plan.operations[3].conflictTarget, "idempotency_key");
assert.equal(plan.fingerprint.length, 64);
assert.equal(new Set(plan.operations.map((entry) => entry.fingerprint)).size, plan.operations.length);

assert.throws(() => buildKingmakerPersistencePlan({
  generatedAt: "bad",
  cycleFingerprint: "cycle",
  snapshot: {},
  decisions: [],
  adapterRuns: [],
  events: [],
}), /invalid_generated_at/);

console.log("KINGMAKER Phase 5 persistence bridge regressions passed.");
