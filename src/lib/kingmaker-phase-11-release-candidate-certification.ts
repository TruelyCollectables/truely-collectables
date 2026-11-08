import { createHash } from "node:crypto";

export type ReleaseVerdict = "certified" | "hold" | "blocked";
export type DrillStatus = "passed" | "failed" | "not_run";

export type CertificationCheck = {
  name: string;
  required: boolean;
  passed: boolean;
  evidenceFingerprint: string;
  detail?: string;
};

export type RecoveryDrill = {
  name: "replay" | "failover" | "rollback" | "disaster_recovery";
  status: DrillStatus;
  durationMs: number;
  dataLossRecords: number;
  ownerApprovalVerified: boolean;
};

export type ReleaseCandidateInput = {
  releaseId: string;
  commitSha: string;
  generatedAt: string;
  authorizationIntegrity: boolean;
  capitalLedgerBalanced: boolean;
  idempotencyIntegrity: boolean;
  migrationReady: boolean;
  productionConfigReady: boolean;
  regressionSuitesPassed: number;
  regressionSuitesRequired: number;
  p95LatencyMs: number;
  maxP95LatencyMs: number;
  errorRatePct: number;
  maxErrorRatePct: number;
  checks: CertificationCheck[];
  drills: RecoveryDrill[];
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("invalid_generated_at");
}

function canonicalChecks(checks: CertificationCheck[]) {
  const names = new Set<string>();
  return checks.map((check) => {
    const name = check.name.trim();
    if (!name) throw new Error("missing_check_name");
    if (names.has(name)) throw new Error("duplicate_check_name");
    names.add(name);
    if (!/^[a-f0-9]{64}$/i.test(check.evidenceFingerprint)) throw new Error("invalid_evidence_fingerprint");
    return { ...check, name };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function canonicalDrills(drills: RecoveryDrill[]) {
  const required = new Set<RecoveryDrill["name"]>(["replay", "failover", "rollback", "disaster_recovery"]);
  const seen = new Set<string>();
  const normalized = drills.map((drill) => {
    if (seen.has(drill.name)) throw new Error("duplicate_drill");
    seen.add(drill.name);
    if (!Number.isFinite(drill.durationMs) || drill.durationMs < 0) throw new Error("invalid_drill_duration");
    if (!Number.isInteger(drill.dataLossRecords) || drill.dataLossRecords < 0) throw new Error("invalid_data_loss");
    return drill;
  }).sort((a, b) => a.name.localeCompare(b.name));
  for (const name of required) if (!seen.has(name)) throw new Error(`missing_drill:${name}`);
  return normalized;
}

export function certifyKingmakerReleaseCandidate(input: ReleaseCandidateInput) {
  if (!input.releaseId.trim()) throw new Error("missing_release_id");
  if (!/^[a-f0-9]{7,64}$/i.test(input.commitSha)) throw new Error("invalid_commit_sha");
  assertDate(input.generatedAt);
  if (!Number.isInteger(input.regressionSuitesPassed) || !Number.isInteger(input.regressionSuitesRequired) || input.regressionSuitesRequired < 1) throw new Error("invalid_regression_counts");
  for (const value of [input.p95LatencyMs, input.maxP95LatencyMs, input.errorRatePct, input.maxErrorRatePct]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("invalid_performance_metric");
  }

  const checks = canonicalChecks(input.checks);
  const drills = canonicalDrills(input.drills);
  const blockers: string[] = [];
  const holds: string[] = [];

  if (!input.authorizationIntegrity) blockers.push("authorization_integrity_failed");
  if (!input.capitalLedgerBalanced) blockers.push("capital_ledger_unbalanced");
  if (!input.idempotencyIntegrity) blockers.push("idempotency_integrity_failed");
  if (!input.migrationReady) blockers.push("migration_not_ready");
  if (!input.productionConfigReady) blockers.push("production_config_not_ready");
  if (input.regressionSuitesPassed < input.regressionSuitesRequired) blockers.push("regression_coverage_incomplete");
  if (checks.some((check) => check.required && !check.passed)) blockers.push("required_check_failed");
  if (drills.some((drill) => drill.status !== "passed")) blockers.push("recovery_drill_incomplete");
  if (drills.some((drill) => drill.dataLossRecords > 0)) blockers.push("recovery_data_loss_detected");
  const approvalDrills = drills.filter((drill) => drill.name === "rollback" || drill.name === "disaster_recovery");
  if (approvalDrills.some((drill) => !drill.ownerApprovalVerified)) blockers.push("owner_approval_not_verified");

  if (input.p95LatencyMs > input.maxP95LatencyMs) holds.push("latency_budget_exceeded");
  if (input.errorRatePct > input.maxErrorRatePct) holds.push("error_budget_exceeded");
  if (checks.some((check) => !check.required && !check.passed)) holds.push("optional_check_failed");

  const verdict: ReleaseVerdict = blockers.length ? "blocked" : holds.length ? "hold" : "certified";
  const canonical = {
    releaseId: input.releaseId.trim(),
    commitSha: input.commitSha.toLowerCase(),
    generatedAt: new Date(input.generatedAt).toISOString(),
    verdict,
    blockers: [...new Set(blockers)].sort(),
    holds: [...new Set(holds)].sort(),
    checks,
    drills,
    metrics: {
      regressionSuitesPassed: input.regressionSuitesPassed,
      regressionSuitesRequired: input.regressionSuitesRequired,
      p95LatencyMs: input.p95LatencyMs,
      maxP95LatencyMs: input.maxP95LatencyMs,
      errorRatePct: input.errorRatePct,
      maxErrorRatePct: input.maxErrorRatePct,
    },
  };
  return { ...canonical, certificateFingerprint: hash(canonical) };
}
