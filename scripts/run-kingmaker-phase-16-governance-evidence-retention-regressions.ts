import assert from "node:assert/strict";
import { evaluateGovernance, type EvidenceRecord } from "../src/lib/kingmaker-phase-16-governance-evidence-retention";

const now = 1_800_000_000_000;
const retention = 365 * 24 * 60 * 60 * 1000;
const digest = "a".repeat(64);
const evidence: EvidenceRecord[] = [
  { id: "release", category: "release", digest, sourceVerified: true, immutable: true, createdAtEpochMs: now, retainedUntilEpochMs: now + retention },
  { id: "audit", category: "audit", digest: "b".repeat(64), sourceVerified: true, immutable: true, createdAtEpochMs: now, retainedUntilEpochMs: now + retention },
  { id: "capital", category: "capital", digest: "c".repeat(64), sourceVerified: true, immutable: true, createdAtEpochMs: now, retainedUntilEpochMs: now + retention },
];
const controls = {
  ownerApprovalVerified: true,
  releaseCertified: true,
  auditTrailComplete: true,
  legalHoldActive: false,
  deletionAuthorized: true,
  capitalLedgerBalanced: true,
  idempotencyHealthy: true,
};

const compliant = evaluateGovernance({ evidence, requiredCategories: ["release", "audit", "capital"], nowEpochMs: now, minimumRetentionMs: retention, controls });
assert.equal(compliant.verdict, "compliant");
assert.equal(compliant.quarantineWrites, false);
assert.match(compliant.fingerprint, /^km16-[0-9a-f]{8}$/);

const missing = evaluateGovernance({ evidence: evidence.slice(0, 2), requiredCategories: ["release", "audit", "capital"], nowEpochMs: now, minimumRetentionMs: retention, controls });
assert.equal(missing.verdict, "quarantine");
assert.ok(missing.reasons.includes("missing-required-category:capital"));

const legalHold = evaluateGovernance({ evidence, requiredCategories: ["release", "audit", "capital"], nowEpochMs: now, minimumRetentionMs: retention, controls: { ...controls, legalHoldActive: true, deletionAuthorized: true } });
assert.equal(legalHold.verdict, "blocked");
assert.equal(legalHold.blockDeletion, true);
assert.ok(legalHold.reasons.includes("deletion-authorized-during-legal-hold"));

const malformed = evaluateGovernance({ evidence: [{ ...evidence[0], digest: "bad", sourceVerified: false, immutable: false }], requiredCategories: ["release"], nowEpochMs: now, minimumRetentionMs: retention, controls });
assert.equal(malformed.verdict, "quarantine");
assert.ok(malformed.reasons.includes("malformed-digest:release"));
assert.ok(malformed.reasons.includes("mutable-evidence:release"));
assert.ok(malformed.reasons.includes("unverified-source:release"));

const duplicate = evaluateGovernance({ evidence: [evidence[0], { ...evidence[0] }], requiredCategories: ["release"], nowEpochMs: now, minimumRetentionMs: retention, controls });
assert.equal(duplicate.verdict, "review");
assert.ok(duplicate.reasons.includes("duplicate-or-missing-id:release"));

const badLedger = evaluateGovernance({ evidence, requiredCategories: ["release", "audit", "capital"], nowEpochMs: now, minimumRetentionMs: retention, controls: { ...controls, capitalLedgerBalanced: false } });
assert.equal(badLedger.verdict, "blocked");
assert.equal(badLedger.quarantineWrites, true);

const deterministicA = evaluateGovernance({ evidence, requiredCategories: ["release", "audit", "capital"], nowEpochMs: now, minimumRetentionMs: retention, controls });
const deterministicB = evaluateGovernance({ evidence: [...evidence].reverse(), requiredCategories: ["capital", "release", "audit"], nowEpochMs: now, minimumRetentionMs: retention, controls });
assert.equal(deterministicA.fingerprint, deterministicB.fingerprint);

console.log("KINGMAKER Phase 16 governance evidence retention regressions passed");
