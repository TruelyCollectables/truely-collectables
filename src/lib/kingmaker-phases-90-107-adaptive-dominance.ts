export type AdaptiveDominanceDomain =
  | 'threat_anticipation' | 'market_adaptation' | 'capacity_forecasting' | 'control_learning'
  | 'decision_calibration' | 'anomaly_containment' | 'resilience_simulation' | 'policy_evolution'
  | 'operator_readiness' | 'supplier_adaptation' | 'liquidity_resilience' | 'inventory_resilience'
  | 'fraud_adaptation' | 'privacy_adaptation' | 'regional_adaptation' | 'model_recertification'
  | 'recovery_learning' | 'strategic_reconstitution';

export type AdaptiveDominanceVerdict = 'certified' | 'review' | 'quarantine' | 'blocked';

export interface AdaptiveDominanceEvidence {
  evidenceId: string;
  artifactDigest: string;
  domain: AdaptiveDominanceDomain;
  observedAt: string;
  sourceVerified: boolean;
  controlPassed: boolean;
  ownerApproved: boolean;
  incidentOpen: boolean;
}

export interface AdaptiveDominanceInput {
  evidence: AdaptiveDominanceEvidence[];
  now: string;
  maxEvidenceAgeDays: number;
  releaseCertified: boolean;
  learningCertified: boolean;
  simulationCertified: boolean;
  liquidityProtected: boolean;
  inventoryProtected: boolean;
  recoveryReady: boolean;
  killSwitchReady: boolean;
}

export interface AdaptiveDominanceResult {
  verdict: AdaptiveDominanceVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
}

const DOMAINS: readonly AdaptiveDominanceDomain[] = [
  'threat_anticipation','market_adaptation','capacity_forecasting','control_learning','decision_calibration','anomaly_containment','resilience_simulation','policy_evolution','operator_readiness','supplier_adaptation','liquidity_resilience','inventory_resilience','fraud_adaptation','privacy_adaptation','regional_adaptation','model_recertification','recovery_learning','strategic_reconstitution',
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

export function certifyAdaptiveDominance(input: AdaptiveDominanceInput): AdaptiveDominanceResult {
  const reasons: string[] = [];
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) reasons.push('invalid_now');
  if (!Number.isFinite(input.maxEvidenceAgeDays) || input.maxEvidenceAgeDays < 0) reasons.push('invalid_max_evidence_age');
  if (!Array.isArray(input.evidence)) reasons.push('invalid_evidence_collection');

  const ids = new Set<string>();
  const digests = new Set<string>();
  const certified = new Set<AdaptiveDominanceDomain>();

  for (const raw of Array.isArray(input.evidence) ? input.evidence : []) {
    if (!isRecord(raw)) { reasons.push('invalid_evidence'); continue; }
    const item = raw as unknown as AdaptiveDominanceEvidence;
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
  if (!input.learningCertified) reasons.push('learning_not_certified');
  if (!input.simulationCertified) reasons.push('simulation_not_certified');
  if (!input.liquidityProtected) reasons.push('liquidity_not_protected');
  if (!input.inventoryProtected) reasons.push('inventory_not_protected');
  if (!input.recoveryReady) reasons.push('recovery_not_ready');
  if (!input.killSwitchReady) reasons.push('kill_switch_not_ready');

  const blocked = reasons.some((r) => r.startsWith('invalid_') || ['release_not_certified','learning_not_certified','simulation_not_certified','liquidity_not_protected','inventory_not_protected','recovery_not_ready','kill_switch_not_ready'].includes(r));
  const quarantine = !blocked && reasons.some((r) => r.startsWith('duplicate_') || r.startsWith('unknown_domain:') || r.startsWith('unverified_source:') || r.startsWith('incident_open:'));
  const review = !blocked && !quarantine && reasons.length > 0;
  const verdict: AdaptiveDominanceVerdict = blocked ? 'blocked' : quarantine ? 'quarantine' : review ? 'review' : 'certified';
  const commands = verdict === 'certified'
    ? ['maintain_adaptive_dominance_certification']
    : verdict === 'review'
      ? ['request_owner_adaptive_review']
      : verdict === 'quarantine'
        ? ['quarantine_untrusted_adaptive_evidence','isolate_affected_adaptive_domains','keep_payments_and_shipping_disabled']
        : ['freeze_adaptive_execution','block_release_execution','preserve_adaptive_evidence','keep_payments_and_shipping_disabled'];

  const canonical = JSON.stringify({ verdict, reasons: [...reasons].sort(), evidence: [...(Array.isArray(input.evidence) ? input.evidence : [])].map((e) => isRecord(e) ? { ...e } : e).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  return { verdict, reasons, commands, fingerprint: `km90-107-${hash(canonical)}` };
}
