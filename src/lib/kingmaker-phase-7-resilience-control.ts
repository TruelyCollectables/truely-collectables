import { createHash } from "node:crypto";

export type KingmakerServiceState = "healthy" | "degraded" | "open" | "recovering";
export type KingmakerIncidentSeverity = "info" | "warning" | "critical";
export type KingmakerReleaseVerdict = "promote" | "hold" | "rollback";

export type KingmakerSloPolicy = {
  availabilityTarget: number;
  maxP95LatencyMs: number;
  maxErrorRate: number;
  maxDataLagSeconds: number;
  maxReconciliationDrift: number;
};

export type KingmakerServiceWindow = {
  service: string;
  requests: number;
  errors: number;
  successful: number;
  p95LatencyMs: number;
  dataLagSeconds: number;
  startedAt: string;
  endedAt: string;
};

export type KingmakerCircuitState = {
  service: string;
  state: KingmakerServiceState;
  consecutiveFailures: number;
  openedAt: string | null;
  nextProbeAt: string | null;
  fingerprint: string;
};

export type KingmakerDeadLetter = {
  queue: string;
  messageId: string;
  tenantId: string;
  attempts: number;
  reason: string;
  payloadFingerprint: string;
  failedAt: string;
  nextAction: "retry" | "quarantine" | "manual_review";
  fingerprint: string;
};

export type KingmakerReconciliation = {
  ledger: string;
  expectedCount: number;
  actualCount: number;
  missingIds: string[];
  unexpectedIds: string[];
  driftRate: number;
  status: "clean" | "warning" | "critical";
  fingerprint: string;
};

