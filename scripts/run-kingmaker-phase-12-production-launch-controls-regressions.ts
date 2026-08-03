import assert from "node:assert/strict";
import { evaluateProductionLaunch } from "../src/lib/kingmaker-phase-12-production-launch-controls";

const base = {
  releaseCertified: true,
  ownerApproved: true,
  migrationsVerified: true,
  rollbackVerified: true,
  livePaymentsEnabled: false,
  liveShippingEnabled: false,
  canary: {
    trafficPercent: 5,
    durationMinutes: 30,
    maxErrorRatePercent: 1,
    maxP95LatencyMs: 1200,
    maxCapitalVariancePercent: 0.5,
  },
  observedErrorRatePercent: 0.2,
  observedP95LatencyMs: 600,
  observedCapitalVariancePercent: 0.1,
  signals: [
    { name: "database", ok: true, critical: true },
    { name: "marketplace-adapters", ok: true, critical: true },
    { name: "alerting", ok: true },
  ],
};

const go = evaluateProductionLaunch(base);
assert.equal(go.verdict, "go");
assert.equal(go.nextTrafficPercent, 10);
assert.equal(go.fingerprint.length, 8);

const hold = evaluateProductionLaunch({ ...base, ownerApproved: false });
assert.equal(hold.verdict, "hold");
assert.equal(hold.nextTrafficPercent, 0);
assert.ok(hold.reasons.includes("owner-approval-missing"));

const rollback = evaluateProductionLaunch({ ...base, observedErrorRatePercent: 4 });
assert.equal(rollback.verdict, "rollback");
assert.ok(rollback.reasons.includes("canary-threshold-breached"));

const critical = evaluateProductionLaunch({
  ...base,
  signals: [{ name: "capital-ledger", ok: false, critical: true }],
});
assert.equal(critical.verdict, "hold");
assert.ok(critical.reasons.includes("critical-signal-failed"));

assert.deepEqual(evaluateProductionLaunch(base), evaluateProductionLaunch(base));
console.log("KINGMAKER Phase 12 production launch control regressions passed");
