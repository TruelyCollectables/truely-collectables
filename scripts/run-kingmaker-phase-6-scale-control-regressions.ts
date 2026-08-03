import assert from "node:assert/strict";
import {
  allocateKingmakerWorkerCapacity,
  buildKingmakerAuditReplay,
  evaluateKingmakerScaleReadiness,
  routeKingmakerPhase6Alerts,
  validateKingmakerTenantPolicy,
  type KingmakerScaleDecision,
  type KingmakerTenantPolicy,
} from "../src/lib/kingmaker-phase-6-scale-control";

const policy: KingmakerTenantPolicy = {
  tenantId: "truely-collectables",
  plan: "owner",
  enabledSources: ["ebay", "mercari", "ebay"],
  dailyScanLimit: 10000,
  hourlyActionLimit: 100,
  maximumSingleDeployment: 500,
  maximumDailyDeployment: 2500,
  minimumConfidence: 0.75,
  maximumRisk: 40,
  requireOwnerApproval: true,
  alertChannels: ["command_center", "push", "email"],
};

const validated = validateKingmakerTenantPolicy(policy);
assert.equal(validated.accepted, true);
assert.deepEqual(validated.normalized.enabledSources, ["ebay", "mercari"]);
assert.equal(validated.fingerprint.length, 64);

const decision: KingmakerScaleDecision = {
  fingerprint: "decision-1",
  tenantId: policy.tenantId,
  source: "ebay",
  entityKey: "hockey:demidov:young-guns",
  action: "deploy",
  amount: 125,
  confidence: 0.91,
  riskScore: 18,
  expectedProfit: 80,
  expectedRoiPercent: 64,
  observedAt: "2026-08-03T13:00:00Z",
  expiresAt: "2026-08-03T15:00:00Z",
};

const readiness = evaluateKingmakerScaleReadiness({
  policy,
  usage: { scansToday: 500, actionsThisHour: 4, deployedToday: 300, activeDeployments: 7 },
  decision,
  now: "2026-08-03T14:00:00Z",
});
assert.equal(readiness.verdict, "approval_required");
assert.equal(readiness.reasons.length, 0);

const blocked = evaluateKingmakerScaleReadiness({
  policy,
  usage: { scansToday: 500, actionsThisHour: 4, deployedToday: 2400, activeDeployments: 7 },
  decision: { ...decision, riskScore: 90 },
  now: "2026-08-03T14:00:00Z",
});
assert.equal(blocked.verdict, "blocked");
assert.ok(blocked.reasons.includes("risk_above_policy"));
assert.ok(blocked.reasons.includes("daily_deployment_limit_exceeded"));

const throttled = evaluateKingmakerScaleReadiness({
  policy,
  usage: { scansToday: 10000, actionsThisHour: 100, deployedToday: 0, activeDeployments: 0 },
  decision: { ...decision, action: "watch", amount: 0 },
  now: "2026-08-03T14:00:00Z",
});
assert.equal(throttled.verdict, "throttled");

const expired = evaluateKingmakerScaleReadiness({
  policy,
  usage: { scansToday: 0, actionsThisHour: 0, deployedToday: 0, activeDeployments: 0 },
  decision,
  now: "2026-08-03T16:00:00Z",
});
assert.equal(expired.verdict, "expired");

const alert = routeKingmakerPhase6Alerts({ policy, verdict: readiness.verdict, decision });
assert.equal(alert.severity, "action");
assert.ok(alert.channels.includes("push"));

const replay = buildKingmakerAuditReplay({
  tenantId: policy.tenantId,
  decision,
  evidenceFingerprints: ["e2", "e1", "e1"],
  policyFingerprint: validated.fingerprint,
  readinessFingerprint: readiness.fingerprint,
  actionFingerprints: ["a1"],
});
assert.deepEqual(replay.evidenceFingerprints, ["e1", "e2"]);
assert.equal(replay.fingerprint.length, 64);

const capacity = allocateKingmakerWorkerCapacity({
  workers: 2,
  tenants: [
    { tenantId: "owner", priority: 10, backlog: 20, plan: "owner" },
    { tenantId: "enterprise", priority: 9, backlog: 100, plan: "enterprise" },
    { tenantId: "pro", priority: 1, backlog: 5, plan: "pro" },
  ],
});
assert.equal(capacity.assignments.length, 2);
assert.equal(capacity.assignments[0].tenantId, "enterprise");
assert.deepEqual(capacity.unassigned, ["pro"]);
assert.equal(capacity.fingerprint.length, 64);

assert.throws(() => allocateKingmakerWorkerCapacity({ workers: 0, tenants: [] }), /invalid_worker_count/);
console.log("KINGMAKER Phase 6 scale control regressions passed.");
