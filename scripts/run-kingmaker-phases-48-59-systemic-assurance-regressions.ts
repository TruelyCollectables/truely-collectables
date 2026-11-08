import assert from 'node:assert/strict';
import { certifySystemicAssurance, type SystemicAssuranceDomain, type SystemicAssuranceEvidence } from '../src/lib/kingmaker-phases-48-59-systemic-assurance';

const domains: SystemicAssuranceDomain[] = ['dependency_graph','blast_radius','supply_continuity','data_lineage','contract_integrity','tenant_isolation','regional_failover','queue_integrity','event_ordering','reconciliation','evidence_chain','systemic_recovery'];
const now = '2026-08-03T19:30:00.000Z';
const evidence: SystemicAssuranceEvidence[] = domains.map((domain, index) => ({
  evidenceId: `sys-${index}`, domain, observedAt: '2026-08-03T18:30:00.000Z',
  artifactDigest: `sha256:${index.toString(16).padStart(64, '0')}`,
  sourceVerified: true, controlPassed: true, ownerApproved: true, incidentOpen: false,
}));
const base = { evidence, now, maxEvidenceAgeDays: 7, releaseCertified: true, accessCertified: true, rollbackCertified: true, reconciliationCertified: true, isolationCertified: true, auditTrailComplete: true, killSwitchReady: true };

const certified = certifySystemicAssurance(base);
assert.equal(certified.verdict, 'certified');
assert.match(certified.fingerprint, /^km48-59-[0-9a-f]{8}$/);
assert.deepEqual(certified.commands, ['maintain_systemic_certification']);
assert.equal(certifySystemicAssurance(base).fingerprint, certified.fingerprint);

const missing = certifySystemicAssurance({ ...base, evidence: evidence.slice(1) });
assert.equal(missing.verdict, 'review');
assert.ok(missing.reasons.includes('missing_certified_domain:dependency_graph'));

const collision = certifySystemicAssurance({ ...base, evidence: evidence.map((item, index) => index === 1 ? { ...item, artifactDigest: evidence[0].artifactDigest } : item) });
assert.equal(collision.verdict, 'quarantine');
assert.ok(collision.commands.includes('freeze_affected_dependency_paths'));

const incident = certifySystemicAssurance({ ...base, evidence: evidence.map((item, index) => index === 0 ? { ...item, incidentOpen: true } : item) });
assert.equal(incident.verdict, 'quarantine');

const stale = certifySystemicAssurance({ ...base, evidence: evidence.map((item, index) => index === 0 ? { ...item, observedAt: '2025-01-01T00:00:00.000Z' } : item) });
assert.equal(stale.verdict, 'review');

const blocked = certifySystemicAssurance({ ...base, isolationCertified: false });
assert.equal(blocked.verdict, 'blocked');
assert.ok(blocked.commands.includes('freeze_cross_system_execution'));

const malformed = certifySystemicAssurance({ ...base, evidence: [null, ...evidence] });
assert.equal(malformed.verdict, 'blocked');
assert.ok(malformed.reasons.includes('invalid_evidence'));

console.log('KINGMAKER phases 48-59 systemic assurance regressions passed');
