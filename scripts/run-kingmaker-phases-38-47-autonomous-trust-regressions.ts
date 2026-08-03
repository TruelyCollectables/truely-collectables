import assert from 'node:assert/strict';
import {
  certifyAutonomousTrust,
  type AutonomousTrustDomain,
  type AutonomousTrustEvidence,
} from '../src/lib/kingmaker-phases-38-47-autonomous-trust';

const domains: AutonomousTrustDomain[] = [
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

const now = '2026-08-03T19:15:00.000Z';
const evidence: AutonomousTrustEvidence[] = domains.map((domain, index) => ({
  evidenceId: `e-${index}`,
  domain,
  observedAt: '2026-08-03T18:15:00.000Z',
  artifactDigest: `sha256:${String(index).padStart(64, '0')}`,
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
  rollbackCertified: true,
  auditTrailComplete: true,
  killSwitchReady: true,
};

const certified = certifyAutonomousTrust(base);
assert.equal(certified.verdict, 'certified');
assert.match(certified.fingerprint, /^km38-47-[0-9a-f]{8}$/);
assert.deepEqual(certified.commands, ['maintain_continuous_certification']);
assert.equal(certifyAutonomousTrust(base).fingerprint, certified.fingerprint);

const missingDomain = certifyAutonomousTrust({ ...base, evidence: evidence.slice(1) });
assert.equal(missingDomain.verdict, 'review');
assert.ok(missingDomain.reasons.includes('missing_certified_domain:delegation'));

const future = certifyAutonomousTrust({
  ...base,
  evidence: [{ ...evidence[0], observedAt: '2027-01-01T00:00:00.000Z' }, ...evidence.slice(1)],
});
assert.equal(future.verdict, 'review');
assert.ok(future.reasons.includes('future_evidence:e-0'));

const duplicateDigestEvidence = evidence.map((item, index) =>
  index === 1 ? { ...item, artifactDigest: evidence[0].artifactDigest } : item,
);
const duplicateDigest = certifyAutonomousTrust({ ...base, evidence: duplicateDigestEvidence });
assert.equal(duplicateDigest.verdict, 'quarantine');
assert.ok(duplicateDigest.reasons.some((reason) => reason.startsWith('duplicate_artifact_digest:')));

const incident = certifyAutonomousTrust({
  ...base,
  evidence: [{ ...evidence[0], incidentOpen: true }, ...evidence.slice(1)],
});
assert.equal(incident.verdict, 'quarantine');
assert.ok(incident.commands.includes('freeze_affected_automation'));

const invalidNow = certifyAutonomousTrust({ ...base, now: 'not-a-date' });
assert.equal(invalidNow.verdict, 'blocked');
assert.ok(invalidNow.commands.includes('freeze_autonomous_execution'));

const releaseBlocked = certifyAutonomousTrust({ ...base, releaseCertified: false });
assert.equal(releaseBlocked.verdict, 'blocked');
assert.ok(releaseBlocked.reasons.includes('release_not_certified'));

const malformed = certifyAutonomousTrust({ ...base, evidence: [null as unknown as AutonomousTrustEvidence, ...evidence] });
assert.equal(malformed.verdict, 'blocked');
assert.ok(malformed.reasons.includes('invalid_evidence'));

console.log('KINGMAKER phases 38-47 autonomous trust regressions passed');
