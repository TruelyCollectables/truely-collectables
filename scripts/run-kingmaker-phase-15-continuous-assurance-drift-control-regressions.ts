import assert from "node:assert/strict";
import {
  evaluateContinuousAssurance,
  type AssuranceControls,
  type AssuranceEvidence,
} from "../src/lib/kingmaker-phase-15-continuous-assurance-drift-control";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const requiredKeys = ["deployment", "database", "payments", "shipping"];
const evidence: AssuranceEvidence[] = requiredKeys.map((key) => ({
  key,
  expectedDigest: digestA,
  observedDigest: digestA,
  required: true,
  fresh: true,
  sourceVerified: true,
}));
const controls: AssuranceControls = {
  ownerApprovalVerified: true,
  releaseCertified: true,
  chaosCertified: true,
  auditTrailComplete: true,
  capitalLedgerBalanced: true,
  idempotencyHealthy: true,
  rollbackReady: true,
  killSwitchAvailable: true,
};

const attested = evaluateContinuousAssurance({
  evidence,
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 2,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(attested.verdict, "attested");
assert.equal(attested.severity, "none");
assert.equal(attested.quarantineWrites, false);
assert.match(attested.fingerprint, /^km15-[0-9a-f]{8}$/);

const warmup = evaluateContinuousAssurance({
  evidence,
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 0,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(warmup.verdict, "watch");
assert.ok(warmup.reasons.includes("insufficient-consecutive-attested-windows"));

const optionalDrift = evaluateContinuousAssurance({
  evidence: [...evidence, { key: "search-index", expectedDigest: digestA, observedDigest: digestB, required: false, fresh: true, sourceVerified: true }],
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 3,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(optionalDrift.verdict, "watch");
assert.equal(optionalDrift.quarantineWrites, false);

const requiredDrift = evaluateContinuousAssurance({
  evidence: evidence.map((row) => row.key === "database" ? { ...row, observedDigest: digestB } : row),
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 3,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(requiredDrift.verdict, "quarantine");
assert.equal(requiredDrift.quarantineWrites, true);
assert.equal(requiredDrift.disablePayments, false);

const missingAndStale = evaluateContinuousAssurance({
  evidence: evidence.filter((row) => row.key !== "payments").map((row) => row.key === "shipping" ? { ...row, fresh: false } : row),
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 3,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(missingAndStale.verdict, "blocked");
assert.equal(missingAndStale.disablePayments, true);
assert.equal(missingAndStale.disableShipping, true);
assert.equal(missingAndStale.invokeRollback, true);

const controlFailure = evaluateContinuousAssurance({
  evidence,
  requiredEvidenceKeys: requiredKeys,
  controls: { ...controls, capitalLedgerBalanced: false },
  previousConsecutiveAttestedWindows: 3,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(controlFailure.verdict, "blocked");
assert.ok(controlFailure.reasons.includes("capital-ledger-unbalanced"));

const malformed = evaluateContinuousAssurance({
  evidence: evidence.map((row) => row.key === "deployment" ? { ...row, observedDigest: "not-a-digest" } : row),
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 3,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(malformed.verdict, "quarantine");
assert.ok(malformed.reasons.includes("deployment:malformed-digest"));

const duplicate = evaluateContinuousAssurance({
  evidence: [...evidence, evidence[0]],
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 3,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(duplicate.verdict, "quarantine");
assert.ok(duplicate.reasons.includes("deployment:duplicate"));

const deterministicA = evaluateContinuousAssurance({
  evidence,
  requiredEvidenceKeys: requiredKeys,
  controls,
  previousConsecutiveAttestedWindows: 2,
  minimumAttestedWindowsForClear: 3,
});
const deterministicB = evaluateContinuousAssurance({
  evidence: [...evidence].reverse(),
  requiredEvidenceKeys: [...requiredKeys].reverse(),
  controls,
  previousConsecutiveAttestedWindows: 2,
  minimumAttestedWindowsForClear: 3,
});
assert.equal(deterministicA.fingerprint, deterministicB.fingerprint);

console.log("KINGMAKER Phase 15 continuous assurance drift-control regressions passed");
