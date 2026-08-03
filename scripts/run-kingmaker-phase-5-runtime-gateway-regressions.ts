import assert from "node:assert/strict";
import {
  buildKingmakerApiResponse,
  executeKingmakerPersistencePlan,
  signKingmakerServiceRequest,
  verifyKingmakerServiceRequest,
} from "../src/lib/kingmaker-phase-5-runtime-gateway";
import type { KingmakerPersistencePlan } from "../src/lib/kingmaker-phase-5-persistence-bridge";

async function main() {
  const plan: KingmakerPersistencePlan = {
    cycleFingerprint: "cycle-1",
    eventCount: 0,
    decisionCount: 1,
    adapterRunCount: 0,
    ownerActionCount: 0,
    fingerprint: "plan-1",
    operations: [
      {
        table: "tcos_kingmaker_live_cycles",
        conflictTarget: "cycle_fingerprint",
        mode: "insert_ignore",
        row: { cycle_fingerprint: "cycle-1" },
        fingerprint: "operation-1",
      },
      {
        table: "tcos_kingmaker_live_decisions",
        conflictTarget: "decision_fingerprint",
        mode: "upsert",
        row: { decision_fingerprint: "decision-1" },
        fingerprint: "operation-2",
      },
    ],
  };

  const calls: string[] = [];
  const result = await executeKingmakerPersistencePlan({
    plan,
    client: {
      async insertIgnore(operation) {
        calls.push(`insert:${operation.table}`);
        return "duplicate";
      },
      async upsert(operation) {
        calls.push(`upsert:${operation.table}`);
        return "applied";
      },
    },
  });
  assert.deepEqual(calls, ["insert:tcos_kingmaker_live_cycles", "upsert:tcos_kingmaker_live_decisions"]);
  assert.equal(result.applied, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.fingerprint.length, 64);

  await assert.rejects(() => executeKingmakerPersistencePlan({
    plan: { ...plan, operations: [plan.operations[0], plan.operations[0]] },
    client: {
      async insertIgnore() { return "applied"; },
      async upsert() { return "applied"; },
    },
  }), /duplicate_operation_fingerprint/);

  const secret = "kingmaker-service-secret-at-least-32-characters";
  const unsigned = {
    method: "POST",
    path: "/api/kingmaker/v1/owner-actions",
    timestamp: "2026-08-03T13:30:00Z",
    nonce: "nonce-1",
    body: JSON.stringify({ action: "approve" }),
  };
  const signature = signKingmakerServiceRequest({ ...unsigned, secret });
  const usedNonces = new Set<string>();
  const verified = verifyKingmakerServiceRequest({
    request: { ...unsigned, signature },
    secret,
    now: "2026-08-03T13:31:00Z",
    usedNonces,
  });
  assert.equal(verified.accepted, true);
  assert.equal(usedNonces.has("nonce-1"), true);

  const replay = verifyKingmakerServiceRequest({
    request: { ...unsigned, signature },
    secret,
    now: "2026-08-03T13:31:00Z",
    usedNonces,
  });
  assert.equal(replay.accepted, false);
  assert.ok(replay.errors.includes("request_nonce_replayed"));

  const forged = verifyKingmakerServiceRequest({
    request: { ...unsigned, nonce: "nonce-2", signature: "00".repeat(32) },
    secret,
    now: "2026-08-03T13:31:00Z",
    usedNonces,
  });
  assert.equal(forged.accepted, false);
  assert.ok(forged.errors.includes("invalid_request_signature"));

  const stale = verifyKingmakerServiceRequest({
    request: { ...unsigned, nonce: "nonce-3", timestamp: "2026-08-03T12:00:00Z", signature },
    secret,
    now: "2026-08-03T13:31:00Z",
    usedNonces,
  });
  assert.equal(stale.accepted, false);
  assert.ok(stale.errors.includes("request_timestamp_outside_window"));

  const freshResponse = buildKingmakerApiResponse({ payload: { ok: true }, etag: "etag-1" });
  assert.equal(freshResponse.status, 200);
  assert.deepEqual(freshResponse.body, { ok: true });
  const cachedResponse = buildKingmakerApiResponse({ payload: { ok: true }, etag: "etag-1", ifNoneMatch: "etag-1" });
  assert.equal(cachedResponse.status, 304);
  assert.equal(cachedResponse.body, null);

  console.log("KINGMAKER Phase 5 runtime gateway regressions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
