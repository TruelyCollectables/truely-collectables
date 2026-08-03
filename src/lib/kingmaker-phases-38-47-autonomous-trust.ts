export type AutonomousTrustDomain =
  | 'delegation'
  | 'human_oversight'
  | 'decision_traceability'
  | 'tool_authorization'
  | 'data_minimization'
  | 'rate_and_scope_limits'
  | 'rollback_readiness'
  | 'cross_system_consistency'
  | 'exception_governance'
  | 'continuous_certification';

export type AutonomousTrustVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface AutonomousTrustEvidence {
  evidenceId: string;
  domain: AutonomousTrustDomain;
  observedAt: string;
  artifactDigest: string;
  sourceVerified: boolean;
  controlPassed: boolean;
  ownerApproved: boolean;
  incidentOpen: boolean;
}

export interface AutonomousTrustInput {
  evidence: AutonomousTrustEvidence[];
  now: string;
  maxEvidenceAgeDays: number;
  releaseCertified: boolean;
  accessCertified: boolean;
  rollbackCertified: boolean;
  auditTrailComplete: boolean;
  killSwitchReady: boolean;
}

export interface AutonomousTrustResult {
  verdict: AutonomousTrustVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly AutonomousTrustDomain[] = [
  'delegation',
  'human_oversight',
  'decision_traceability',
  'tool_authorization',
  'data_minimization',
  'rate_and_scope_limits',
  'rollback_readiness',
  'cross_system_consistency',
  'exception_governance',
  'continuous_certification',
];
const DAY = 86_400_000;

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (const ch of value) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function certifyAutonomousTrust(input: AutonomousTrustInput): AutonomousTrustResult {
  const reasons: string[] = [];
  if (!input || !Array.isArray(input.evidence)) {
    return {
      verdict: 'blocked',
      reasons: ['invalid_input'],
      commands: ['freeze_autonomous_execution', 'block_release_execution', 'require_owner_review'],
      fingerprint: 'km38-47-invalid',
    };
  }

  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) reasons.push('invalid_now');
  if (!Number.isFinite(input.maxEvidenceAgeDays) || input.maxEvidenceAgeDays < 0) reasons.push('invalid_max_evidence_age');

  const ids = new Set<string>();
  const digests = new Set<string>();
  const certified = new Set<AutonomousTrustDomain>();

  for (const item of input.evidence) {
    if (!item || typeof item !== 'object') {
      reasons.push('invalid_evidence');
      continue;
    }
    if (!nonEmpty(item.evidenceId)) reasons.push('invalid_evidence_id');
    else if (ids.has(item.evidenceId)) reasons.push(`duplicate_evidence_id:${item.evidenceId}`);
    else ids.add(item.evidenceId);

    if (!nonEmpty(item.artifactDigest)) reasons.push(`invalid_artifact_digest:${item.evidenceId}`);
    else if (digests.has(item.artifactDigest)) reasons.push(`duplicate_artifact_digest:${item.artifactDigest}`);
    else digests.add(item.artifactDigest);

    if (!DOMAINS.includes(item.domain)) {
      reasons.push(`unknown_domain:${String(item.domain)}`);
      continue;
    }

    const observed = Date.parse(item.observedAt);
    const fresh = Number.isFinite(now) && Number.isFinite(observed) && observed <= now && now - observed <= input.maxEvidenceAgeDays * DAY;
    if (!Number.isFinite(observed)) reasons.push(`invalid_observed_at:${item.evidenceId}`);
    else if (observed > now) reasons.push(`future_evidence:${item.evidenceId}`);
    else if (!fresh) reasons.push(`stale_evidence:${item.evidenceId}`);
    if (!item.sourceVerified) reasons.push(`unverified_source:${item.evidenceId}`);
    if (!item.controlPassed) reasons.push(`control_failed:${item.evidenceId}`);
    if (!item.ownerApproved) reasons.push(`owner_approval_missing:${item.evidenceId}`);
    if (item.incidentOpen) reasons.push(`incident_open:${item.evidenceId}`);
    if (fresh && item.sourceVerified && item.controlPassed && item.ownerApproved && !item.incidentOpen) certified.add(item.domain);
  }

  for (const domain of DOMAINS) if (!certified.has(domain)) reasons.push(`missing_certified_domain:${domain}`);
  if (!input.releaseCertified) reasons.push('release_not_certified');
  if (!input.accessCertified) reasons.push('access_not_certified');
  if (!input.rollbackCertified) reasons.push('rollback_not_certified');
  if (!input.auditTrailComplete) reasons.push('audit_trail_incomplete');
  if (!input.killSwitchReady) reasons.push('kill_switch_not_ready');

  const blocked = reasons.some((reason) =>
    reason.startsWith('invalid_') ||
    reason === 'release_not_certified' ||
    reason === 'access_not_certified' ||
    reason === 'rollback_not_certified' ||
    reason === 'audit_trail_incomplete' ||
    reason === 'kill_switch_not_ready',
  );
  const quarantine = !blocked && reasons.some((reason) =>
    reason.startsWith('incident_open:') ||
    reason.startsWith('unverified_source:') ||
    reason.startsWith('unknown_domain:') ||
    reason.startsWith('duplicate_artifact_digest:'),
  );
  const review = !blocked && !quarantine && reasons.length > 0;
  const verdict: AutonomousTrustVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : review ? 'review' : 'certified';
  const commands = verdict === 'certified'
    ? ['maintain_continuous_certification']
    : verdict === 'review'
      ? ['pause_affected_automation', 'request_owner_review']
      : verdict === 'quarantine'
        ? ['quarantine_untrusted_evidence', 'freeze_affected_automation', 'require_owner_review']
        : ['freeze_autonomous_execution', 'block_release_execution', 'require_owner_review'];

  const canonical = JSON.stringify({
    verdict,
    reasons: [...reasons].sort(),
    evidence: [...input.evidence]
      .map((item) => ({ ...item }))
      .sort((a, b) => String(a.evidenceId).localeCompare(String(b.evidenceId))),
  });
  return { verdict, reasons, commands, fingerprint: `km38-47-${hash(canonical)}` };
}
