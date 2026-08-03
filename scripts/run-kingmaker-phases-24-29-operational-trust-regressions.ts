import assert from 'node:assert/strict';
import { certifyOperationalTrust, type OperationalTrustDomain } from '../src/lib/kingmaker-phases-24-29-operational-trust';

const now = '2026-08-03T18:45:00Z';
const domains: OperationalTrustDomain[] = [
  'incident_response', 'observability', 'change_management',
  'capacity_resilience', 'customer_protection', 'financial_controls',
];
const goodEvidence = domains.map((domain, index) => ({
  evidenceId: `e-${index}`,
  domain,
  observedAt: '2026-08-03T18:00:00Z',
  sourceVerified: true,
  controlPassed: true,
  ownerApproved: true,
  incidentOpen: false,
  artifactDigest: `sha256:${String(index).padStart(64, 'a')}`,
}));
const base = {
  evidence: goodEvidence,
  now,
  maxEvidenceAgeDays: 7,
  releaseCertified: true,
  privilegedAccessCertified: true,
  rollbackReady: true,
  customerImpactBounded: true,
  financialReconciliationComplete: true,
  killSwitchReady: true,
};

assert.equal(certifyOperationalTrust(base).verdict, 'certified');
assert.equal(certifyOperationalTrust({ ...base, evidence: null }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, now: 'not-a-date' }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, maxEvidenceAgeDays: Number.NaN }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, maxEvidenceAgeDays: Number.POSITIVE_INFINITY }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, releaseCertified: 'true' }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, rollbackReady: false }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, customerImpactBounded: false }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, financialReconciliationComplete: false }).verdict, 'blocked');
assert.equal(certifyOperationalTrust({ ...base, killSwitchReady: false }).verdict, 'blocked');

const future = structuredClone(goodEvidence);
future[0].observedAt = '2026-08-04T18:00:00Z';
assert.equal(certifyOperationalTrust({ ...base, evidence: future }).verdict, 'review');
const stale = structuredClone(goodEvidence);
stale[0].observedAt = '2026-01-01T00:00:00Z';
assert.equal(certifyOperationalTrust({ ...base, evidence: stale }).verdict, 'review');
const unknown = structuredClone(goodEvidence) as Array<Record<string, unknown>>;
unknown[0].domain = 'surprise';
assert.equal(certifyOperationalTrust({ ...base, evidence: unknown }).verdict, 'quarantine');
const malformed = structuredClone(goodEvidence) as Array<Record<string, unknown>>;
malformed[0].ownerApproved = 'yes';
assert.equal(certifyOperationalTrust({ ...base, evidence: malformed }).verdict, 'blocked');
const duplicateId = [...goodEvidence, { ...goodEvidence[0], domain: 'observability' as const, artifactDigest: 'sha256:unique' }];
assert.equal(certifyOperationalTrust({ ...base, evidence: duplicateId }).verdict, 'quarantine');
const duplicateDigest = structuredClone(goodEvidence);
duplicateDigest[1].artifactDigest = duplicateDigest[0].artifactDigest;
assert.equal(certifyOperationalTrust({ ...base, evidence: duplicateDigest }).verdict, 'quarantine');
const incident = structuredClone(goodEvidence);
incident[0].incidentOpen = true;
assert.equal(certifyOperationalTrust({ ...base, evidence: incident }).verdict, 'quarantine');
const unverified = structuredClone(goodEvidence);
unverified[0].sourceVerified = false;
assert.equal(certifyOperationalTrust({ ...base, evidence: unverified }).verdict, 'quarantine');
const missing = goodEvidence.slice(1);
assert.equal(certifyOperationalTrust({ ...base, evidence: missing }).verdict, 'review');
assert.equal(certifyOperationalTrust(base).fingerprint, certifyOperationalTrust({ ...base, evidence: [...goodEvidence].reverse() }).fingerprint);

console.log('KINGMAKER phases 24-29 operational trust regressions passed');
