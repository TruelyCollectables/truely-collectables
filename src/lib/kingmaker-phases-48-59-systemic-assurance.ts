export type SystemicAssuranceDomain =
  | 'dependency_graph' | 'blast_radius' | 'supply_continuity' | 'data_lineage'
  | 'contract_integrity' | 'tenant_isolation' | 'regional_failover' | 'queue_integrity'
  | 'event_ordering' | 'reconciliation' | 'evidence_chain' | 'systemic_recovery';

export type SystemicAssuranceVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface SystemicAssuranceEvidence {
  evidenceId: string;
  domain: SystemicAssuranceDomain;
  observedAt: string;
  artifactDigest: string;
  sourceVerified: boolean;
  controlPassed: boolean;
  ownerApproved: boolean;
  incidentOpen: boolean;
}

export interface SystemicAssuranceInput {
  evidence: unknown;
  now: string;
  maxEvidenceAgeDays: number;
  releaseCertified: boolean;
  accessCertified: boolean;
  rollbackCertified: boolean;
  reconciliationCertified: boolean;
  isolationCertified: boolean;
  auditTrailComplete: boolean;
  killSwitchReady: boolean;
}

export interface SystemicAssuranceResult {
  verdict: SystemicAssuranceVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly SystemicAssuranceDomain[] = [
  'dependency_graph','blast_radius','supply_continuity','data_lineage','contract_integrity','tenant_isolation',
  'regional_failover','queue_integrity','event_ordering','reconciliation','evidence_chain','systemic_recovery',
];
const DAY = 86_400_000;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function isEvidence(value: unknown): value is SystemicAssuranceEvidence {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.evidenceId === 'string' && item.evidenceId.trim().length > 0
    && typeof item.domain === 'string' && typeof item.observedAt === 'string'
    && typeof item.artifactDigest === 'string' && typeof item.sourceVerified === 'boolean'
    && typeof item.controlPassed === 'boolean' && typeof item.ownerApproved === 'boolean'
    && typeof item.incidentOpen === 'boolean';
}

export function certifySystemicAssurance(input: SystemicAssuranceInput): SystemicAssuranceResult {
  const reasons: string[] = [];
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) reasons.push('invalid_now');
  if (!Number.isFinite(input.maxEvidenceAgeDays) || input.maxEvidenceAgeDays < 0) reasons.push('invalid_max_evidence_age');
  if (!Array.isArray(input.evidence)) reasons.push('invalid_evidence_collection');

  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const ids = new Set<string>();
  const digests = new Set<string>();
  const validDomains = new Set<SystemicAssuranceDomain>();

  for (const raw of evidence) {
    if (!isEvidence(raw)) { reasons.push('invalid_evidence'); continue; }
    const item = raw;
    if (ids.has(item.evidenceId)) reasons.push(`duplicate_evidence_id:${item.evidenceId}`); else ids.add(item.evidenceId);
    if (!DIGEST.test(item.artifactDigest)) reasons.push(`invalid_artifact_digest:${item.evidenceId}`);
    else if (digests.has(item.artifactDigest)) reasons.push(`duplicate_artifact_digest:${item.artifactDigest}`); else digests.add(item.artifactDigest);
    if (!DOMAINS.includes(item.domain)) { reasons.push(`unknown_domain:${String(item.domain)}`); continue; }

    const observed = Date.parse(item.observedAt);
    const fresh = Number.isFinite(observed) && Number.isFinite(now) && observed <= now && now - observed <= input.maxEvidenceAgeDays * DAY;
    if (!Number.isFinite(observed)) reasons.push(`invalid_observed_at:${item.evidenceId}`);
    else if (observed > now) reasons.push(`future_evidence:${item.evidenceId}`);
    else if (!fresh) reasons.push(`stale_evidence:${item.evidenceId}`);
    if (!item.sourceVerified) reasons.push(`unverified_source:${item.evidenceId}`);
    if (!item.controlPassed) reasons.push(`control_failed:${item.evidenceId}`);
    if (!item.ownerApproved) reasons.push(`owner_approval_missing:${item.evidenceId}`);
    if (item.incidentOpen) reasons.push(`incident_open:${item.evidenceId}`);
    if (fresh && DIGEST.test(item.artifactDigest) && item.sourceVerified && item.controlPassed && item.ownerApproved && !item.incidentOpen) validDomains.add(item.domain);
  }

  for (const domain of DOMAINS) if (!validDomains.has(domain)) reasons.push(`missing_certified_domain:${domain}`);
  if (!input.releaseCertified) reasons.push('release_not_certified');
  if (!input.accessCertified) reasons.push('access_not_certified');
  if (!input.rollbackCertified) reasons.push('rollback_not_certified');
  if (!input.reconciliationCertified) reasons.push('reconciliation_not_certified');
  if (!input.isolationCertified) reasons.push('isolation_not_certified');
  if (!input.auditTrailComplete) reasons.push('audit_trail_incomplete');
  if (!input.killSwitchReady) reasons.push('kill_switch_not_ready');

  const blocked = reasons.some((r) => r.startsWith('invalid_') || ['release_not_certified','access_not_certified','rollback_not_certified','reconciliation_not_certified','isolation_not_certified','audit_trail_incomplete','kill_switch_not_ready'].includes(r));
  const quarantine = !blocked && reasons.some((r) => r.startsWith('incident_open:') || r.startsWith('unverified_source:') || r.startsWith('duplicate_artifact_digest:') || r.startsWith('unknown_domain:'));
  const review = !blocked && !quarantine && reasons.length > 0;
  const verdict: SystemicAssuranceVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : review ? 'review' : 'certified';
  const commands = verdict === 'certified' ? ['maintain_systemic_certification']
    : verdict === 'review' ? ['request_owner_systemic_review']
    : verdict === 'quarantine' ? ['quarantine_systemic_evidence','freeze_affected_dependency_paths','keep_payments_and_shipping_disabled']
    : ['freeze_cross_system_execution','block_release_execution','keep_payments_and_shipping_disabled'];

  const canonical = JSON.stringify({ verdict, reasons: [...reasons].sort(), evidence: evidence.filter(isEvidence).map((e) => ({...e})).sort((a,b) => a.evidenceId.localeCompare(b.evidenceId)) });
  return { verdict, reasons, commands, fingerprint: `km48-59-${hash(canonical)}` };
}
