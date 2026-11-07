export type ContinuousCommandDomain =
  | 'command_authority' | 'decision_latency' | 'signal_fidelity' | 'policy_convergence'
  | 'control_coverage' | 'exception_governance' | 'human_override' | 'mission_continuity'
  | 'degraded_mode' | 'state_reconciliation' | 'execution_idempotency' | 'audit_replay'
  | 'cross_region_command' | 'counterparty_containment' | 'recovery_orchestration' | 'continuous_recertification';

export type ContinuousCommandVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface ContinuousCommandEvidence {
  evidenceId: string;
  artifactDigest: string;
  domain: ContinuousCommandDomain;
  observedAt: string;
  sourceVerified: boolean;
  controlPassed: boolean;
  ownerApproved: boolean;
  incidentOpen: boolean;
}

export interface ContinuousCommandInput {
  evidence: ContinuousCommandEvidence[];
  now: string;
  maxEvidenceAgeDays: number;
  releaseCertified: boolean;
  authorityCertified: boolean;
  overrideReady: boolean;
  degradedModeReady: boolean;
  reconciliationComplete: boolean;
  recoveryReady: boolean;
  killSwitchReady: boolean;
}

export interface ContinuousCommandResult {
  verdict: ContinuousCommandVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly ContinuousCommandDomain[] = [
  'command_authority','decision_latency','signal_fidelity','policy_convergence','control_coverage','exception_governance','human_override','mission_continuity','degraded_mode','state_reconciliation','execution_idempotency','audit_replay','cross_region_command','counterparty_containment','recovery_orchestration','continuous_recertification',
];
const DAY = 86_400_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function certifyContinuousCommand(input: ContinuousCommandInput): ContinuousCommandResult {
  const reasons: string[] = [];
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) reasons.push('invalid_now');
  if (!Number.isFinite(input.maxEvidenceAgeDays) || input.maxEvidenceAgeDays < 0) reasons.push('invalid_max_evidence_age');
  if (!Array.isArray(input.evidence)) reasons.push('invalid_evidence_collection');

  const ids = new Set<string>();
  const digests = new Set<string>();
  const certified = new Set<ContinuousCommandDomain>();

  for (const raw of Array.isArray(input.evidence) ? input.evidence : []) {
    if (!isRecord(raw)) { reasons.push('invalid_evidence'); continue; }
    const item = raw as unknown as ContinuousCommandEvidence;
    if (typeof item.evidenceId !== 'string' || item.evidenceId.trim() === '') reasons.push('invalid_evidence_id');
    else if (ids.has(item.evidenceId)) reasons.push(`duplicate_evidence_id:${item.evidenceId}`);
    else ids.add(item.evidenceId);

    if (typeof item.artifactDigest !== 'string' || !DIGEST.test(item.artifactDigest)) reasons.push(`invalid_artifact_digest:${item.evidenceId}`);
    else if (digests.has(item.artifactDigest)) reasons.push(`duplicate_artifact_digest:${item.artifactDigest}`);
    else digests.add(item.artifactDigest);

    if (!DOMAINS.includes(item.domain)) { reasons.push(`unknown_domain:${String(item.domain)}`); continue; }
    const observed = Date.parse(item.observedAt);
    const fresh = Number.isFinite(observed) && Number.isFinite(now) && observed <= now && now - observed <= input.maxEvidenceAgeDays * DAY;
    if (!Number.isFinite(observed)) reasons.push(`invalid_observed_at:${item.evidenceId}`);
    else if (observed > now) reasons.push(`future_evidence:${item.evidenceId}`);
    else if (!fresh) reasons.push(`stale_evidence:${item.evidenceId}`);
    if (item.sourceVerified !== true) reasons.push(`unverified_source:${item.evidenceId}`);
    if (item.controlPassed !== true) reasons.push(`control_failed:${item.evidenceId}`);
    if (item.ownerApproved !== true) reasons.push(`owner_approval_missing:${item.evidenceId}`);
    if (item.incidentOpen === true) reasons.push(`incident_open:${item.evidenceId}`);
    if (fresh && item.sourceVerified === true && item.controlPassed === true && item.ownerApproved === true && item.incidentOpen !== true) certified.add(item.domain);
  }

  for (const domain of DOMAINS) if (!certified.has(domain)) reasons.push(`missing_certified_domain:${domain}`);
  if (!input.releaseCertified) reasons.push('release_not_certified');
  if (!input.authorityCertified) reasons.push('authority_not_certified');
  if (!input.overrideReady) reasons.push('override_not_ready');
  if (!input.degradedModeReady) reasons.push('degraded_mode_not_ready');
  if (!input.reconciliationComplete) reasons.push('reconciliation_incomplete');
  if (!input.recoveryReady) reasons.push('recovery_not_ready');
  if (!input.killSwitchReady) reasons.push('kill_switch_not_ready');

  const blocked = reasons.some((r) => r.startsWith('invalid_') || ['release_not_certified','authority_not_certified','override_not_ready','degraded_mode_not_ready','reconciliation_incomplete','recovery_not_ready','kill_switch_not_ready'].includes(r));
  const quarantine = !blocked && reasons.some((r) => r.startsWith('duplicate_') || r.startsWith('unknown_domain:') || r.startsWith('unverified_source:') || r.startsWith('incident_open:'));
  const review = !blocked && !quarantine && reasons.length > 0;
  const verdict: ContinuousCommandVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : review ? 'review' : 'certified';
  const commands = verdict === 'certified'
    ? ['maintain_continuous_command_certification']
    : verdict === 'review'
      ? ['request_owner_command_review']
      : verdict === 'quarantine'
        ? ['quarantine_untrusted_command_evidence','isolate_affected_command_domains','keep_payments_and_shipping_disabled']
        : ['freeze_command_execution','block_release_execution','preserve_command_evidence','keep_payments_and_shipping_disabled'];

  const canonical = JSON.stringify({ verdict, reasons: [...reasons].sort(), evidence: [...(Array.isArray(input.evidence) ? input.evidence : [])].map((e) => isRecord(e) ? { ...e } : e).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  return { verdict, reasons, commands, fingerprint: `km74-89-${hash(canonical)}` };
}
