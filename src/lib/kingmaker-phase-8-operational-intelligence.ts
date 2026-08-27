import { createHash } from "node:crypto";

export type KingmakerDependencyCriticality = "low" | "medium" | "high" | "critical";
export type KingmakerOperationalState = "healthy" | "watch" | "degraded" | "blocked";
export type KingmakerRunbookAction = "observe" | "degrade" | "failover" | "reconcile" | "rollback" | "owner_review";

export type KingmakerDependency = {
  service: string;
  dependsOn: string[];
  criticality: KingmakerDependencyCriticality;
  owner: string;
};

export type KingmakerServiceSignal = {
  service: string;
  state: "healthy" | "degraded" | "open" | "recovering";
  errorRate: number;
  p95LatencyMs: number;
  dataLagSeconds: number;
  observedAt: string;
};

export type KingmakerCapacityWindow = {
  service: string;
  currentLoad: number;
  safeCapacity: number;
  growthPerHour: number;
  observedAt: string;
};

export type KingmakerMaintenanceWindow = {
  service: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  approvedBy: string;
};

export type KingmakerOperationalAssessment = {
  service: string;
  state: KingmakerOperationalState;
  directState: KingmakerServiceSignal["state"];
  impactedBy: string[];
  impactScore: number;
  reasons: string[];
  fingerprint: string;
};