export type KingmakerIncident = {
  severity: KingmakerIncidentSeverity;
  code: string;
  service: string;
  summary: string;
  openedAt: string;
  automaticAction: "none" | "degrade" | "open_circuit" | "rollback";
  fingerprint: string;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertDate(value: string, code: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function bounded(value: number, min: number, max: number, code: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(code);
  return value;
}

export function validateKingmakerSloPolicy(policy: KingmakerSloPolicy): KingmakerSloPolicy {
  return {
    availabilityTarget: bounded(policy.availabilityTarget, 0.9, 1, "invalid_availability_target"),
    maxP95LatencyMs: bounded(policy.maxP95LatencyMs, 1, 300_000, "invalid_latency_target"),
    maxErrorRate: bounded(policy.maxErrorRate, 0, 0.25, "invalid_error_target"),
    maxDataLagSeconds: bounded(policy.maxDataLagSeconds, 0, 86_400, "invalid_lag_target"),
    maxReconciliationDrift: bounded(policy.maxReconciliationDrift, 0, 0.2, "invalid_drift_target"),
  };
}

export function evaluateKingmakerServiceWindow(input: { window: KingmakerServiceWindow; policy: KingmakerSloPolicy }) {
  const policy = validateKingmakerSloPolicy(input.policy);
  const window = input.window;
  assertDate(window.startedAt, "invalid_window_start");
  assertDate(window.endedAt, "invalid_window_end");
  if (Date.parse(window.endedAt) < Date.parse(window.startedAt)) throw new Error("invalid_window_order");
  if (!window.service.trim()) throw new Error("missing_service");
  if (![window.requests, window.errors, window.successful].every(Number.isInteger)) throw new Error("invalid_request_counts");
  if (window.requests < 0 || window.errors < 0 || window.successful < 0 || window.errors + window.successful !== window.requests) throw new Error("inconsistent_request_counts");
  const availability = window.requests === 0 ? 1 : window.successful / window.requests;
  const errorRate = window.requests === 0 ? 0 : window.errors / window.requests;
  const breaches = [
    availability < policy.availabilityTarget ? "availability" : null,
    errorRate > policy.maxErrorRate ? "error_rate" : null,
    window.p95LatencyMs > policy.maxP95LatencyMs ? "latency" : null,
    window.dataLagSeconds > policy.maxDataLagSeconds ? "data_lag" : null,
  ].filter((value): value is string => Boolean(value));
  const burnRate = Number(Math.max(
    policy.maxErrorRate === 0 ? (errorRate > 0 ? 100 : 0) : errorRate / policy.maxErrorRate,
    policy.maxP95LatencyMs ? window.p95LatencyMs / policy.maxP95LatencyMs : 0,
    policy.maxDataLagSeconds === 0 ? (window.dataLagSeconds > 0 ? 100 : 0) : window.dataLagSeconds / policy.maxDataLagSeconds,
  ).toFixed(4));
  const state: KingmakerServiceState = breaches.length === 0 ? "healthy" : burnRate >= 2 || breaches.length >= 3 ? "open" : "degraded";
  const canonical = { service: window.service.trim(), availability, errorRate, burnRate, breaches, state, window };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function transitionKingmakerCircuit(input: {
  previous?: KingmakerCircuitState;
  service: string;
  now: string;
  success: boolean;
  failureThreshold?: number;
  cooldownSeconds?: number;
}): KingmakerCircuitState {
  assertDate(input.now, "invalid_circuit_time");
  const failureThreshold = Math.max(1, Math.floor(input.failureThreshold ?? 3));
  const cooldownSeconds = Math.max(1, Math.floor(input.cooldownSeconds ?? 300));
  const prior = input.previous;
  if (prior && prior.service !== input.service) throw new Error("circuit_service_mismatch");
  let state: KingmakerServiceState = prior?.state ?? "healthy";
  let failures = prior?.consecutiveFailures ?? 0;
  let openedAt = prior?.openedAt ?? null;
  let nextProbeAt = prior?.nextProbeAt ?? null;
  const nowMs = Date.parse(input.now);
  if (state === "open" && nextProbeAt && nowMs >= Date.parse(nextProbeAt)) state = "recovering";
  if (input.success) {
    failures = 0;
    state = "healthy";
    openedAt = null;
    nextProbeAt = null;
  } else {
    failures += 1;
    if (state === "recovering" || failures >= failureThreshold) {
      state = "open";
      openedAt = input.now;
      nextProbeAt = new Date(nowMs + cooldownSeconds * 1000).toISOString();
    } else {
      state = "degraded";
    }
  }
  const canonical = { service: input.service, state, consecutiveFailures: failures, openedAt, nextProbeAt };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function buildKingmakerDeadLetter(input: {
  queue: string;
  messageId: string;
  tenantId: string;
  attempts: number;
  reason: string;
  payload: unknown;
  failedAt: string;
  maxAttempts?: number;
}): KingmakerDeadLetter {
  assertDate(input.failedAt, "invalid_failed_at");
  if (!input.queue.trim() || !input.messageId.trim() || !input.tenantId.trim() || !input.reason.trim()) throw new Error("invalid_dead_letter_identity");
  if (!Number.isInteger(input.attempts) || input.attempts < 1) throw new Error("invalid_attempt_count");
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 5));
  const nextAction = input.reason.includes("authorization") || input.reason.includes("identity")
    ? "manual_review"
    : input.attempts >= maxAttempts
      ? "quarantine"
      : "retry";
  const canonical = {
    queue: input.queue.trim(), messageId: input.messageId.trim(), tenantId: input.tenantId.trim(), attempts: input.attempts,
    reason: input.reason.trim(), payloadFingerprint: hash(input.payload), failedAt: input.failedAt, nextAction,
  };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function reconcileKingmakerLedger(input: { ledger: string; expectedIds: string[]; actualIds: string[]; policy: KingmakerSloPolicy }): KingmakerReconciliation {
  const policy = validateKingmakerSloPolicy(input.policy);
  if (!input.ledger.trim()) throw new Error("missing_ledger");
  const expected = [...new Set(input.expectedIds.map((value) => value.trim()).filter(Boolean))].sort();
  const actual = [...new Set(input.actualIds.map((value) => value.trim()).filter(Boolean))].sort();
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missingIds = expected.filter((id) => !actualSet.has(id));
  const unexpectedIds = actual.filter((id) => !expectedSet.has(id));
  const denominator = Math.max(1, expected.length);
  const driftRate = Number(((missingIds.length + unexpectedIds.length) / denominator).toFixed(6));
  const status = driftRate === 0 ? "clean" : driftRate > policy.maxReconciliationDrift ? "critical" : "warning";
  const canonical = { ledger: input.ledger.trim(), expectedCount: expected.length, actualCount: actual.length, missingIds, unexpectedIds, driftRate, status };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function buildKingmakerIncident(input: { service: string; now: string; serviceState: KingmakerServiceState; driftStatus?: KingmakerReconciliation["status"]; authorizationFailure?: boolean }): KingmakerIncident | null {
  assertDate(input.now, "invalid_incident_time");
  if (input.authorizationFailure) {
    const canonical = { severity: "critical" as const, code: "authorization_integrity_failure", service: input.service, summary: "Authorization integrity failed; execution must remain blocked.", openedAt: input.now, automaticAction: "open_circuit" as const };
    return { ...canonical, fingerprint: hash(canonical) };
  }
  if (input.driftStatus === "critical") {
    const canonical = { severity: "critical" as const, code: "ledger_reconciliation_drift", service: input.service, summary: "Critical ledger drift detected; rollback and reconciliation are required.", openedAt: input.now, automaticAction: "rollback" as const };
    return { ...canonical, fingerprint: hash(canonical) };
  }
  if (input.serviceState === "open") {
    const canonical = { severity: "critical" as const, code: "service_circuit_open", service: input.service, summary: "Service circuit opened after repeated or severe failures.", openedAt: input.now, automaticAction: "open_circuit" as const };
    return { ...canonical, fingerprint: hash(canonical) };
  }
  if (input.serviceState === "degraded" || input.serviceState === "recovering") {
    const canonical = { severity: "warning" as const, code: "service_degraded", service: input.service, summary: "Service is operating below its reliability target.", openedAt: input.now, automaticAction: "degrade" as const };
    return { ...canonical, fingerprint: hash(canonical) };
  }
  return null;
}

export function evaluateKingmakerRelease(input: {
  candidateSha: string;
  currentSha: string;
  serviceEvaluations: ReturnType<typeof evaluateKingmakerServiceWindow>[];
  reconciliations: KingmakerReconciliation[];
  criticalIncidents: number;
  migrationVerified: boolean;
  authorizationVerified: boolean;
  regressionSuitesPassed: number;
  minimumRegressionSuites?: number;
}) {
  const reasons: string[] = [];
  if (!/^[a-f0-9]{7,40}$/i.test(input.candidateSha) || !/^[a-f0-9]{7,40}$/i.test(input.currentSha)) reasons.push("invalid_release_sha");
  if (input.candidateSha === input.currentSha) reasons.push("candidate_matches_current");
  if (input.serviceEvaluations.some((evaluation) => evaluation.state === "open")) reasons.push("open_service_circuit");
  if (input.reconciliations.some((reconciliation) => reconciliation.status === "critical")) reasons.push("critical_reconciliation_drift");
  if (input.criticalIncidents > 0) reasons.push("critical_incident_open");
  if (!input.migrationVerified) reasons.push("migration_not_verified");
  if (!input.authorizationVerified) reasons.push("authorization_not_verified");
  if (input.regressionSuitesPassed < (input.minimumRegressionSuites ?? 15)) reasons.push("insufficient_regression_coverage");
  const verdict: KingmakerReleaseVerdict = reasons.some((reason) => ["open_service_circuit", "critical_reconciliation_drift", "critical_incident_open", "authorization_not_verified"].includes(reason))
    ? "rollback"
    : reasons.length
      ? "hold"
      : "promote";
  const canonical = { candidateSha: input.candidateSha, currentSha: input.currentSha, verdict, reasons, evidence: {
    serviceFingerprints: input.serviceEvaluations.map((value) => value.fingerprint).sort(),
    reconciliationFingerprints: input.reconciliations.map((value) => value.fingerprint).sort(),
    regressionSuitesPassed: input.regressionSuitesPassed,
  } };
  return { ...canonical, fingerprint: hash(canonical) };
}
