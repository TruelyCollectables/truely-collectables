import assert from "node:assert/strict";

import {
  BeckettPriceGuideManifestSchema,
  buildBeckettEntityKey,
  buildBeckettSourceRowKey,
  beckettEntryToObservations,
  validateBeckettEntry,
} from "../src/lib/kingmaker-beckett-price-guide";
import { canonicalizeKingmakerObservation } from "../src/lib/kingmaker-intelligence-fusion";

const sourceSha256 = "a".repeat(64);
const manifest = BeckettPriceGuideManifestSchema.parse({
  schema: "tcos.kingmaker.beckettPriceGuideBundle.v1",
  parserVersion: "1.1.0",
  guide: {
    title: "Synthetic Beckett Basketball Test Guide",
    sport: "Basketball",
    issueCode: "test-2026-08",
    editionDate: "2026-08-01",
    originalFilename: "synthetic-beckett-test.pdf",
    sourceSha256,
    pageCount: 40,
    priceGuideStartPage: 27,
    priceGuideEndPage: 40,
    redistributionAllowed: false,
  },
  files: {
    pages: "pages.ndjson",
    entries: "entries.ndjson",
    originalPdf: null,
  },
  counts: { pages: 14, entries: 2, accepted: 1, review: 1, rejected: 0 },
  extraction: {
    engine: "synthetic-regression",
    generatedAt: "2026-08-03T04:00:00.000Z",
    command: null,
  },
});

const acceptedRawText = "57 Michael Jordan RC 2500.00 5000.00";
const accepted = validateBeckettEntry(manifest, {
  pageNumber: 27,
  rowOrder: 57,
  sourceRowKey: buildBeckettSourceRowKey({
    sourceSha256,
    pageNumber: 27,
    rowOrder: 57,
    rawText: acceptedRawText,
  }),
  entryKind: "card",
  releaseYear: "1986-87",
  season: "1986-87",
  manufacturer: "Fleer",
  brand: "Fleer",
  product: "Fleer",
  setName: "Base",
  parallelName: null,
  cardNumber: "57",
  playerName: "Michael Jordan",
  teamName: "Chicago Bulls",
  rookieDesignation: true,
  autographDesignation: false,
  memorabiliaDesignation: false,
  shortPrintDesignation: false,
  errorDesignation: false,
  variation: null,
  serialRun: null,
  conditionBasis: "raw",
  valueLow: 2500,
  valueHigh: 5000,
  currency: "USD",
  multiplierLow: null,
  multiplierHigh: null,
  rawText: acceptedRawText,
  parseConfidence: 0.995,
  validationStatus: "accepted",
  validationReasons: [],
  metadata: { sourceEngine: "text" },
});

assert.equal(
  accepted.entityKey,
  "basketball:1986-87:fleer:michael jordan:fleer - base:57:raw",
);
assert.equal(buildBeckettEntityKey(manifest, accepted), accepted.entityKey);

const observations = beckettEntryToObservations(manifest, accepted);
assert.equal(observations.length, 2);
assert.deepEqual(
  observations.map((entry) => [entry.observationType, entry.amount]),
  [
    ["book_value_low", 2500],
    ["book_value_high", 5000],
  ],
);
assert.ok(observations.every((entry) => entry.source === "beckett"));
assert.ok(
  observations.every(
    (entry) => entry.observedAt === "2026-08-01T00:00:00.000Z",
  ),
);
assert.ok(
  observations.every(
    (entry) =>
      canonicalizeKingmakerObservation(entry).fingerprint.length === 64,
  ),
);

const reviewRawText = "251 Cooper Flagg RC 800.00 1500.00";
const review = validateBeckettEntry(manifest, {
  ...accepted,
  pageNumber: 39,
  rowOrder: 251,
  sourceRowKey: buildBeckettSourceRowKey({
    sourceSha256,
    pageNumber: 39,
    rowOrder: 251,
    rawText: reviewRawText,
  }),
  releaseYear: "2025-26",
  season: "2025-26",
  manufacturer: "Panini",
  brand: "Prizm",
  product: "Panini Prizm",
  setName: "Base",
  cardNumber: "251",
  playerName: "Cooper Flagg",
  teamName: null,
  valueLow: 800,
  valueHigh: 1500,
  rawText: reviewRawText,
  parseConfidence: 0.91,
  validationStatus: "review",
  validationReasons: ["ocr_value_verification_required"],
  entityKey: null,
  metadata: { sourceEngine: "tesseract" },
});
assert.equal(beckettEntryToObservations(manifest, review).length, 0);

assert.throws(
  () =>
    validateBeckettEntry(manifest, {
      ...accepted,
      sourceRowKey: "b".repeat(64),
    }),
  /Source-row key mismatch/,
);

assert.throws(
  () =>
    validateBeckettEntry(manifest, {
      ...accepted,
      pageNumber: 26,
      sourceRowKey: buildBeckettSourceRowKey({
        sourceSha256,
        pageNumber: 26,
        rowOrder: accepted.rowOrder,
        rawText: accepted.rawText,
      }),
    }),
  /outside the declared price-guide range/,
);

assert.throws(
  () =>
    validateBeckettEntry(manifest, {
      ...accepted,
      valueLow: 6000,
      valueHigh: 5000,
    }),
  /valueLow cannot exceed valueHigh/,
);

console.log("KINGMAKER Beckett price-guide regressions passed.");