export type KingmakerRunbook = {
  incidentFingerprint: string;
  service: string;
  actions: KingmakerRunbookAction[];
  requiresOwnerApproval: boolean;
  summary: string;
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

export function validateKingmakerDependencyGraph(dependencies: KingmakerDependency[]) {
  const normalized = dependencies.map((dependency) => ({
    service: dependency.service.trim(),
    dependsOn: [...new Set(dependency.dependsOn.map((value) => value.trim()).filter(Boolean))].sort(),
    criticality: dependency.criticality,
    owner: dependency.owner.trim(),
  }));
  if (normalized.some((dependency) => !dependency.service || !dependency.owner)) throw new Error("invalid_dependency_identity");
  const services = new Set(normalized.map((dependency) => dependency.service));
  if (services.size !== normalized.length) throw new Error("duplicate_dependency_service");
  for (const dependency of normalized) {
    if (dependency.dependsOn.includes(dependency.service)) throw new Error("self_dependency");
    for (const target of dependency.dependsOn) if (!services.has(target)) throw new Error("unknown_dependency");
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byService = new Map(normalized.map((dependency) => [dependency.service, dependency]));
  const visit = (service: string) => {
    if (visiting.has(service)) throw new Error("dependency_cycle");
    if (visited.has(service)) return;
    visiting.add(service);
    for (const target of byService.get(service)?.dependsOn ?? []) visit(target);
    visiting.delete(service);
    visited.add(service);
  };
  for (const service of services) visit(service);
  const canonical = normalized.sort((a, b) => a.service.localeCompare(b.service));
  return { dependencies: canonical, fingerprint: hash(canonical) };
}

export function assessKingmakerOperations(input: {
  dependencies: KingmakerDependency[];
  signals: KingmakerServiceSignal[];
  now: string;
  maintenance?: KingmakerMaintenanceWindow[];
}): KingmakerOperationalAssessment[] {
  assertDate(input.now, "invalid_assessment_time");
  const graph = validateKingmakerDependencyGraph(input.dependencies).dependencies;
  const signalMap = new Map<string, KingmakerServiceSignal>();
  for (const signal of input.signals) {
    assertDate(signal.observedAt, "invalid_signal_time");
    bounded(signal.errorRate, 0, 1, "invalid_error_rate");
    bounded(signal.p95LatencyMs, 0, 300_000, "invalid_latency");
    bounded(signal.dataLagSeconds, 0, 86_400, "invalid_data_lag");
    if (signalMap.has(signal.service)) throw new Error("duplicate_service_signal");
    signalMap.set(signal.service, signal);
  }
  const maintenance = new Set((input.maintenance ?? []).filter((window) => {
    assertDate(window.startsAt, "invalid_maintenance_start");
    assertDate(window.endsAt, "invalid_maintenance_end");
    if (Date.parse(window.endsAt) <= Date.parse(window.startsAt)) throw new Error("invalid_maintenance_order");
    return Date.parse(window.startsAt) <= Date.parse(input.now) && Date.parse(input.now) <= Date.parse(window.endsAt);
  }).map((window) => window.service));
  const rank = { healthy: 0, recovering: 1, degraded: 2, open: 3 } as const;
  const criticalityWeight = { low: 1, medium: 2, high: 3, critical: 4 } as const;
  const assessments = new Map<string, KingmakerOperationalAssessment>();
  const evaluate = (service: string): KingmakerOperationalAssessment => {
    const cached = assessments.get(service);
    if (cached) return cached;
    const dependency = graph.find((entry) => entry.service === service);
    if (!dependency) throw new Error("missing_dependency");
    const signal = signalMap.get(service);
    if (!signal) throw new Error("missing_service_signal");
    const dependencyAssessments = dependency.dependsOn.map(evaluate);
    const impactedBy = dependencyAssessments.filter((value) => value.state !== "healthy").map((value) => value.service).sort();
    const directScore = rank[signal.state] * 25;
    const dependencyScore = dependencyAssessments.reduce((sum, value) => sum + (value.state === "blocked" ? 25 : value.state === "degraded" ? 15 : value.state === "watch" ? 5 : 0), 0);
    const impactScore = Math.min(100, directScore + dependencyScore * criticalityWeight[dependency.criticality]);
    const reasons: string[] = [];
    if (signal.state !== "healthy") reasons.push(`direct_${signal.state}`);
    if (impactedBy.length) reasons.push("dependency_impact");
    if (maintenance.has(service)) reasons.push("approved_maintenance");
    const state: KingmakerOperationalState = maintenance.has(service) && signal.state !== "open"
      ? "watch"
      : signal.state === "open" || impactScore >= 75
        ? "blocked"
        : signal.state === "degraded" || impactScore >= 35
          ? "degraded"
          : signal.state === "recovering" || impactScore > 0
            ? "watch"
            : "healthy";
    const canonical = { service, state, directState: signal.state, impactedBy, impactScore, reasons };
    const assessment = { ...canonical, fingerprint: hash(canonical) };
    assessments.set(service, assessment);
    return assessment;
  };
  return graph.map((dependency) => evaluate(dependency.service)).sort((a, b) => b.impactScore - a.impactScore || a.service.localeCompare(b.service));
}

export function forecastKingmakerCapacity(input: KingmakerCapacityWindow) {
  assertDate(input.observedAt, "invalid_capacity_time");
  bounded(input.currentLoad, 0, Number.MAX_SAFE_INTEGER, "invalid_current_load");
  bounded(input.safeCapacity, 1, Number.MAX_SAFE_INTEGER, "invalid_safe_capacity");
  bounded(input.growthPerHour, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "invalid_growth_rate");
  const utilization = input.currentLoad / input.safeCapacity;
  const hoursToCapacity = input.growthPerHour <= 0 || input.currentLoad >= input.safeCapacity
    ? input.currentLoad >= input.safeCapacity ? 0 : null
    : Number(((input.safeCapacity - input.currentLoad) / input.growthPerHour).toFixed(2));
  const state: KingmakerOperationalState = utilization >= 1 ? "blocked" : utilization >= 0.85 ? "degraded" : utilization >= 0.7 ? "watch" : "healthy";
  const canonical = { ...input, utilization: Number(utilization.toFixed(6)), hoursToCapacity, state };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function buildKingmakerRunbook(input: {
  incidentFingerprint: string;
  assessment: KingmakerOperationalAssessment;
  authorizationIntegrity: boolean;
  reconciliationClean: boolean;
  releaseCandidateActive: boolean;
}): KingmakerRunbook {
  if (!/^[a-f0-9]{64}$/i.test(input.incidentFingerprint)) throw new Error("invalid_incident_fingerprint");
  const actions: KingmakerRunbookAction[] = ["observe"];
  if (!input.authorizationIntegrity) actions.push("failover", "owner_review");
  if (!input.reconciliationClean) actions.push("reconcile");
  if (input.assessment.state === "degraded") actions.push("degrade");
  if (input.assessment.state === "blocked") actions.push("failover");
  if (input.releaseCandidateActive && input.assessment.state === "blocked") actions.push("rollback");
  const uniqueActions = [...new Set(actions)];
  const requiresOwnerApproval = uniqueActions.includes("rollback") || uniqueActions.includes("owner_review");
  const summary = `${input.assessment.service} is ${input.assessment.state}; execute ${uniqueActions.join(", ")}.`;
  const canonical = { incidentFingerprint: input.incidentFingerprint, service: input.assessment.service, actions: uniqueActions, requiresOwnerApproval, summary };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function buildKingmakerExecutiveHealth(input: {
  assessments: KingmakerOperationalAssessment[];
  capacities: ReturnType<typeof forecastKingmakerCapacity>[];
  unresolvedIncidents: number;
  generatedAt: string;
}) {
  assertDate(input.generatedAt, "invalid_health_time");
  if (!Number.isInteger(input.unresolvedIncidents) || input.unresolvedIncidents < 0) throw new Error("invalid_incident_count");
  const blocked = input.assessments.filter((value) => value.state === "blocked").length;
  const degraded = input.assessments.filter((value) => value.state === "degraded").length;
  const capacityRisks = input.capacities.filter((value) => value.state === "blocked" || value.state === "degraded").length;
  const state: KingmakerOperationalState = blocked || input.unresolvedIncidents > 0 ? "blocked" : degraded || capacityRisks ? "degraded" : input.assessments.some((value) => value.state === "watch") ? "watch" : "healthy";
  const canonical = {
    generatedAt: input.generatedAt,
    state,
    totals: { services: input.assessments.length, blocked, degraded, capacityRisks, unresolvedIncidents: input.unresolvedIncidents },
    assessmentFingerprints: input.assessments.map((value) => value.fingerprint).sort(),
    capacityFingerprints: input.capacities.map((value) => value.fingerprint).sort(),
  };
  return { ...canonical, fingerprint: hash(canonical) };
}
