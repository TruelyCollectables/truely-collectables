import assert from 'node:assert/strict';
import {
  certifySovereignResilience,
  type SovereignResilienceDomain,
  type SovereignResilienceEvidence,
} from '../src/lib/kingmaker-phases-60-73-sovereign-resilience';

const domains: SovereignResilienceDomain[] = [
  'jurisdiction_control','key_sovereignty','identity_sovereignty','data_portability','vendor_exit','offline_continuity','control_plane_recovery','evidence_independence','clock_integrity','configuration_escrow','operator_separation','regulatory_continuity','critical_dependency_substitution','sovereign_reconstitution',
];
const now = '2026-08-03T20:00:00.000Z';
const evidence: SovereignResilienceEvidence[] = domains.map((domain, index) => ({
  evidenceId: `sr-${index}`,
  domain,
  observedAt: '2026-08-03T19:00:00.000Z',
  artifactDigest: `sha256:${index.toString(16).padStart(64, '0')}`,
  sourceVerified: true,
  controlPassed: true,
  ownerApproved: true,
  incidentOpen: false,
}));
const base = {
  evidence,
  now,
  maxEvidenceAgeDays: 7,
  releaseCertified: true,
  accessCertified: true,
  recoveryCertified: true,
  portabilityCertified: true,
  independenceCertified: true,
  auditTrailComplete: true,
  killSwitchReady: true,
};

const certified = certifySovereignResilience(base);
assert.equal(certified.verdict, 'certified');
assert.match(certified.fingerprint, /^km60-73-[0-9a-f]{8}$/);
assert.deepEqual(certified.commands, ['maintain_sovereign_resilience']);
assert.equal(certifySovereignResilience(base).fingerprint, certified.fingerprint);

const missing = certifySovereignResilience({ ...base, evidence: evidence.slice(1) });
assert.equal(missing.verdict, 'review');
assert.ok(missing.reasons.includes('missing_certified_domain:jurisdiction_control'));

const duplicateDigest = certifySovereignResilience({
  ...base,
  evidence: evidence.map((item, index) => index === 1 ? { ...item, artifactDigest: evidence[0].artifactDigest } : item),
});
assert.equal(duplicateDigest.verdict, 'quarantine');
assert.ok(duplicateDigest.reasons.some((reason) => reason.startsWith('duplicate_artifact_digest:')));

const incident = certifySovereignResilience({ ...base, evidence: evidence.map((item, index) => index === 0 ? { ...item, incidentOpen: true } : item) });
assert.equal(incident.verdict, 'quarantine');
assert.ok(incident.commands.includes('isolate_affected_control_planes'));

const stale = certifySovereignResilience({ ...base, evidence: evidence.map((item, index) => index === 0 ? { ...item, observedAt: '2025-01-01T00:00:00.000Z' } : item) });
assert.equal(stale.verdict, 'review');
assert.ok(stale.reasons.includes('stale_evidence:sr-0'));

const blocked = certifySovereignResilience({ ...base, portabilityCertified: false });
assert.equal(blocked.verdict, 'blocked');
assert.ok(blocked.commands.includes('freeze_sovereign_execution'));

const malformed = certifySovereignResilience({ ...base, evidence: [null as unknown as SovereignResilienceEvidence, ...evidence] });
assert.equal(malformed.verdict, 'blocked');
assert.ok(malformed.reasons.includes('invalid_evidence'));

console.log('KINGMAKER phases 60-73 sovereign resilience regressions passed');
