import assert from 'node:assert/strict';
import { certifyEnterpriseAssurance, type EnterpriseAssuranceInput } from '../src/lib/kingmaker-phases-20-23-enterprise-assurance';

const now = '2026-08-03T18:30:00.000Z';
const domains = ['privacy', 'fraud', 'data_residency', 'model_governance'] as const;
const base: EnterpriseAssuranceInput = {
  now,
  maxEvidenceAgeDays: 30,
  releaseCertified: true,
  accessCertified: true,
  killSwitchReady: true,
  auditTrailComplete: true,
  evidence: domains.map((domain, index) => ({
    evidenceId: `e-${index + 1}`,
    domain,
    observedAt: '2026-08-01T00:00:00.000Z',
    sourceVerified: true,
    controlPassed: true,
    ownerApproved: true,
    incidentOpen: false,
  })),
};

assert.equal(certifyEnterpriseAssurance(base).verdict, 'certified');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: [...base.evidence].reverse() }).fingerprint, certifyEnterpriseAssurance(base).fingerprint);
assert.equal(certifyEnterpriseAssurance({ ...base, releaseCertified: false }).verdict, 'blocked');
assert.equal(certifyEnterpriseAssurance({ ...base, accessCertified: false }).verdict, 'blocked');
assert.equal(certifyEnterpriseAssurance({ ...base, killSwitchReady: false }).verdict, 'blocked');
assert.equal(certifyEnterpriseAssurance({ ...base, auditTrailComplete: false }).verdict, 'blocked');
assert.equal(certifyEnterpriseAssurance({ ...base, maxEvidenceAgeDays: Number.NaN }).verdict, 'blocked');
assert.equal(certifyEnterpriseAssurance({ ...base, now: 'bad-date' }).verdict, 'blocked');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: base.evidence.slice(1) }).verdict, 'review');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: base.evidence.map((e, i) => i === 0 ? { ...e, incidentOpen: true } : e) }).verdict, 'quarantine');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: base.evidence.map((e, i) => i === 0 ? { ...e, sourceVerified: false } : e) }).verdict, 'quarantine');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: base.evidence.map((e, i) => i === 0 ? { ...e, controlPassed: false } : e) }).verdict, 'review');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: base.evidence.map((e, i) => i === 0 ? { ...e, ownerApproved: false } : e) }).verdict, 'review');
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: [...base.evidence, { ...base.evidence[0], domain: 'fraud' }] }).reasons.some((r) => r.startsWith('duplicate_evidence_id:')), true);
assert.equal(certifyEnterpriseAssurance({ ...base, evidence: base.evidence.map((e, i) => i === 0 ? { ...e, observedAt: '2027-01-01T00:00:00.000Z' } : e) }).reasons.some((r) => r.startsWith('future_evidence:')), true);

console.log('KINGMAKER phases 20-23 enterprise assurance regressions passed');
