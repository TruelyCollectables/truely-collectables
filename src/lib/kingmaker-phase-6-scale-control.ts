import { createHash } from "node:crypto";

export type KingmakerTenantPlan = "owner" | "pro" | "enterprise";
export type KingmakerPhase6Action = "deploy" | "offer" | "watch" | "research" | "reject";
export type KingmakerAlertChannel = "command_center" | "email" | "push" | "webhook";

export type KingmakerTenantPolicy = {
  tenantId: string;
  plan: KingmakerTenantPlan;
  enabledSources: string[];
  dailyScanLimit: number;
  hourlyActionLimit: number;
  maximumSingleDeployment: number;
  maximumDailyDeployment: number;
  minimumConfidence: number;
  maximumRisk: number;
  requireOwnerApproval: boolean;
  alertChannels: KingmakerAlertChannel[];
};

export type KingmakerScaleDecision = {
  fingerprint: string;
  tenantId: string;
  source: string;
  entityKey: string;
  action: KingmakerPhase6Action;
  amount: number;
  confidence: number;
  riskScore: number;
  expectedProfit: number;
  expectedRoiPercent: number;
  observedAt: string;
  expiresAt: string;
};

export type KingmakerUsageWindow = {
  scansToday: number;
  actionsThisHour: number;
  deployedToday: number;
  activeDeployments: number;
};

export type KingmakerReadinessVerdict = "ready" | "approval_required" | "throttled" | "blocked" | "expired";

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function money(value: number) {
  if (!Number.isFinite(value)) throw new Error("invalid_money");
  return Number(value.toFixed(2));
}

export function validateKingmakerTenantPolicy(policy: KingmakerTenantPolicy) {
  const errors: string[] = [];
  if (!policy.tenantId.trim()) errors.push("missing_tenant_id");
  if (!policy.enabledSources.length) errors.push("no_enabled_sources");
  if (!Number.isInteger(policy.dailyScanLimit) || policy.dailyScanLimit < 1) errors.push("invalid_daily_scan_limit");
  if (!Number.isInteger(policy.hourlyActionLimit) || policy.hourlyActionLimit < 1) errors.push("invalid_hourly_action_limit");
  if (policy.maximumSingleDeployment <= 0) errors.push("invalid_single_deployment_limit");
  if (policy.maximumDailyDeployment < policy.maximumSingleDeployment) errors.push("daily_limit_below_single_limit");
  if (policy.minimumConfidence < 0 || policy.minimumConfidence > 1) errors.push("invalid_minimum_confidence");
  if (policy.maximumRisk < 0 || policy.maximumRisk > 100) errors.push("invalid_maximum_risk");
  if (!policy.alertChannels.length) errors.push("no_alert_channels");
  const normalized = {
    ...policy,
    tenantId: policy.tenantId.trim(),
    enabledSources: [...new Set(policy.enabledSources.map((source) => source.trim()).filter(Boolean))].sort(),
    alertChannels: [...new Set(policy.alertChannels)].sort(),
    maximumSingleDeployment: money(policy.maximumSingleDeployment),
    maximumDailyDeployment: money(policy.maximumDailyDeployment),
  };
  return { accepted: errors.length === 0, errors, normalized, fingerprint: stableHash({ normalized, errors }) };
}

