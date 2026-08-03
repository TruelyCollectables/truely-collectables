import assert from "node:assert/strict";
import {
  commandLiveOperations,
  evaluateRecovery,
  type LiveSignal,
} from "../src/lib/kingmaker-phase-13-live-operations-command";

const requiredSignalNames = ["error_rate", "p95_latency_ms", "capital_variance"];
const healthySignals: LiveSignal[] = [
  { name: "error_rate", observed: 0.2, warning: 1, critical: 3, direction: "higher_is_worse", required: true, fresh: true },
  { name: "p95_latency_ms", observed: 450, warning: 900, critical: 1600, direction: "higher_is_worse", required: true, fresh: true },
  { name: "capital_variance", observed: 0.1, warning: 0.5, critical: 1, direction: "higher_is_worse", required: true, fresh: true },
];

const controls = {
  ownerApprovalVerified: true,
  releaseCertified: true,
  rollbackReady: true,
  livePaymentsEnabled: true,
  liveShippingEnabled: true,
  killSwitchAvailable: true,
  capitalLedgerBalanced: true,
  idempotencyHealthy: true,
};

const healthy = commandLiveOperations({ signals: healthySignals, controls, currentTrafficPercent: 100, requiredSignalNames });
assert.equal(healthy.verdict, "healthy");
assert.equal(healthy.trafficPercent, 100);
assert.equal(healthy.freezeNewCapital, false);
assert.equal(healthy.openIncident, false);
assert.match(healthy.fingerprint, /^km13-[0-9a-f]{8}$/);

const degraded = commandLiveOperations({
  signals: healthySignals.map((signal) => signal.name === "p95_latency_ms" ? { ...signal, observed: 1000 } : signal),
  controls,
  currentTrafficPercent: 80,
  requiredSignalNames,
});
assert.equal(degraded.verdict, "degraded");
assert.equal(degraded.trafficPercent, 25);
assert.equal(degraded.freezeNewCapital, true);

const incident = commandLiveOperations({
  signals: healthySignals.map((signal) => signal.name === "error_rate" ? { ...signal, observed: 4 } : signal),
  controls,
  currentTrafficPercent: 50,
  requiredSignalNames,
});
assert.equal(incident.verdict, "incident");
assert.equal(incident.severity, "sev2");
assert.equal(incident.trafficPercent, 0);
assert.equal(incident.disablePayments, true);
assert.equal(incident.disableShipping, true);

const shutdown = commandLiveOperations({
  signals: healthySignals,
  controls: { ...controls, capitalLedgerBalanced: false },
  currentTrafficPercent: 100,
  requiredSignalNames,
});
assert.equal(shutdown.verdict, "shutdown");
assert.equal(shutdown.severity, "sev1");
assert.equal(shutdown.invokeRollback, true);
assert.ok(shutdown.reasons.includes("capital-ledger-unbalanced"));

const stale = commandLiveOperations({
  signals: healthySignals.map((signal) => signal.name === "error_rate" ? { ...signal, fresh: false } : signal),
  controls,
  currentTrafficPercent: 10,
  requiredSignalNames,
});
assert.equal(stale.verdict, "incident");
assert.ok(stale.reasons.includes("error_rate:required-signal-stale"));

const missingRequired = commandLiveOperations({
  signals: healthySignals.filter((signal) => signal.name !== "capital_variance"),
  controls,
  currentTrafficPercent: 100,
  requiredSignalNames,
});
assert.equal(missingRequired.verdict, "incident");
assert.ok(missingRequired.reasons.includes("capital_variance:required-signal-missing"));

const duplicateRequired = commandLiveOperations({
  signals: [...healthySignals, healthySignals[0]],
  controls,
  currentTrafficPercent: 100,
  requiredSignalNames,
});
assert.equal(duplicateRequired.verdict, "incident");
assert.ok(duplicateRequired.reasons.includes("error_rate:duplicate-signal"));

const malformedSignal = commandLiveOperations({
  signals: healthySignals.map((signal) => signal.name === "error_rate" ? { ...signal, observed: Number.NaN } : signal),
  controls,
  currentTrafficPercent: 100,
  requiredSignalNames,
});
assert.equal(malformedSignal.verdict, "incident");
assert.ok(malformedSignal.reasons.includes("error_rate:invalid-signal-contract"));

const invalidThresholds = commandLiveOperations({
  signals: healthySignals.map((signal) => signal.name === "error_rate" ? { ...signal, warning: 4, critical: 3 } : signal),
  controls,
  currentTrafficPercent: 100,
  requiredSignalNames,
});
assert.equal(invalidThresholds.verdict, "incident");
assert.ok(invalidThresholds.reasons.includes("error_rate:invalid-signal-contract"));

const invalidTraffic = commandLiveOperations({
  signals: healthySignals,
  controls,
  currentTrafficPercent: Number.NaN,
  requiredSignalNames,
});
assert.equal(invalidTraffic.verdict, "incident");
assert.equal(invalidTraffic.trafficPercent, 0);
assert.ok(invalidTraffic.reasons.includes("traffic-percent-invalid"));

const deterministicA = commandLiveOperations({ signals: healthySignals, controls, currentTrafficPercent: 100, requiredSignalNames });
const deterministicB = commandLiveOperations({ signals: [...healthySignals].reverse(), controls, currentTrafficPercent: 100, requiredSignalNames: [...requiredSignalNames].reverse() });
assert.equal(deterministicA.fingerprint, deterministicB.fingerprint);

const recovery = evaluateRecovery({
  incidentOpen: true,
  ownerApprovalVerified: true,
  rollbackVerified: true,
  signals: healthySignals,
  consecutiveHealthyWindows: 3,
  minimumHealthyWindows: 3,
  requiredSignalNames,
});
assert.deepEqual(recovery, { recoverable: true, reasons: [] });

const blockedRecovery = evaluateRecovery({
  incidentOpen: true,
  ownerApprovalVerified: false,
  rollbackVerified: true,
  signals: healthySignals,
  consecutiveHealthyWindows: 1,
  minimumHealthyWindows: 3,
  requiredSignalNames,
});
assert.equal(blockedRecovery.recoverable, false);
assert.deepEqual(blockedRecovery.reasons, ["insufficient-healthy-windows", "owner-approval-unverified"]);

const missingSignalRecovery = evaluateRecovery({
  incidentOpen: true,
  ownerApprovalVerified: true,
  rollbackVerified: true,
  signals: healthySignals.slice(0, 2),
  consecutiveHealthyWindows: 3,
  minimumHealthyWindows: 3,
  requiredSignalNames,
});
assert.equal(missingSignalRecovery.recoverable, false);
assert.ok(missingSignalRecovery.reasons.includes("capital_variance:required-signal-missing"));

console.log("KINGMAKER Phase 13 live operations command regressions passed");
