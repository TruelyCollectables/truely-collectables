import assert from "node:assert/strict";
import {
  certifyChaosResilience,
  type ChaosScenario,
} from "../src/lib/kingmaker-phase-14-resilience-chaos-certification";

const scenarios: ChaosScenario[] = [
  { id: "stripe-timeout", faultClass: "dependency", required: true, injected: true, detected: true, contained: true, recovered: true, dataLoss: 0, duplicateEffects: 0, unauthorizedEffects: 0, recoverySeconds: 40, maxRecoverySeconds: 60 },
  { id: "supabase-failover", faultClass: "database", required: true, injected: true, detected: true, contained: true, recovered: true, dataLoss: 0, duplicateEffects: 0, unauthorizedEffects: 0, recoverySeconds: 90, maxRecoverySeconds: 120 },
  { id: "queue-replay", faultClass: "queue", required: true, injected: true, detected: true, contained: true, recovered: true, dataLoss: 0, duplicateEffects: 0, unauthorizedEffects: 0, recoverySeconds: 25, maxRecoverySeconds: 45 },
  { id: "clock-skew", faultClass: "clock", required: true, injected: true, detected: true, contained: true, recovered: true, dataLoss: 0, duplicateEffects: 0, unauthorizedEffects: 0, recoverySeconds: 10, maxRecoverySeconds: 30 },
  { id: "authorization-denial", faultClass: "authorization", required: true, injected: true, detected: true, contained: true, recovered: true, dataLoss: 0, duplicateEffects: 0, unauthorizedEffects: 0, recoverySeconds: 5, maxRecoverySeconds: 15 },
];

const controls = {
  ownerApprovalVerified: true,
  releaseCertified: true,
  rollbackReady: true,
  killSwitchAvailable: true,
  auditTrailComplete: true,
  backupRestoreVerified: true,
  capitalLedgerBalanced: true,
  idempotencyHealthy: true,
};

const requiredScenarioIds = scenarios.map((scenario) => scenario.id);
const certified = certifyChaosResilience({ scenarios, requiredScenarioIds, controls });
assert.equal(certified.verdict, "certified");
assert.equal(certified.certifiedScenarioCount, 5);
assert.equal(certified.requiredScenarioCount, 5);
assert.deepEqual(certified.blockers, []);
assert.match(certified.fingerprint, /^km14-[0-9a-f]{8}$/);

const dataLoss = certifyChaosResilience({
  scenarios: scenarios.map((scenario) => scenario.id === "supabase-failover" ? { ...scenario, dataLoss: 1 } : scenario),
  requiredScenarioIds,
  controls,
});
assert.equal(dataLoss.verdict, "blocked");
assert.ok(dataLoss.blockers.includes("supabase-failover:data-loss"));

const duplicate = certifyChaosResilience({
  scenarios: [...scenarios, { ...scenarios[0] }],
  requiredScenarioIds,
  controls,
});
assert.equal(duplicate.verdict, "blocked");
assert.ok(duplicate.blockers.includes("stripe-timeout:duplicate-scenario"));

const missing = certifyChaosResilience({
  scenarios: scenarios.slice(1),
  requiredScenarioIds,
  controls,
});
assert.equal(missing.verdict, "blocked");
assert.ok(missing.blockers.includes("stripe-timeout:missing-required-scenario"));

const unauthorized = certifyChaosResilience({
  scenarios: scenarios.map((scenario) => scenario.id === "authorization-denial" ? { ...scenario, unauthorizedEffects: 1 } : scenario),
  requiredScenarioIds,
  controls,
});
assert.equal(unauthorized.verdict, "blocked");
assert.ok(unauthorized.blockers.includes("authorization-denial:unauthorized-effects"));

const slow = certifyChaosResilience({
  scenarios: scenarios.map((scenario) => scenario.id === "queue-replay" ? { ...scenario, recoverySeconds: 46 } : scenario),
  requiredScenarioIds,
  controls,
});
assert.equal(slow.verdict, "blocked");
assert.ok(slow.blockers.includes("queue-replay:recovery-budget-exceeded"));

const optionalHold = certifyChaosResilience({
  scenarios: [...scenarios, { id: "capacity-spike", faultClass: "capacity", required: false, injected: true, detected: true, contained: false, recovered: false, dataLoss: 0, duplicateEffects: 0, unauthorizedEffects: 0, recoverySeconds: 80, maxRecoverySeconds: 90 }],
  requiredScenarioIds,
  controls,
});
assert.equal(optionalHold.verdict, "hold");
assert.ok(optionalHold.warnings.includes("capacity-spike:not-contained"));

const invalid = certifyChaosResilience({
  scenarios: scenarios.map((scenario) => scenario.id === "clock-skew" ? { ...scenario, recoverySeconds: Number.NaN } : scenario),
  requiredScenarioIds,
  controls,
});
assert.equal(invalid.verdict, "blocked");
assert.ok(invalid.blockers.includes("clock-skew:invalid-scenario"));

const reversed = certifyChaosResilience({ scenarios: [...scenarios].reverse(), requiredScenarioIds: [...requiredScenarioIds].reverse(), controls });
assert.equal(reversed.fingerprint, certified.fingerprint);

console.log("KINGMAKER Phase 14 resilience chaos certification regressions passed");
