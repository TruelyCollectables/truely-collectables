import assert from 'node:assert/strict';
import { certifyAdaptiveDominance, type AdaptiveDominanceDomain, type AdaptiveDominanceInput } from '../src/lib/kingmaker-phases-90-107-adaptive-dominance';

const domains: AdaptiveDominanceDomain[] = [
  'threat_anticipation','market_adaptation','capacity_forecasting','control_learning','decision_calibration','anomaly_containment','resilience_simulation','policy_evolution','operator_readiness','supplier_adaptation','liquidity_resilience','inventory_resilience','fraud_adaptation','privacy_adaptation','regional_adaptation','model_recertification','recovery_learning','strategic_reconstitution',
];
const evidence = domains.map((domain, index) => ({
  evidenceId: `ev-${index + 1}`,
  artifactDigest: `sha256:${(index + 1).toString(16).padStart(64, '0')}`,
  domain,
  observedAt: '2026-08-03T20:30:00.000Z',
  sourceVerified: true,
  controlPassed: true,
  ownerApproved: true,
  incidentOpen: false,
}));
const baseline: AdaptiveDominanceInput = {
  evidence,
  now: '2026-08-03T21:00:00.000Z',
  maxEvidenceAgeDays: 7,
  releaseCertified: true,
  learningCertified: true,
  simulationCertified: true,
  liquidityProtected: true,
  inventoryProtected: true,
  recoveryReady: true,
  killSwitchReady: true,
};

const certified = certifyAdaptiveDominance(baseline);
assert.equal(certified.verdict, 'certified');
assert.deepEqual(certified.commands, ['maintain_adaptive_dominance_certification']);
assert.equal(certifyAdaptiveDominance({ ...baseline, evidence: [...evidence].reverse() }).fingerprint, certified.fingerprint);

const duplicate = evidence.map((item) => ({ ...item }));
duplicate[1].artifactDigest = duplicate[0].artifactDigest;
assert.equal(certifyAdaptiveDominance({ ...baseline, evidence: duplicate }).verdict, 'quarantine');

const incident = evidence.map((item) => ({ ...item }));
incident[0].incidentOpen = true;
assert.equal(certifyAdaptiveDominance({ ...baseline, evidence: incident }).verdict, 'quarantine');

const stale = evidence.map((item) => ({ ...item }));
stale[0].observedAt = '2026-01-01T00:00:00.000Z';
assert.equal(certifyAdaptiveDominance({ ...baseline, evidence: stale }).verdict, 'review');

assert.equal(certifyAdaptiveDominance({ ...baseline, liquidityProtected: false }).verdict, 'blocked');
assert.equal(certifyAdaptiveDominance({ ...baseline, inventoryProtected: false }).verdict, 'blocked');
assert.equal(certifyAdaptiveDominance({ ...baseline, killSwitchReady: false }).verdict, 'blocked');
assert.equal(certifyAdaptiveDominance({ ...baseline, evidence: [] }).verdict, 'review');

console.log('KINGMAKER phases 90-107 adaptive dominance regressions passed');
