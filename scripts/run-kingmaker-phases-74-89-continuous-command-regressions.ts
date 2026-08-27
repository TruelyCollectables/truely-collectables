import assert from 'node:assert/strict';
import { certifyContinuousCommand, type ContinuousCommandDomain, type ContinuousCommandInput } from '../src/lib/kingmaker-phases-74-89-continuous-command';

const domains: ContinuousCommandDomain[] = [
  'command_authority','decision_latency','signal_fidelity','policy_convergence','control_coverage','exception_governance','human_override','mission_continuity','degraded_mode','state_reconciliation','execution_idempotency','audit_replay','cross_region_command','counterparty_containment','recovery_orchestration','continuous_recertification',
];
const now = '2026-08-03T20:30:00.000Z';
const evidence = domains.map((domain, index) => ({
  evidenceId: `ev-${index + 1}`,
  artifactDigest: `sha256:${(index + 1).toString(16).padStart(64, '0')}`,
  domain,
  observedAt: '2026-08-03T20:00:00.000Z',
  sourceVerified: true,
  controlPassed: true,
  ownerApproved: true,
  incidentOpen: false,
}));
const baseline: ContinuousCommandInput = {
  evidence, now, maxEvidenceAgeDays: 7,
  releaseCertified: true, authorityCertified: true, overrideReady: true,
  degradedModeReady: true, reconciliationComplete: true, recoveryReady: true, killSwitchReady: true,
};

const certified = certifyContinuousCommand(baseline);
assert.equal(certified.verdict, 'certified');
assert.deepEqual(certified.commands, ['maintain_continuous_command_certification']);
assert.equal(certifyContinuousCommand({ ...baseline, evidence: [...evidence].reverse() }).fingerprint, certified.fingerprint);

const duplicateDigest = evidence.map((item) => ({ ...item }));
duplicateDigest[1].artifactDigest = duplicateDigest[0].artifactDigest;
assert.equal(certifyContinuousCommand({ ...baseline, evidence: duplicateDigest }).verdict, 'quarantine');

const future = evidence.map((item) => ({ ...item }));
future[0].observedAt = '2026-08-04T00:00:00.000Z';
assert.equal(certifyContinuousCommand({ ...baseline, evidence: future }).verdict, 'review');

const incident = evidence.map((item) => ({ ...item }));
incident[0].incidentOpen = true;
assert.equal(certifyContinuousCommand({ ...baseline, evidence: incident }).verdict, 'quarantine');

const stale = evidence.map((item) => ({ ...item }));
stale[0].observedAt = '2026-01-01T00:00:00.000Z';
assert.equal(certifyContinuousCommand({ ...baseline, evidence: stale }).verdict, 'review');

assert.equal(certifyContinuousCommand({ ...baseline, killSwitchReady: false }).verdict, 'blocked');
assert.equal(certifyContinuousCommand({ ...baseline, authorityCertified: false }).verdict, 'blocked');
assert.equal(certifyContinuousCommand({ ...baseline, evidence: [] }).verdict, 'review');

console.log('KINGMAKER phases 74-89 continuous command regressions passed');