export function evaluateKingmakerScaleReadiness(input: {
  policy: KingmakerTenantPolicy;
  usage: KingmakerUsageWindow;
  decision: KingmakerScaleDecision;
  now: string;
}) {
  const reasons: string[] = [];
  const policyResult = validateKingmakerTenantPolicy(input.policy);
  if (!policyResult.accepted) reasons.push(...policyResult.errors);
  const nowMs = Date.parse(input.now);
  const expiresMs = Date.parse(input.decision.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresMs)) reasons.push("invalid_timestamp");
  if (input.decision.tenantId !== input.policy.tenantId) reasons.push("tenant_mismatch");
  if (!input.policy.enabledSources.includes(input.decision.source)) reasons.push("source_not_enabled");
  if (input.decision.confidence < input.policy.minimumConfidence) reasons.push("confidence_below_policy");
  if (input.decision.riskScore > input.policy.maximumRisk) reasons.push("risk_above_policy");
  if (input.decision.amount > input.policy.maximumSingleDeployment) reasons.push("single_deployment_limit_exceeded");
  if (input.usage.deployedToday + input.decision.amount > input.policy.maximumDailyDeployment) reasons.push("daily_deployment_limit_exceeded");
  if (input.usage.scansToday >= input.policy.dailyScanLimit) reasons.push("daily_scan_limit_reached");
  if (input.usage.actionsThisHour >= input.policy.hourlyActionLimit) reasons.push("hourly_action_limit_reached");
  if (input.decision.expectedProfit <= 0 || input.decision.expectedRoiPercent <= 0) reasons.push("non_profitable_decision");

  let verdict: KingmakerReadinessVerdict = "ready";
  if (Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs <= nowMs) verdict = "expired";
  else if (reasons.some((reason) => ["tenant_mismatch", "source_not_enabled", "risk_above_policy", "single_deployment_limit_exceeded", "daily_deployment_limit_exceeded", "non_profitable_decision"].includes(reason))) verdict = "blocked";
  else if (reasons.some((reason) => reason.endsWith("limit_reached"))) verdict = "throttled";
  else if (reasons.length) verdict = "blocked";
  else if (input.policy.requireOwnerApproval && ["deploy", "offer"].includes(input.decision.action)) verdict = "approval_required";

  const canonical = { tenantId: input.policy.tenantId, decisionFingerprint: input.decision.fingerprint, verdict, reasons };
  return { verdict, reasons, fingerprint: stableHash(canonical) };
}

export function routeKingmakerPhase6Alerts(input: {
  policy: KingmakerTenantPolicy;
  verdict: KingmakerReadinessVerdict;
  decision: KingmakerScaleDecision;
}) {
  const severity = input.verdict === "blocked" || input.verdict === "expired" ? "critical" : input.verdict === "throttled" ? "warning" : input.verdict === "approval_required" ? "action" : "info";
  const channels = input.verdict === "ready"
    ? input.policy.alertChannels.filter((channel) => channel === "command_center")
    : input.policy.alertChannels;
  const payload = {
    tenantId: input.policy.tenantId,
    decisionFingerprint: input.decision.fingerprint,
    action: input.decision.action,
    amount: money(input.decision.amount),
    verdict: input.verdict,
    severity,
    channels,
  };
  return { ...payload, fingerprint: stableHash(payload) };
}

export function buildKingmakerAuditReplay(input: {
  tenantId: string;
  decision: KingmakerScaleDecision;
  evidenceFingerprints: string[];
  policyFingerprint: string;
  readinessFingerprint: string;
  actionFingerprints: string[];
}) {
  const replay = {
    version: "phase-6-v1" as const,
    tenantId: input.tenantId,
    decision: input.decision,
    evidenceFingerprints: [...new Set(input.evidenceFingerprints)].sort(),
    policyFingerprint: input.policyFingerprint,
    readinessFingerprint: input.readinessFingerprint,
    actionFingerprints: [...new Set(input.actionFingerprints)].sort(),
  };
  return { ...replay, fingerprint: stableHash(replay) };
}

export function allocateKingmakerWorkerCapacity(input: {
  workers: number;
  tenants: Array<{ tenantId: string; priority: number; backlog: number; plan: KingmakerTenantPlan }>;
}) {
  if (!Number.isInteger(input.workers) || input.workers < 1) throw new Error("invalid_worker_count");
  const planWeight: Record<KingmakerTenantPlan, number> = { owner: 5, enterprise: 3, pro: 1 };
  const ranked = input.tenants
    .filter((tenant) => tenant.backlog > 0)
    .map((tenant) => ({ ...tenant, score: tenant.priority * 10 + Math.min(100, tenant.backlog) + planWeight[tenant.plan] * 20 }))
    .sort((a, b) => b.score - a.score || a.tenantId.localeCompare(b.tenantId));
  const assignments = ranked.slice(0, input.workers).map((tenant, index) => ({ worker: index + 1, tenantId: tenant.tenantId, score: tenant.score }));
  return { assignments, unassigned: ranked.slice(input.workers).map((tenant) => tenant.tenantId), fingerprint: stableHash(assignments) };
}
