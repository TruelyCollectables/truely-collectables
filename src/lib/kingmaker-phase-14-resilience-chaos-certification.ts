export type ChaosVerdict = "certified" | "hold" | "blocked";
export type FaultClass = "dependency" | "database" | "queue" | "network" | "clock" | "capacity" | "authorization";

export interface ChaosScenario {
  id: string;
  faultClass: FaultClass;
  required: boolean;
  injected: boolean;
  detected: boolean;
  contained: boolean;
  recovered: boolean;
  dataLoss: number;
  duplicateEffects: number;
  unauthorizedEffects: number;
  recoverySeconds: number;
  maxRecoverySeconds: number;
}

export interface ResilienceControls {
  ownerApprovalVerified: boolean;
  releaseCertified: boolean;
  rollbackReady: boolean;
  killSwitchAvailable: boolean;
  auditTrailComplete: boolean;
  backupRestoreVerified: boolean;
  capitalLedgerBalanced: boolean;
  idempotencyHealthy: boolean;
}

export interface ChaosCertificate {
  verdict: ChaosVerdict;
  certifiedScenarioCount: number;
  requiredScenarioCount: number;
  blockers: string[];
  warnings: string[];
  fingerprint: string;
}

function fingerprint(parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `km14-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validScenario(scenario: ChaosScenario): boolean {
  return Boolean(scenario.id.trim())
    && Number.isFinite(scenario.dataLoss)
    && Number.isFinite(scenario.duplicateEffects)
    && Number.isFinite(scenario.unauthorizedEffects)
    && Number.isFinite(scenario.recoverySeconds)
    && Number.isFinite(scenario.maxRecoverySeconds)
    && scenario.dataLoss >= 0
    && scenario.duplicateEffects >= 0
    && scenario.unauthorizedEffects >= 0
    && scenario.recoverySeconds >= 0
    && scenario.maxRecoverySeconds > 0;
}

export function certifyChaosResilience(input: {
  scenarios: ChaosScenario[];
  requiredScenarioIds: string[];
  controls: ResilienceControls;
}): ChaosCertificate {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const requiredIds = [...new Set(input.requiredScenarioIds.map((id) => id.trim()).filter(Boolean))].sort();

  if (requiredIds.length === 0) blockers.push("required-scenario-set-empty");

  const byId = new Map<string, ChaosScenario>();
  for (const scenario of input.scenarios) {
    if (!validScenario(scenario)) {
      blockers.push(`${scenario.id || "unnamed"}:invalid-scenario`);
      continue;
    }
    if (seen.has(scenario.id)) {
      blockers.push(`${scenario.id}:duplicate-scenario`);
      continue;
    }
    seen.add(scenario.id);
    byId.set(scenario.id, scenario);
  }

  for (const requiredId of requiredIds) {
    if (!byId.has(requiredId)) blockers.push(`${requiredId}:missing-required-scenario`);
  }

  if (!input.controls.ownerApprovalVerified) blockers.push("owner-approval-unverified");
  if (!input.controls.releaseCertified) blockers.push("release-not-certified");
  if (!input.controls.rollbackReady) blockers.push("rollback-not-ready");
  if (!input.controls.killSwitchAvailable) blockers.push("kill-switch-unavailable");
  if (!input.controls.auditTrailComplete) blockers.push("audit-trail-incomplete");
  if (!input.controls.backupRestoreVerified) blockers.push("backup-restore-unverified");
  if (!input.controls.capitalLedgerBalanced) blockers.push("capital-ledger-unbalanced");
  if (!input.controls.idempotencyHealthy) blockers.push("idempotency-unhealthy");

  let certifiedScenarioCount = 0;
  for (const scenario of [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const failed: string[] = [];
    if (!scenario.injected) failed.push("not-injected");
    if (!scenario.detected) failed.push("not-detected");
    if (!scenario.contained) failed.push("not-contained");
    if (!scenario.recovered) failed.push("not-recovered");
    if (scenario.dataLoss !== 0) failed.push("data-loss");
    if (scenario.duplicateEffects !== 0) failed.push("duplicate-effects");
    if (scenario.unauthorizedEffects !== 0) failed.push("unauthorized-effects");
    if (scenario.recoverySeconds > scenario.maxRecoverySeconds) failed.push("recovery-budget-exceeded");

    if (failed.length === 0) {
      certifiedScenarioCount += 1;
    } else if (scenario.required || requiredIds.includes(scenario.id)) {
      blockers.push(...failed.map((reason) => `${scenario.id}:${reason}`));
    } else {
      warnings.push(...failed.map((reason) => `${scenario.id}:${reason}`));
    }
  }

  const verdict: ChaosVerdict = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "hold" : "certified";
  const sortedBlockers = blockers.sort();
  const sortedWarnings = warnings.sort();

  return {
    verdict,
    certifiedScenarioCount,
    requiredScenarioCount: requiredIds.length,
    blockers: sortedBlockers,
    warnings: sortedWarnings,
    fingerprint: fingerprint([
      verdict,
      String(certifiedScenarioCount),
      String(requiredIds.length),
      ...sortedBlockers,
      ...sortedWarnings,
    ]),
  };
}
