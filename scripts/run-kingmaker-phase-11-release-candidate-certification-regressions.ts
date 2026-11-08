import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { certifyKingmakerReleaseCandidate, type ReleaseCandidateInput } from "../src/lib/kingmaker-phase-11-release-candidate-certification";

const evidence = (value: string) => createHash("sha256").update(value).digest("hex");
const base: ReleaseCandidateInput = {
  releaseId: "kingmaker-rc-11",
  commitSha: "bcb9720ccd6338cd511b762a7d7420681ca2c03b",
  generatedAt: "2026-08-03T16:30:00Z",
  authorizationIntegrity: true,
  capitalLedgerBalanced: true,
  idempotencyIntegrity: true,
  migrationReady: true,
  productionConfigReady: true,
  regressionSuitesPassed: 24,
  regressionSuitesRequired: 24,
  p95LatencyMs: 480,
  maxP95LatencyMs: 500,
  errorRatePct: 0.4,
  maxErrorRatePct: 0.5,
  checks: [
    { name: "end_to_end_execution", required: true, passed: true, evidenceFingerprint: evidence("e2e") },
    { name: "ledger_reconciliation", required: true, passed: true, evidenceFingerprint: evidence("ledger") },
    { name: "optional_capacity_margin", required: false, passed: true, evidenceFingerprint: evidence("capacity") },
  ],
  drills: [
    { name: "replay", status: "passed", durationMs: 100, dataLossRecords: 0, ownerApprovalVerified: true },
    { name: "failover", status: "passed", durationMs: 200, dataLossRecords: 0, ownerApprovalVerified: true },
    { name: "rollback", status: "passed", durationMs: 300, dataLossRecords: 0, ownerApprovalVerified: true },
    { name: "disaster_recovery", status: "passed", durationMs: 400, dataLossRecords: 0, ownerApprovalVerified: true },
  ],
};

const certified = certifyKingmakerReleaseCandidate(base);
assert.equal(certified.verdict, "certified");
assert.deepEqual(certified.blockers, []);
assert.deepEqual(certified.holds, []);
assert.equal(certified.certificateFingerprint, certifyKingmakerReleaseCandidate({ ...base, checks: [...base.checks].reverse(), drills: [...base.drills].reverse() }).certificateFingerprint);

const hold = certifyKingmakerReleaseCandidate({ ...base, p95LatencyMs: 501 });
assert.equal(hold.verdict, "hold");
assert.ok(hold.holds.includes("latency_budget_exceeded"));

const blocked = certifyKingmakerReleaseCandidate({ ...base, authorizationIntegrity: false });
assert.equal(blocked.verdict, "blocked");
assert.ok(blocked.blockers.includes("authorization_integrity_failed"));

const dataLoss = certifyKingmakerReleaseCandidate({
  ...base,
  drills: base.drills.map((drill) => drill.name === "disaster_recovery" ? { ...drill, dataLossRecords: 1 } : drill),
});
assert.equal(dataLoss.verdict, "blocked");
assert.ok(dataLoss.blockers.includes("recovery_data_loss_detected"));

assert.throws(() => certifyKingmakerReleaseCandidate({ ...base, checks: [...base.checks, base.checks[0]] }), /duplicate_check_name/);
assert.throws(() => certifyKingmakerReleaseCandidate({ ...base, drills: base.drills.filter((drill) => drill.name !== "rollback") }), /missing_drill:rollback/);
assert.throws(() => certifyKingmakerReleaseCandidate({ ...base, commitSha: "nope" }), /invalid_commit_sha/);

console.log("KINGMAKER Phase 11 release candidate certification regressions passed.");
