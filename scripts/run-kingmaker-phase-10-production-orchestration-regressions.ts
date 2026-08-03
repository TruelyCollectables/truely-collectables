import assert from "node:assert/strict";
import {
  evaluateKingmakerExecutionAttempt,
  planKingmakerAdapterFleet,
  reconcileKingmakerPredictionOutcomes,
  reserveKingmakerCapital,
} from "../src/lib/kingmaker-phase-10-production-orchestration";

const fleet = planKingmakerAdapterFleet({
  workerSlots: 2,
  tasks: [
    { marketplace: "ebay", tenantId: "owner", priority: 95, attempts: 0, maxAttempts: 3, timeoutMs: 10_000, rateLimitRemaining: 500, circuitOpen: false },
    { marketplace: "mercari", tenantId: "owner", priority: 90, attempts: 1, maxAttempts: 3, timeoutMs: 10_000, rateLimitRemaining: 100, circuitOpen: false },
    { marketplace: "poshmark", tenantId: "owner", priority: 100, attempts: 0, maxAttempts: 3, timeoutMs: 10_000, rateLimitRemaining: 0, circuitOpen: false },
  ],
});
assert.deepEqual(fleet.scheduled.map((task) => task.marketplace), ["ebay", "mercari"]);
assert.equal(fleet.deferred[0].blocked, true);
assert.equal(fleet.fingerprint, planKingmakerAdapterFleet({
  workerSlots: 2,
  tasks: [
    { marketplace: "poshmark", tenantId: "owner", priority: 100, attempts: 0, maxAttempts: 3, timeoutMs: 10_000, rateLimitRemaining: 0, circuitOpen: false },
    { marketplace: "mercari", tenantId: "owner", priority: 90, attempts: 1, maxAttempts: 3, timeoutMs: 10_000, rateLimitRemaining: 100, circuitOpen: false },
    { marketplace: "ebay", tenantId: "owner", priority: 95, attempts: 0, maxAttempts: 3, timeoutMs: 10_000, rateLimitRemaining: 500, circuitOpen: false },
  ],
}).fingerprint);

const reservation = reserveKingmakerCapital({
  candidate: {
    decisionFingerprint: "decision-1",
    tenantId: "owner",
    marketplace: "ebay",
    amount: 125,
    confidence: 0.92,
    risk: 15,
    expectedProfit: 55,
    authorizationVerified: true,
    ownerApprovalRequired: true,
  },
  availableCapital: 500,
  alreadyReserved: 50,
  dailyDeployed: 100,
  maxDailyDeployment: 400,
  maxSingleExposure: 200,
});
assert.equal(reservation.verdict, "approval_required");
assert.equal(reservation.reservationState, "reserved");
assert.equal(reservation.freeCapitalAfter, 325);

const blocked = reserveKingmakerCapital({
  candidate: {
    decisionFingerprint: "decision-2",
    tenantId: "owner",
    marketplace: "mercari",
    amount: 250,
    confidence: 0.6,
    risk: 80,
    expectedProfit: -5,
    authorizationVerified: false,
    ownerApprovalRequired: false,
  },
  availableCapital: 500,
  alreadyReserved: 300,
  dailyDeployed: 300,
  maxDailyDeployment: 400,
  maxSingleExposure: 200,
});
assert.equal(blocked.verdict, "blocked");
assert.ok(blocked.reasons.includes("authorization_unverified"));
assert.ok(blocked.reasons.includes("single_exposure_exceeded"));
assert.ok(blocked.reasons.includes("insufficient_free_capital"));

const executable = evaluateKingmakerExecutionAttempt({
  adapterState: "ready",
  reservationState: "reserved",
  authorizationVerified: true,
  idempotencySeen: false,
  circuitOpen: false,
  rateLimitRemaining: 10,
});
assert.equal(executable.verdict, "execute");
assert.deepEqual(executable.reasons, []);

const throttled = evaluateKingmakerExecutionAttempt({
  adapterState: "ready",
  reservationState: "reserved",
  authorizationVerified: true,
  idempotencySeen: false,
  circuitOpen: false,
  rateLimitRemaining: 0,
});
assert.equal(throttled.verdict, "throttled");
assert.ok(throttled.reasons.includes("rate_limited"));

const outcomes = reconcileKingmakerPredictionOutcomes({
  outcomes: [
    { decisionFingerprint: "b", predictedProfit: 40, realizedProfit: 30, predictedHoldDays: 20, realizedHoldDays: 25 },
    { decisionFingerprint: "a", predictedProfit: 50, realizedProfit: -10, predictedHoldDays: 30, realizedHoldDays: 40 },
  ],
});
assert.equal(outcomes.count, 2);
assert.equal(outcomes.meanAbsoluteProfitError, 35);
assert.equal(outcomes.meanAbsoluteHoldErrorDays, 7.5);
assert.equal(outcomes.profitableDirectionAccuracy, 0.5);
assert.deepEqual(outcomes.outcomes.map((value) => value.decisionFingerprint), ["a", "b"]);

assert.throws(() => planKingmakerAdapterFleet({ workerSlots: 0, tasks: [] }), /invalid_worker_slots/);
assert.throws(() => reserveKingmakerCapital({
  candidate: { decisionFingerprint: "x", tenantId: "owner", marketplace: "ebay", amount: 0, confidence: 1, risk: 0, expectedProfit: 1, authorizationVerified: true, ownerApprovalRequired: false },
  availableCapital: 1,
  alreadyReserved: 0,
  dailyDeployed: 0,
  maxDailyDeployment: 1,
  maxSingleExposure: 1,
}), /invalid_candidate_amount/);

console.log("KINGMAKER Phase 10 production orchestration regressions passed.");
