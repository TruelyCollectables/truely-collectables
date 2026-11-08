import assert from "node:assert/strict";
import {
  buildKingmakerDeadLetter,
  buildKingmakerIncident,
  evaluateKingmakerRelease,
  evaluateKingmakerServiceWindow,
  reconcileKingmakerLedger,
  transitionKingmakerCircuit,
  type KingmakerSloPolicy,
} from "../src/lib/kingmaker-phase-7-resilience-control";

const policy: KingmakerSloPolicy = {
  availabilityTarget: 0.995,
  maxP95LatencyMs: 2_000,
  maxErrorRate: 0.01,
  maxDataLagSeconds: 300,
  maxReconciliationDrift: 0.05,
};

const healthy = evaluateKingmakerServiceWindow({
  policy,
  window: {
    service: "ebay-adapter",
    requests: 1_000,
    errors: 2,
    successful: 998,
    p95LatencyMs: 600,
    dataLagSeconds: 20,
    startedAt: "2026-08-03T14:00:00Z",
    endedAt: "2026-08-03T14:05:00Z",
  },
});
assert.equal(healthy.state, "healthy");
assert.equal(healthy.breaches.length, 0);

const open = evaluateKingmakerServiceWindow({
  policy,
  window: {
    service: "mercari-adapter",
    requests: 100,
    errors: 12,
    successful: 88,
    p95LatencyMs: 8_000,
    dataLagSeconds: 1_200,
    startedAt: "2026-08-03T14:00:00Z",
    endedAt: "2026-08-03T14:05:00Z",
  },
});
assert.equal(open.state, "open");
assert.ok(open.breaches.includes("availability"));
assert.ok(open.breaches.includes("error_rate"));

let circuit = transitionKingmakerCircuit({ service: "mercari-adapter", now: "2026-08-03T14:00:00Z", success: false, failureThreshold: 3 });
assert.equal(circuit.state, "degraded");
circuit = transitionKingmakerCircuit({ previous: circuit, service: "mercari-adapter", now: "2026-08-03T14:00:01Z", success: false, failureThreshold: 3 });
circuit = transitionKingmakerCircuit({ previous: circuit, service: "mercari-adapter", now: "2026-08-03T14:00:02Z", success: false, failureThreshold: 3 });
assert.equal(circuit.state, "open");
assert.ok(circuit.nextProbeAt);
circuit = transitionKingmakerCircuit({ previous: circuit, service: "mercari-adapter", now: "2026-08-03T14:06:00Z", success: true, failureThreshold: 3 });
assert.equal(circuit.state, "healthy");
assert.equal(circuit.consecutiveFailures, 0);

const retry = buildKingmakerDeadLetter({
  queue: "source-ingestion",
  messageId: "msg-1",
  tenantId: "owner",
  attempts: 2,
  reason: "adapter_timeout",
  payload: { item: 1 },
  failedAt: "2026-08-03T14:00:00Z",
});
assert.equal(retry.nextAction, "retry");
const quarantine = buildKingmakerDeadLetter({ ...retry, attempts: 5, payload: { item: 1 } });
assert.equal(quarantine.nextAction, "quarantine");
const manual = buildKingmakerDeadLetter({ ...retry, reason: "authorization_signature_mismatch", payload: { item: 1 } });
assert.equal(manual.nextAction, "manual_review");

const clean = reconcileKingmakerLedger({ ledger: "live-decisions", expectedIds: ["a", "b"], actualIds: ["b", "a"], policy });
assert.equal(clean.status, "clean");
const drift = reconcileKingmakerLedger({ ledger: "owner-actions", expectedIds: ["a", "b", "c"], actualIds: ["a", "x"], policy });
assert.equal(drift.status, "critical");
assert.deepEqual(drift.missingIds, ["b", "c"]);
assert.deepEqual(drift.unexpectedIds, ["x"]);

const authIncident = buildKingmakerIncident({ service: "action-control", now: "2026-08-03T14:00:00Z", serviceState: "healthy", authorizationFailure: true });
assert.equal(authIncident?.severity, "critical");
assert.equal(authIncident?.automaticAction, "open_circuit");
assert.equal(buildKingmakerIncident({ service: "ebay", now: "2026-08-03T14:00:00Z", serviceState: "healthy" }), null);

const promote = evaluateKingmakerRelease({
  candidateSha: "abcdef1234567",
  currentSha: "1234567abcdef",
  serviceEvaluations: [healthy],
  reconciliations: [clean],
  criticalIncidents: 0,
  migrationVerified: true,
  authorizationVerified: true,
  regressionSuitesPassed: 20,
});
assert.equal(promote.verdict, "promote");
const rollback = evaluateKingmakerRelease({
  candidateSha: "abcdef1234567",
  currentSha: "1234567abcdef",
  serviceEvaluations: [healthy, open],
  reconciliations: [drift],
  criticalIncidents: 1,
  migrationVerified: true,
  authorizationVerified: false,
  regressionSuitesPassed: 20,
});
assert.equal(rollback.verdict, "rollback");
assert.ok(rollback.reasons.includes("authorization_not_verified"));

assert.equal(
  evaluateKingmakerRelease({
    candidateSha: "abcdef1234567",
    currentSha: "1234567abcdef",
    serviceEvaluations: [healthy],
    reconciliations: [clean],
    criticalIncidents: 0,
    migrationVerified: true,
    authorizationVerified: true,
    regressionSuitesPassed: 20,
  }).fingerprint,
  promote.fingerprint,
);

assert.throws(() => evaluateKingmakerServiceWindow({
  policy,
  window: { service: "bad", requests: 10, errors: 2, successful: 9, p95LatencyMs: 1, dataLagSeconds: 0, startedAt: "2026-08-03T14:00:00Z", endedAt: "2026-08-03T14:01:00Z" },
}), /inconsistent_request_counts/);

console.log("KINGMAKER Phase 7 resilience control regressions passed.");
