import assert from "node:assert/strict";
import { certifyAccessAndRotation } from "../src/lib/kingmaker-phase-17-access-recertification-key-rotation";

const now = "2026-08-03T18:00:00.000Z";
const base = {
  now,
  ownerApproval: true,
  releaseCertified: true,
  auditTrailComplete: true,
  killSwitchReady: true,
  maximumReviewAgeDays: 90,
  requiredRoles: ["owner", "operator"],
  principals: [
    { principalId: "owner-1", role: "owner", ownerApproved: true, leastPrivilegeVerified: true, mfaVerified: true, lastReviewedAt: "2026-08-01T00:00:00.000Z", sourceVerified: true },
    { principalId: "operator-1", role: "operator", ownerApproved: true, leastPrivilegeVerified: true, mfaVerified: true, lastReviewedAt: "2026-08-01T00:00:00.000Z", sourceVerified: true },
  ],
  credentials: [{ credentialId: "key-1", status: "current" as const, rotatedAt: "2026-08-01T00:00:00.000Z", maximumAgeDays: 30, sourceVerified: true, fingerprint: "a".repeat(64) }],
};

const certified = certifyAccessAndRotation(base);
assert.equal(certified.verdict, "certified");
assert.deepEqual(certified.commands, []);
assert.match(certified.fingerprint, /^[a-f0-9]{64}$/);

const due = certifyAccessAndRotation({ ...base, credentials: [{ ...base.credentials[0], status: "due" as const }] });
assert.equal(due.verdict, "review");
assert.ok(due.commands.includes("rotate_credential"));

const expired = certifyAccessAndRotation({ ...base, credentials: [{ ...base.credentials[0], status: "expired" as const }] });
assert.equal(expired.verdict, "quarantine");
assert.ok(expired.commands.includes("disable_credential"));
assert.ok(expired.commands.includes("quarantine_privileged_writes"));

const duplicate = certifyAccessAndRotation({ ...base, principals: [base.principals[0], base.principals[0]] });
assert.equal(duplicate.verdict, "quarantine");

const blocked = certifyAccessAndRotation({ ...base, ownerApproval: false, killSwitchReady: false });
assert.equal(blocked.verdict, "blocked");

assert.equal(certifyAccessAndRotation(base).fingerprint, certified.fingerprint);
console.log("KINGMAKER Phase 17 access recertification and key rotation regressions passed");
