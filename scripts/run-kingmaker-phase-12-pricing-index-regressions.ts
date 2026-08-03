import assert from "node:assert/strict";
import {
  buildKingmakerPricingIndex,
  resolveKingmakerPricingSnapshot,
  type KingmakerPricePoint,
} from "../src/lib/kingmaker-phase-12-pricing-index";

const points: KingmakerPricePoint[] = [
  {
    identityKey: "card:a",
    guideId: "guide-aug",
    editionDate: "2026-08-01",
    valueLow: 80,
    valueHigh: 120,
    currency: "usd",
    confidence: 0.99,
    validationStatus: "accepted",
    identityMatchStatus: "exact",
    sourceEngine: "text",
  },
  {
    identityKey: "card:a",
    guideId: "guide-sep",
    editionDate: "2026-09-01",
    valueLow: 100,
    valueHigh: 140,
    currency: "usd",
    confidence: 0.94,
    validationStatus: "review",
    identityMatchStatus: "exact",
    sourceEngine: "ocr",
  },
  {
    identityKey: "card:b",
    guideId: "guide-sep",
    editionDate: "2026-09-01",
    valueLow: 20,
    valueHigh: 30,
    currency: "USD",
    confidence: 0.99,
    validationStatus: "accepted",
    identityMatchStatus: "exact",
    sourceEngine: "text",
  },
  {
    identityKey: "card:ignored",
    guideId: "guide-sep",
    editionDate: "2026-09-01",
    valueLow: 500,
    valueHigh: 600,
    currency: "USD",
    confidence: 1,
    validationStatus: "review",
    identityMatchStatus: "ambiguous",
    sourceEngine: "ocr",
  },
];

const index = buildKingmakerPricingIndex(points);
assert.equal(index.snapshots.length, 2);
const cardA = resolveKingmakerPricingSnapshot(index, "card:a");
assert.ok(cardA);
assert.equal(cardA.low, 100);
assert.equal(cardA.high, 140);
assert.equal(cardA.midpoint, 120);
assert.equal(cardA.historyCount, 2);
assert.equal(cardA.trendPct, 20);
assert.equal(cardA.status, "review_required");
assert.equal(cardA.currency, "USD");
assert.equal(resolveKingmakerPricingSnapshot(index, "missing"), null);

const reordered = buildKingmakerPricingIndex([...points].reverse());
assert.equal(index.fingerprint, reordered.fingerprint);
assert.equal(index.snapshots[0].fingerprint, reordered.snapshots[0].fingerprint);

assert.throws(() => buildKingmakerPricingIndex([{ ...points[0], valueLow: 200, valueHigh: 100 }]), /low_exceeds_high/);
assert.throws(() => buildKingmakerPricingIndex([{ ...points[0], confidence: 2 }]), /invalid_confidence/);
assert.throws(() => buildKingmakerPricingIndex([{ ...points[0], identityKey: "" }]), /missing_identity_key/);

console.log("KINGMAKER Phase 12 pricing index regressions passed.");
