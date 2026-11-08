import assert from "node:assert/strict";
import {
  buildKingmakerEntityKey,
  canonicalizeKingmakerObservation,
  isKingmakerObservationFresh,
} from "../src/lib/kingmaker-intelligence-fusion";

const first = canonicalizeKingmakerObservation({
  source: "ebay",
  sourceRecordKey: " listing-123 ",
  entityKey: " hockey:2025:ivan demidov ",
  observationType: "active_listing",
  observedAt: "2026-08-03T01:00:00Z",
  expiresAt: "2026-08-04T01:00:00Z",
  confidence: 0.91,
  amount: 19.999,
  currency: "usd",
  directUrl: "https://example.com/listing-123",
  evidence: { seller: "trusted", nested: { b: 2, a: 1 } },
});

const reordered = canonicalizeKingmakerObservation({
  source: "ebay",
  sourceRecordKey: "listing-123",
  entityKey: "hockey:2025:ivan demidov",
  observationType: "active_listing",
  observedAt: "2026-08-03T01:00:00.000Z",
  expiresAt: "2026-08-04T01:00:00.000Z",
  confidence: 0.91,
  amount: 19.999,
  currency: "USD",
  directUrl: "https://example.com/listing-123",
  evidence: { nested: { a: 1, b: 2 }, seller: "trusted" },
});

assert.equal(first.fingerprint, reordered.fingerprint, "Evidence key order must not change the observation fingerprint.");
assert.equal(first.amount, 19.999, "Observation amounts retain four-decimal canonical precision.");
assert.equal(first.currency, "USD");
assert.equal(
  buildKingmakerEntityKey({
    category: "Hockey",
    year: 2025,
    manufacturer: "Upper Deck",
    subject: "Ivan Demidov",
    set: "Young Guns",
    cardNumber: "#201",
    parallel: "Silver",
    grade: "Raw",
  }),
  "hockey:2025:upper deck:ivan demidov:young guns:#201:silver:raw",
);

assert.equal(
  isKingmakerObservationFresh(first, new Date("2026-08-03T12:00:00Z")),
  true,
);
assert.equal(
  isKingmakerObservationFresh(first, new Date("2026-08-05T12:00:00Z")),
  false,
);
assert.equal(
  isKingmakerObservationFresh(
    { observedAt: "2026-08-03T12:10:01Z", expiresAt: null },
    new Date("2026-08-03T12:00:00Z"),
  ),
  false,
  "Observations too far in the future must fail closed.",
);

console.log("KINGMAKER intelligence fusion regressions passed.");
