import assert from "node:assert/strict";
import {
  assessKingmakerOperations,
  buildKingmakerExecutiveHealth,
  buildKingmakerRunbook,
  forecastKingmakerCapacity,
  validateKingmakerDependencyGraph,
  type KingmakerDependency,
  type KingmakerServiceSignal,
} from "../src/lib/kingmaker-phase-8-operational-intelligence";

const dependencies: KingmakerDependency[] = [
  { service: "identity", dependsOn: [], criticality: "critical", owner: "kingmaker" },
  { service: "truth", dependsOn: ["identity"], criticality: "critical", owner: "kingmaker" },
  { service: "decision", dependsOn: ["truth"], criticality: "critical", owner: "kingmaker" },
  { service: "command-center", dependsOn: ["decision"], criticality: "high", owner: "operations" },
];

const graph = validateKingmakerDependencyGraph(dependencies);
assert.equal(graph.dependencies.length, 4);
assert.equal(graph.fingerprint.length, 64);
assert.throws(() => validateKingmakerDependencyGraph([{ service: "a", dependsOn: ["a"], criticality: "low", owner: "x" }]), /self_dependency/);
assert.throws(() => validateKingmakerDependencyGraph([
  { service: "a", dependsOn: ["b"], criticality: "low", owner: "x" },
  { service: "b", dependsOn: ["a"], criticality: "low", owner: "x" },
]), /dependency_cycle/);

const healthySignals: KingmakerServiceSignal[] = dependencies.map((dependency) => ({
  service: dependency.service,
  state: "healthy",
  errorRate: 0,
  p95LatencyMs: 200,
  dataLagSeconds: 5,
  observedAt: "2026-08-03T15:00:00Z",
}));
const healthy = assessKingmakerOperations({ dependencies, signals: healthySignals, now: "2026-08-03T15:00:00Z" });
assert.ok(healthy.every((value) => value.state === "healthy"));

const identityOpen = healthySignals.map((signal) => signal.service === "identity" ? { ...signal, state: "open" as const, errorRate: 0.8 } : signal);
const impacted = assessKingmakerOperations({ dependencies, signals: identityOpen, now: "2026-08-03T15:00:00Z" });
assert.equal(impacted.find((value) => value.service === "identity")?.state, "blocked");
assert.equal(impacted.find((value) => value.service === "truth")?.state, "blocked");
assert.ok((impacted.find((value) => value.service === "command-center")?.impactScore ?? 0) > 0);

const maintenance = assessKingmakerOperations({
  dependencies,
  signals: healthySignals.map((signal) => signal.service === "command-center" ? { ...signal, state: "degraded" as const } : signal),
  now: "2026-08-03T15:00:00Z",
  maintenance: [{ service: "command-center", startsAt: "2026-08-03T14:00:00Z", endsAt: "2026-08-03T16:00:00Z", reason: "planned", approvedBy: "owner" }],
});
assert.equal(maintenance.find((value) => value.service === "command-center")?.state, "watch");

const capacityHealthy = forecastKingmakerCapacity({ service: "ebay", currentLoad: 50, safeCapacity: 100, growthPerHour: 5, observedAt: "2026-08-03T15:00:00Z" });
assert.equal(capacityHealthy.state, "healthy");
assert.equal(capacityHealthy.hoursToCapacity, 10);
const capacityBlocked = forecastKingmakerCapacity({ service: "mercari", currentLoad: 120, safeCapacity: 100, growthPerHour: 1, observedAt: "2026-08-03T15:00:00Z" });
assert.equal(capacityBlocked.state, "blocked");
assert.equal(capacityBlocked.hoursToCapacity, 0);

const blockedAssessment = impacted.find((value) => value.service === "identity");
assert.ok(blockedAssessment);
const runbook = buildKingmakerRunbook({
  incidentFingerprint: "a".repeat(64),
  assessment: blockedAssessment!,
  authorizationIntegrity: false,
  reconciliationClean: false,
  releaseCandidateActive: true,
});
assert.ok(runbook.actions.includes("failover"));
assert.ok(runbook.actions.includes("reconcile"));
assert.ok(runbook.actions.includes("rollback"));
assert.equal(runbook.requiresOwnerApproval, true);

const executive = buildKingmakerExecutiveHealth({
  assessments: impacted,
  capacities: [capacityHealthy, capacityBlocked],
  unresolvedIncidents: 1,
  generatedAt: "2026-08-03T15:00:00Z",
});
assert.equal(executive.state, "blocked");
assert.equal(executive.totals.unresolvedIncidents, 1);
assert.equal(executive.fingerprint.length, 64);

console.log("KINGMAKER Phase 8 operational intelligence regressions passed.");
