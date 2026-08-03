export type OperationalTrustDomain =
  | 'incident_response'
  | 'observability'
  | 'change_management'
  | 'capacity_resilience'
  | 'customer_protection'
  | 'financial_controls';
export type OperationalTrustVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface OperationalTrustEvidence {
  evidenceId: unknown;
  domain: unknown;
  observedAt: unknown;
  sourceVerified: unknown;
  controlPassed: unknown;
  ownerApproved: unknown;
  incidentOpen: unknown;
  artifactDigest: unknown;
}

export interface OperationalTrustInput {
  evidence: unknown;
  now: unknown;
  maxEvidenceAgeDays: unknown;
  releaseCertified: unknown;
  privilegedAccessCertified: unknown;
  rollbackReady: unknown;
  customerImpactBounded: unknown;
  financialReconciliationComplete: unknown;
  killSwitchReady: unknown;
}

export interface OperationalTrustResult {
  verdict: OperationalTrustVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly OperationalTrustDomain[] = [
  'incident_response', 'observability', 'change_management',
  'capacity_resilience', 'customer_protection', 'financial_controls',
];
const DAY_MS = 86_400_000;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function bool(value: unknown): value is boolean { return typeof value === 'boolean'; }
function strictTime(value: unknown): number | null {
  const s = text(value);
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)) return null;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function certifyOperationalTrust(input: OperationalTrustInput): OperationalTrustResult {
  const reasons: string[] = [];
  const now = strictTime(input?.now);
  const maxAge = typeof input?.maxEvidenceAgeDays === 'number' && Number.isFinite(input.maxEvidenceAgeDays) && input.maxEvidenceAgeDays >= 0
    ? input.maxEvidenceAgeDays : null;
  if (now === null) reasons.push('invalid_now');
  if (maxAge === null) reasons.push('invalid_max_evidence_age');

  const evidence = Array.isArray(input?.evidence) ? input.evidence as OperationalTrustEvidence[] : [];
  if (!Array.isArray(input?.evidence)) reasons.push('invalid_evidence_collection');
  const ids = new Set<string>();
  const digests = new Set<string>();
  const certified = new Set<OperationalTrustDomain>();

  for (const raw of evidence) {
    if (!raw || typeof raw !== 'object') { reasons.push('invalid_evidence_shape'); continue; }
    const id = text(raw.evidenceId);
    const digest = text(raw.artifactDigest);
    if (!id) reasons.push('invalid_evidence_id');
    else if (ids.has(id)) reasons.push(`duplicate_evidence_id:${id}`);
    else ids.add(id);
    if (!digest) reasons.push(`invalid_artifact_digest:${id ?? 'unknown'}`);
    else if (digests.has(digest)) reasons.push(`duplicate_artifact_digest:${digest}`);
    else digests.add(digest);

    if (typeof raw.domain !== 'string' || !DOMAINS.includes(raw.domain as OperationalTrustDomain)) {
      reasons.push(`unknown_domain:${String(raw.domain)}`); continue;
    }
    const domain = raw.domain as OperationalTrustDomain;
    const observed = strictTime(raw.observedAt);
    const future = observed !== null && now !== null && observed > now;
    const stale = observed !== null && now !== null && maxAge !== null && now - observed > maxAge * DAY_MS;
    if (observed === null) reasons.push(`invalid_observed_at:${id ?? 'unknown'}`);
    if (future) reasons.push(`future_evidence:${id ?? 'unknown'}`);
    if (stale) reasons.push(`stale_evidence:${id ?? 'unknown'}`);
    for (const [name, value] of [['source_verified', raw.sourceVerified], ['control_passed', raw.controlPassed], ['owner_approved', raw.ownerApproved], ['incident_open', raw.incidentOpen]] as const) {
      if (!bool(value)) reasons.push(`invalid_${name}:${id ?? 'unknown'}`);
    }
    if (raw.sourceVerified === false) reasons.push(`unverified_source:${id ?? 'unknown'}`);
    if (raw.controlPassed === false) reasons.push(`control_failed:${id ?? 'unknown'}`);
    if (raw.ownerApproved === false) reasons.push(`owner_approval_missing:${id ?? 'unknown'}`);
    if (raw.incidentOpen === true) reasons.push(`incident_open:${id ?? 'unknown'}`);
    if (observed !== null && !future && !stale && raw.sourceVerified === true && raw.controlPassed === true && raw.ownerApproved === true && raw.incidentOpen === false && digest) certified.add(domain);
  }

  for (const domain of DOMAINS) if (!certified.has(domain)) reasons.push(`missing_certified_domain:${domain}`);
  const gates: Array<[string, unknown]> = [
    ['release_not_certified', input?.releaseCertified],
    ['privileged_access_not_certified', input?.privilegedAccessCertified],
    ['rollback_not_ready', input?.rollbackReady],
    ['customer_impact_not_bounded', input?.customerImpactBounded],
    ['financial_reconciliation_incomplete', input?.financialReconciliationComplete],
    ['kill_switch_not_ready', input?.killSwitchReady],
  ];
  for (const [reason, value] of gates) {
    if (!bool(value)) reasons.push(`invalid_gate:${reason}`);
    else if (!value) reasons.push(reason);
  }

  const blocked = reasons.some((r) => r.startsWith('invalid_') || r.includes('not_certified') || r.includes('not_ready') || r.includes('incomplete') || r === 'customer_impact_not_bounded');
  const quarantine = !blocked && reasons.some((r) => r.startsWith('incident_open:') || r.startsWith('unverified_source:') || r.startsWith('unknown_domain:') || r.startsWith('duplicate_'));
  const verdict: OperationalTrustVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : reasons.length ? 'review' : 'certified';
  const commands = verdict === 'certified' ? ['maintain_operational_trust']
    : verdict === 'review' ? ['request_owner_operational_review']
    : verdict === 'quarantine' ? ['quarantine_affected_evidence', 'freeze_affected_integrations', 'keep_money_and_fulfillment_disabled']
    : ['freeze_sensitive_operations', 'block_release_execution', 'keep_money_and_fulfillment_disabled'];
  const canonical = JSON.stringify({ verdict, reasons: [...new Set(reasons)].sort(), ids: [...ids].sort(), digests: [...digests].sort() });
  return { verdict, reasons: [...new Set(reasons)], commands, fingerprint: `km24-29-${hash(canonical)}` };
}
