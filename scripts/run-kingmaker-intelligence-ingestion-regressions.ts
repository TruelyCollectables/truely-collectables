import assert from "node:assert/strict";
import { ingestKingmakerObservationBatch } from "../src/lib/kingmaker-intelligence-ingestion";

const now = new Date("2026-08-03T02:00:00.000Z");
const valid = {
  source: "ebay" as const,
  sourceRecordKey: "listing-1",
  entityKey: "card:2025:upper deck:ivan demidov:young guns:201",
  observationType: "active_listing",
  observedAt: "2026-08-03T01:55:00.000Z",
  expiresAt: "2026-08-04T01:55:00.000Z",
  confidence: 0.91,
  amount: 24.99,
  currency: "usd",
  directUrl: "https://example.com/listing-1",
  evidence: { title: "Ivan Demidov Young Guns", seller: "trusted-seller" },
};

const first = ingestKingmakerObservationBatch({
  source: "ebay",
  observations: [valid, { ...valid }],
  now,
});
assert.equal(first.received, 2);
assert.equal(first.accepted.length, 1);
assert.equal(first.duplicateCount, 1);
assert.equal(first.rejected[0]?.code, "duplicate_fingerprint");
assert.equal(first.accepted[0]?.currency, "USD");

const rejected = ingestKingmakerObservationBatch({
  source: "mercari",
  observations: [
    { ...valid, sourceRecordKey: "", evidence: { ok: true } },
    { ...valid, sourceRecordKey: "future", observedAt: "2026-08-03T02:06:00.000Z" },
    { ...valid, sourceRecordKey: "expired", expiresAt: "2026-08-03T01:00:00.000Z" },
    { ...valid, sourceRecordKey: "confidence", confidence: 1.2 },
    { ...valid, sourceRecordKey: "currency", currency: "US" },
    { ...valid, sourceRecordKey: "url", directUrl: "javascript:alert(1)" },
    { ...valid, sourceRecordKey: "evidence", evidence: {} },
  ],
  now,
});
assert.deepEqual(
  rejected.rejected.map((item) => item.code),
  [
    "missing_source_record_key",
    "future_observation",
    "expired_observation",
    "invalid_confidence",
    "invalid_currency",
    "invalid_direct_url",
    "empty_evidence",
  ],
);
assert.equal(rejected.accepted.length, 0);

const existing = ingestKingmakerObservationBatch({
  source: "ebay",
  observations: [valid],
  existingFingerprints: [first.accepted[0]!.fingerprint],
  now,
});
assert.equal(existing.accepted.length, 0);
assert.equal(existing.duplicateCount, 1);

console.log("KINGMAKER intelligence ingestion regressions passed.");
