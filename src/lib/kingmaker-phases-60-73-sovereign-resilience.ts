export type SovereignResilienceDomain =
  | 'jurisdiction_control'
  | 'key_sovereignty'
  | 'identity_sovereignty'
  | 'data_portability'
  | 'vendor_exit'
  | 'offline_continuity'
  | 'control_plane_recovery'
  | 'evidence_independence'
  | 'clock_integrity'
  | 'configuration_escrow'
  | 'operator_separation'
  | 'regulatory_continuity'
  | 'critical_dependency_substitution'
  | 'sovereign_reconstitution';

export type SovereignResilienceVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface SovereignResilienceEvidence {
  evidenceId: string;
  domain: SovereignResilienceDomain;
  observedAt: string;
  artifactDigest: string;
  sourceVerified: boolean;
  controlPassed: boolean;
  ownerApproved: boolean;
  incidentOpen: boolean;
}

export interface SovereignResilienceInput {
  evidence: SovereignResilienceEvidence[];
  now: string;
  maxEvidenceAgeDays: number;
  releaseCertified: boolean;
  accessCertified: boolean;
  recoveryCertified: boolean;
  portabilityCertified: boolean;
  independenceCertified: boolean;
  auditTrailComplete: boolean;
  killSwitchReady: boolean;
}

export interface SovereignResilienceResult {
  verdict: SovereignResilienceVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly SovereignResilienceDomain[] = [
  'jurisdiction_control','key_sovereignty','identity_sovereignty','data_portability','vendor_exit','offline_continuity','control_plane_recovery','evidence_independence','clock_integrity','configuration_escrow','operator_separation','regulatory_continuity','critical_dependency_substitution','sovereign_reconstitution',
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

export function certifySovereignResilience(input: SovereignResilienceInput): SovereignResilienceResult {
  const reasons: string[] = [];
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) reasons.push('invalid_now');
  if (!Number.isFinite(input.maxEvidenceAgeDays) || input.maxEvidenceAgeDays < 0) reasons.push('invalid_max_evidence_age');
  if (!Array.isArray(input.evidence)) reasons.push('invalid_evidence_collection');

  const ids = new Set<string>();
  const digests = new Set<string>();
  const certifiedDomains = new Set<SovereignResilienceDomain>();

  for (const raw of Array.isArray(input.evidence) ? input.evidence : []) {
    if (!isRecord(raw)) { reasons.push('invalid_evidence'); continue; }
    const item = raw as unknown as SovereignResilienceEvidence;
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
    if (fresh && item.sourceVerified === true && item.controlPassed === true && item.ownerApproved === true && item.incidentOpen !== true) certifiedDomains.add(item.domain);
  }

  for (const domain of DOMAINS) if (!certifiedDomains.has(domain)) reasons.push(`missing_certified_domain:${domain}`);
  if (!input.releaseCertified) reasons.push('release_not_certified');
  if (!input.accessCertified) reasons.push('access_not_certified');
  if (!input.recoveryCertified) reasons.push('recovery_not_certified');
  if (!input.portabilityCertified) reasons.push('portability_not_certified');
  if (!input.independenceCertified) reasons.push('independence_not_certified');
  if (!input.auditTrailComplete) reasons.push('audit_trail_incomplete');
  if (!input.killSwitchReady) reasons.push('kill_switch_not_ready');

  const blocked = reasons.some((r) => r.startsWith('invalid_') || ['release_not_certified','access_not_certified','recovery_not_certified','portability_not_certified','independence_not_certified','audit_trail_incomplete','kill_switch_not_ready'].includes(r));
  const quarantine = !blocked && reasons.some((r) => r.startsWith('duplicate_') || r.startsWith('unknown_domain:') || r.startsWith('unverified_source:') || r.startsWith('incident_open:'));
  const review = !blocked && !quarantine && reasons.length > 0;
  const verdict: SovereignResilienceVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : review ? 'review' : 'certified';
  const commands = verdict === 'certified'
    ? ['maintain_sovereign_resilience']
    : verdict === 'review'
      ? ['request_owner_sovereign_review']
      : verdict === 'quarantine'
        ? ['quarantine_untrusted_sovereign_evidence','isolate_affected_control_planes','keep_payments_and_shipping_disabled']
        : ['freeze_sovereign_execution','block_release_execution','preserve_recovery_evidence','keep_payments_and_shipping_disabled'];

  const canonical = JSON.stringify({ verdict, reasons: [...reasons].sort(), evidence: [...(Array.isArray(input.evidence) ? input.evidence : [])].map((e) => isRecord(e) ? { ...e } : e).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  return { verdict, reasons, commands, fingerprint: `km60-73-${hash(canonical)}` };
}
