import assert from "node:assert/strict";
import { certifyDisasterRecovery } from "../src/lib/kingmaker-phase-18-disaster-recovery-business-continuity";

const base = {
  now: "2026-08-03T18:00:00.000Z",
  ownerApproval: true,
  releaseCertified: true,
  accessCertified: true,
  backupsEncrypted: true,
  backupRestoreVerified: true,
  alternateRegionReady: true,
  communicationsReady: true,
  killSwitchReady: true,
  maximumEvidenceAgeDays: 30,
  maximumRtoMinutes: 60,
  maximumRpoMinutes: 5,
  requiredScenarioIds: ["database-loss", "region-loss", "queue-replay"],
  scenarios: [
    { scenarioId: "database-loss", executed: true, sourceVerified: true, restoreVerified: true, dataLossRecords: 0, duplicateEffects: 0, rtoMinutes: 20, rpoMinutes: 1, testedAt: "2026-08-01T00:00:00.000Z" },
    { scenarioId: "region-loss", executed: true, sourceVerified: true, restoreVerified: true, dataLossRecords: 0, duplicateEffects: 0, rtoMinutes: 30, rpoMinutes: 2, testedAt: "2026-08-01T00:00:00.000Z" },
    { scenarioId: "queue-replay", executed: true, sourceVerified: true, restoreVerified: true, dataLossRecords: 0, duplicateEffects: 0, rtoMinutes: 10, rpoMinutes: 0, testedAt: "2026-08-01T00:00:00.000Z" },
  ],
};

const ready = certifyDisasterRecovery(base);
assert.equal(ready.verdict, "ready");
assert.deepEqual(ready.commands, []);
assert.match(ready.fingerprint, /^[a-f0-9]{64}$/);

const stale = certifyDisasterRecovery({ ...base, scenarios: base.scenarios.map((s, i) => i === 0 ? { ...s, testedAt: "2025-01-01T00:00:00.000Z" } : s) });
assert.equal(stale.verdict, "degraded");

const loss = certifyDisasterRecovery({ ...base, scenarios: base.scenarios.map((s, i) => i === 0 ? { ...s, dataLossRecords: 1 } : s) });
assert.equal(loss.verdict, "failover");
assert.ok(loss.commands.includes("initiate_failover"));
assert.ok(loss.commands.includes("disable_payments_shipping"));

const blocked = certifyDisasterRecovery({ ...base, ownerApproval: false, killSwitchReady: false, alternateRegionReady: false });
assert.equal(blocked.verdict, "blocked");

const missing = certifyDisasterRecovery({ ...base, scenarios: base.scenarios.slice(0, 2) });
assert.equal(missing.verdict, "failover");

assert.equal(certifyDisasterRecovery(base).fingerprint, ready.fingerprint);
console.log("KINGMAKER Phase 18 disaster recovery and business continuity regressions passed");
