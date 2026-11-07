export type AssuranceDomain = 'privacy' | 'fraud' | 'data_residency' | 'model_governance';
export type AssuranceVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface AssuranceEvidence {
  evidenceId: string;
  domain: AssuranceDomain;
  observedAt: string;
  sourceVerified: boolean;
  controlPassed: boolean;
  ownerApproved: boolean;
  incidentOpen: boolean;
}

export interface EnterpriseAssuranceInput {
  evidence: AssuranceEvidence[];
  now: string;
  maxEvidenceAgeDays: number;
  releaseCertified: boolean;
  accessCertified: boolean;
  killSwitchReady: boolean;
  auditTrailComplete: boolean;
}

export interface EnterpriseAssuranceResult {
  verdict: AssuranceVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly AssuranceDomain[] = ['privacy', 'fraud', 'data_residency', 'model_governance'];
const DAY = 86_400_000;

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (const ch of value) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function certifyEnterpriseAssurance(input: EnterpriseAssuranceInput): EnterpriseAssuranceResult {
  const reasons: string[] = [];
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) reasons.push('invalid_now');
  if (!Number.isFinite(input.maxEvidenceAgeDays) || input.maxEvidenceAgeDays < 0) reasons.push('invalid_max_evidence_age');

  const seenIds = new Set<string>();
  const validDomains = new Set<AssuranceDomain>();
  for (const item of input.evidence) {
    if (!validString(item.evidenceId)) reasons.push('invalid_evidence_id');
    else if (seenIds.has(item.evidenceId)) reasons.push(`duplicate_evidence_id:${item.evidenceId}`);
    else seenIds.add(item.evidenceId);

    if (!DOMAINS.includes(item.domain)) {
      reasons.push(`unknown_domain:${String(item.domain)}`);
      continue;
    }

    const observed = Date.parse(item.observedAt);
    const fresh = Number.isFinite(observed) && Number.isFinite(now) && observed <= now && now - observed <= input.maxEvidenceAgeDays * DAY;
    if (!Number.isFinite(observed)) reasons.push(`invalid_observed_at:${item.evidenceId}`);
    else if (observed > now) reasons.push(`future_evidence:${item.evidenceId}`);
    else if (!fresh) reasons.push(`stale_evidence:${item.evidenceId}`);
    if (!item.sourceVerified) reasons.push(`unverified_source:${item.evidenceId}`);
    if (!item.controlPassed) reasons.push(`control_failed:${item.evidenceId}`);
    if (!item.ownerApproved) reasons.push(`owner_approval_missing:${item.evidenceId}`);
    if (item.incidentOpen) reasons.push(`incident_open:${item.evidenceId}`);
    if (fresh && item.sourceVerified && item.controlPassed && item.ownerApproved && !item.incidentOpen) validDomains.add(item.domain);
  }

  for (const domain of DOMAINS) if (!validDomains.has(domain)) reasons.push(`missing_certified_domain:${domain}`);
  if (!input.releaseCertified) reasons.push('release_not_certified');
  if (!input.accessCertified) reasons.push('access_not_certified');
  if (!input.killSwitchReady) reasons.push('kill_switch_not_ready');
  if (!input.auditTrailComplete) reasons.push('audit_trail_incomplete');

  const blocked = reasons.some((r) => r.startsWith('invalid_') || r === 'release_not_certified' || r === 'access_not_certified' || r === 'kill_switch_not_ready' || r === 'audit_trail_incomplete');
  const quarantine = !blocked && reasons.some((r) => r.startsWith('incident_open:') || r.startsWith('unverified_source:') || r.startsWith('unknown_domain:'));
  const review = !blocked && !quarantine && reasons.length > 0;
  const verdict: AssuranceVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : review ? 'review' : 'certified';
  const commands = verdict === 'certified'
    ? ['maintain_enterprise_assurance']
    : verdict === 'review'
      ? ['request_owner_assurance_review']
      : verdict === 'quarantine'
        ? ['quarantine_untrusted_evidence', 'freeze_affected_integrations', 'keep_payments_and_shipping_disabled']
        : ['freeze_sensitive_operations', 'block_release_execution', 'keep_payments_and_shipping_disabled'];

  const canonical = JSON.stringify({ verdict, reasons: [...reasons].sort(), evidence: [...input.evidence].map((e) => ({ ...e })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)) });
  return { verdict, reasons, commands, fingerprint: `km20-23-${hash(canonical)}` };
}
