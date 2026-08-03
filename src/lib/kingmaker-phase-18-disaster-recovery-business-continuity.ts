import { createHash } from "node:crypto";

export type ContinuityVerdict = "ready" | "degraded" | "failover" | "blocked";

export interface RecoveryScenarioEvidence {
  scenarioId: string;
  executed: boolean;
  sourceVerified: boolean;
  restoreVerified: boolean;
  dataLossRecords: number;
  duplicateEffects: number;
  rtoMinutes: number;
  rpoMinutes: number;
  testedAt: string;
}

export interface ContinuityInput {
  now: string;
  ownerApproval: boolean;
  releaseCertified: boolean;
  accessCertified: boolean;
  backupsEncrypted: boolean;
  backupRestoreVerified: boolean;
  alternateRegionReady: boolean;
  communicationsReady: boolean;
  killSwitchReady: boolean;
  maximumEvidenceAgeDays: number;
  maximumRtoMinutes: number;
  maximumRpoMinutes: number;
  requiredScenarioIds: string[];
  scenarios: RecoveryScenarioEvidence[];
}

export interface ContinuityResult {
  verdict: ContinuityVerdict;
  reasons: string[];
  commands: Array<"require_owner_review" | "freeze_writes" | "initiate_failover" | "disable_payments_shipping">;
  fingerprint: string;
}

const DAY_MS = 86_400_000;

export function certifyDisasterRecovery(input: ContinuityInput): ContinuityResult {
  const reasons: string[] = [];
  const commands = new Set<ContinuityResult["commands"][number]>();
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs) || input.maximumEvidenceAgeDays <= 0 || input.maximumRtoMinutes <= 0 || input.maximumRpoMinutes < 0) reasons.push("invalid_policy");
  if (!input.ownerApproval) reasons.push("owner_approval_missing");
  if (!input.releaseCertified) reasons.push("release_not_certified");
  if (!input.accessCertified) reasons.push("access_not_certified");
  if (!input.backupsEncrypted) reasons.push("backups_not_encrypted");
  if (!input.backupRestoreVerified) reasons.push("backup_restore_unverified");
  if (!input.alternateRegionReady) reasons.push("alternate_region_unavailable");
  if (!input.communicationsReady) reasons.push("communications_unavailable");
  if (!input.killSwitchReady) reasons.push("kill_switch_unavailable");

  const seen = new Set<string>();
  for (const scenario of input.scenarios) {
    if (!scenario.scenarioId || seen.has(scenario.scenarioId)) reasons.push("duplicate_or_missing_scenario");
    seen.add(scenario.scenarioId);
    const testedMs = Date.parse(scenario.testedAt);
    if (!scenario.executed || !scenario.sourceVerified || !scenario.restoreVerified) reasons.push(`scenario_unverified:${scenario.scenarioId}`);
    if (!Number.isFinite(testedMs) || nowMs - testedMs > input.maximumEvidenceAgeDays * DAY_MS) reasons.push(`scenario_stale:${scenario.scenarioId}`);
    if (scenario.dataLossRecords !== 0) reasons.push(`data_loss:${scenario.scenarioId}`);
    if (scenario.duplicateEffects !== 0) reasons.push(`duplicate_effects:${scenario.scenarioId}`);
    if (scenario.rtoMinutes > input.maximumRtoMinutes) reasons.push(`rto_breach:${scenario.scenarioId}`);
    if (scenario.rpoMinutes > input.maximumRpoMinutes) reasons.push(`rpo_breach:${scenario.scenarioId}`);
  }
  for (const id of new Set(input.requiredScenarioIds)) if (!seen.has(id)) reasons.push(`required_scenario_missing:${id}`);

  const severe = reasons.some((reason) => /invalid|missing|not_certified|not_encrypted|unverified|unavailable|data_loss|duplicate|rto_breach|rpo_breach/.test(reason));
  let verdict: ContinuityVerdict = "ready";
  if (severe) {
    verdict = input.ownerApproval && input.killSwitchReady && input.alternateRegionReady ? "failover" : "blocked";
    commands.add("freeze_writes");
    commands.add("disable_payments_shipping");
    commands.add("require_owner_review");
    if (verdict === "failover") commands.add("initiate_failover");
  } else if (reasons.length > 0) {
    verdict = "degraded";
    commands.add("require_owner_review");
  }

  const normalized = JSON.stringify({ ...input, requiredScenarioIds: [...new Set(input.requiredScenarioIds)].sort(), scenarios: [...input.scenarios].sort((a,b)=>a.scenarioId.localeCompare(b.scenarioId)), verdict, reasons: [...new Set(reasons)].sort(), commands: [...commands].sort() });
  return { verdict, reasons: [...new Set(reasons)].sort(), commands: [...commands].sort(), fingerprint: createHash("sha256").update(normalized).digest("hex") };
}
