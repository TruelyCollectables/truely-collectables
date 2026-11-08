import assert from "node:assert/strict";
import {
  buildKingmakerCommandCenterReadModel,
  paginateKingmakerDecisions,
  validateKingmakerOwnerAction,
  type KingmakerCommandCenterDecision,
} from "../src/lib/kingmaker-phase-5-command-center";

const base: KingmakerCommandCenterDecision = {
  entityKey: "hockey:2025:upper-deck:ivan-demidov:young-guns:201:base:raw",
  source: "ebay",
  sourceRecordId: "listing-1",
  sourceUrl: "https://www.ebay.com/itm/1",
  observedAt: "2026-08-03T11:45:00Z",
  action: "buy_now",
  deliveredCost: 25,
  expectedProfit: 25,
  expectedRoiPercent: 100,
  recommendedOffer: null,
  walkAwayPrice: null,
  confidence: 0.92,
  riskScore: 10,
  reasons: ["verified_high_conviction_opportunity"],
  fingerprint: "a".repeat(64),
  age: "hot",
  executionPriority: 140,
  sellerReliability: 94,
  momentumScore: 25,
  authorizationStatus: "pending",
  lifecycleStatus: "proposed",
};

const offer: KingmakerCommandCenterDecision = {
  ...base,
  source: "mercari",
  sourceRecordId: "listing-2",
  action: "make_offer",
  deliveredCost: 40,
  expectedProfit: 15,
  expectedRoiPercent: 37.5,
  recommendedOffer: 30,
  walkAwayPrice: 34,
  fingerprint: "b".repeat(64),
  executionPriority: 110,
};

const watch: KingmakerCommandCenterDecision = {
  ...base,
  sourceRecordId: "listing-3",
  action: "watch",
  fingerprint: "c".repeat(64),
  executionPriority: 70,
  authorizationStatus: "not_required",
};

const model = buildKingmakerCommandCenterReadModel({
  generatedAt: "2026-08-03T12:00:00Z",
  decisions: [watch, offer, base],
  sourceHealth: [
    { source: "ebay", accepted: 2, rejected: 0, lastObservedAt: "2026-08-03T11:45:00Z", status: "healthy" },
    { source: "mercari", accepted: 1, rejected: 2, lastObservedAt: "2026-08-03T11:40:00Z", status: "degraded" },
  ],
});

assert.equal(model.totals.all, 3);
assert.equal(model.totals.buyNow, 1);
assert.equal(model.totals.offers, 1);
assert.equal(model.totals.authorizationPending, 2);
assert.equal(model.morningIntelligence.urgent.length, 2);
assert.ok(model.morningIntelligence.warnings.includes("owner_actions_pending"));
assert.ok(model.morningIntelligence.warnings.includes("one_or_more_sources_degraded"));
assert.equal(model.api.etag, model.fingerprint);

const firstPage = paginateKingmakerDecisions({ decisions: [watch, offer, base], limit: 2 });
assert.deepEqual(firstPage.items.map((item) => item.fingerprint), [base.fingerprint, offer.fingerprint]);
assert.equal(firstPage.nextCursor, offer.fingerprint);
const secondPage = paginateKingmakerDecisions({ decisions: [watch, offer, base], cursor: firstPage.nextCursor, limit: 2 });
assert.deepEqual(secondPage.items.map((item) => item.fingerprint), [watch.fingerprint]);
assert.equal(secondPage.nextCursor, null);

const approvedBuy = validateKingmakerOwnerAction({
  decisionFingerprint: base.fingerprint,
  action: "approve",
  ownerId: "owner-1",
  amount: 25,
  requestedAt: "2026-08-03T12:00:00Z",
  idempotencyKey: "approve-buy-1",
}, base);
assert.equal(approvedBuy.accepted, true);

const wrongBuyAmount = validateKingmakerOwnerAction({
  decisionFingerprint: base.fingerprint,
  action: "approve",
  ownerId: "owner-1",
  amount: 24,
  requestedAt: "2026-08-03T12:00:00Z",
  idempotencyKey: "approve-buy-2",
}, base);
assert.equal(wrongBuyAmount.accepted, false);
assert.ok(wrongBuyAmount.errors.includes("buy_amount_mismatch"));

const approvedOffer = validateKingmakerOwnerAction({
  decisionFingerprint: offer.fingerprint,
  action: "approve",
  ownerId: "owner-1",
  amount: 30,
  requestedAt: "2026-08-03T12:00:00Z",
  idempotencyKey: "approve-offer-1",
}, offer);
assert.equal(approvedOffer.accepted, true);

const dead = { ...base, age: "dead" as const };
assert.equal(validateKingmakerOwnerAction({
  decisionFingerprint: dead.fingerprint,
  action: "approve",
  ownerId: "owner-1",
  amount: 25,
  requestedAt: "2026-08-03T12:00:00Z",
  idempotencyKey: "approve-dead-1",
}, dead).accepted, false);

assert.equal(buildKingmakerCommandCenterReadModel({
  generatedAt: "2026-08-03T12:00:00Z",
  decisions: [watch, offer, base],
  sourceHealth: [
    { source: "ebay", accepted: 2, rejected: 0, lastObservedAt: "2026-08-03T11:45:00Z", status: "healthy" },
    { source: "mercari", accepted: 1, rejected: 2, lastObservedAt: "2026-08-03T11:40:00Z", status: "degraded" },
  ],
}).fingerprint, model.fingerprint);

console.log("KINGMAKER Phase 5 Command Center regressions passed.");
