import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  TCGDEX_JAPANESE_ADAPTER_ID,
  TCGDEX_JAPANESE_ADAPTER_VERSION,
  tcgdexJapaneseSetBundleAdapter,
} from "../src/lib/checklist-registry/tcgdex-japanese";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const fixturePath = resolve(
  "scripts/fixtures/checklist-registry/tcgdex-japanese-set-bundle.fixture.json",
);
const content = readFileSync(fixturePath);
const artifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://github.com/tcgdex/cards-database/blob/649339e000000000000000000000000000000000/data-asia/SV/SV11B-FIXTURE.ts",
  originalFilename: "SV-SV11B-FIXTURE.tcgdex-ja.bundle.json",
  mimeType: "application/json",
  content,
  retrievedAt: "2026-08-01T03:45:00.000Z",
  authority: "approved_reference_dataset",
  redistributionAllowed: false,
};

const failures: string[] = [];
function expect(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

function databaseNormalizedCardNumber(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/]+/gu, "");
}

function databaseNormalizedVariation(value: string | null) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

expect(
  tcgdexJapaneseSetBundleAdapter.supports(artifact),
  "TCGdex Japanese adapter should support its bundle schema.",
);
const plan = tcgdexJapaneseSetBundleAdapter.parse(artifact);
const notes = plan.cards.map((card) => card.sourceNotes || "").join("\n");
const firstNotes = JSON.parse(plan.cards[0]?.sourceNotes || "{}") as {
  languageCode?: string;
  sourceSetId?: string;
  sourceCardId?: string;
  phase?: string;
  variantEvidence?: Array<{ type?: string; foil?: string }>;
  materializedPhysicalPrintings?: string[];
};
const secondNotes = JSON.parse(plan.cards[1]?.sourceNotes || "{}") as {
  materializedPhysicalPrintings?: string[];
};
const fingerprints = plan.identities.map((identity) => identity.fingerprint);
const normalizedWithLanguage = fingerprints.map(
  (fingerprint) =>
    fingerprint.normalized as typeof fingerprint.normalized & {
      languageCode?: string;
    },
);
const databaseKeys = plan.cards.map((card) =>
  [
    card.setSourceKey,
    databaseNormalizedCardNumber(card.cardNumber),
    databaseNormalizedVariation(card.variation),
  ].join("|"),
);
const collisionCards = plan.cards.filter(
  (card) => card.cardNumber === "!" || card.cardNumber === "?",
);
const parallelNames = plan.parallels.map((parallel) => parallel.name).sort();
const expectedParallelNames = [
  "Cosmos Holo",
  "Jumbo",
  "Master Ball Reverse Holo",
  "Poké Ball Reverse Holo",
  "Shadowless — 1st Edition",
].sort();
const baseIdentities = plan.identities.filter(
  (identity) => !identity.parallelSourceKey,
);
const physicalVariantIdentities = plan.identities.filter(
  (identity) => Boolean(identity.parallelSourceKey),
);
const firstCardIdentities = plan.identities.filter(
  (identity) => identity.cardSourceKey.endsWith("SV11B-FIXTURE-001"),
);
const secondCardIdentities = plan.identities.filter(
  (identity) => identity.cardSourceKey.endsWith("SV11B-FIXTURE-002"),
);

expect(plan.adapterId === TCGDEX_JAPANESE_ADAPTER_ID, "Adapter ID mismatch.");
expect(
  plan.adapterVersion === TCGDEX_JAPANESE_ADAPTER_VERSION,
  "Adapter version mismatch.",
);
expect(
  plan.validation.status === "passed",
  "Japanese physical-printing fixture should pass validation.",
);
expect(
  plan.release.product === "ブラックボルト・フィクスチャ",
  "Japanese product name mismatch.",
);
expect(
  plan.release.releaseYear === "2026",
  "Release year should derive from Japanese release date.",
);
expect(
  plan.release.releaseSlug === "tcgdex-ja-sv-sv11b-fixture",
  "Release slug should use the stable ASCII Japanese namespace.",
);
expect(plan.sets.length === 1, "Fixture should create one Japanese set.");
expect(plan.cards.length === 4, "Fixture should retain four Japanese base cards.");
expect(
  plan.parallels.length === 5,
  "Phase 2 should create five distinct named physical-printing definitions.",
);
expect(
  JSON.stringify(parallelNames) === JSON.stringify(expectedParallelNames),
  `Unexpected physical-printing names: ${parallelNames.join(", ")}`,
);
expect(
  plan.identities.length === 9,
  "Fixture should create nine exact physical-printing identities.",
);
expect(
  baseIdentities.length === 4,
  "Fixture should retain four base identities.",
);
expect(
  physicalVariantIdentities.length === 5,
  "Fixture should create five non-base physical-printing identities.",
);
expect(
  firstCardIdentities.length === 3,
  "The first card should have Base, Poké Ball Reverse Holo, and Master Ball Reverse Holo identities.",
);
expect(
  secondCardIdentities.length === 4,
  "The second card should have Base, Cosmos Holo, Shadowless 1st Edition, and Jumbo identities.",
);
expect(
  fingerprints.every((fingerprint) =>
    fingerprint.canonicalKey.endsWith("|language_code=ja"),
  ),
  "Japanese fingerprints must include the ja language namespace.",
);
expect(
  normalizedWithLanguage.every(
    (normalized) => normalized.languageCode === "ja",
  ),
  "Japanese normalized identities must retain languageCode ja.",
);
expect(
  new Set(fingerprints.map((fingerprint) => fingerprint.fingerprintSha256))
    .size === fingerprints.length,
  "Japanese exact physical identities must remain unique.",
);
expect(
  new Set(databaseKeys).size === databaseKeys.length,
  "Every Japanese Registry database card key should be unique.",
);
expect(
  collisionCards.length === 2 &&
    collisionCards.every((card) =>
      /^TCGdex Source Variant [a-f0-9]{24}$/.test(card.variation || ""),
    ),
  "Punctuation-normalized Japanese card numbers should retain stable source-backed variations.",
);
expect(
  plan.validation.issues.some(
    (entry) => entry.code === "database_card_key_disambiguated",
  ),
  "Phase 2 should preserve database card-key disambiguation.",
);
expect(
  plan.validation.issues.some(
    (entry) => entry.code === "duplicate_variant_evidence_deduplicated",
  ),
  "Repeated physical-variant evidence should be explicitly deduplicated.",
);
expect(
  plan.validation.issues.some(
    (entry) => entry.code === "physical_variants_materialized",
  ),
  "Phase 2 should record physical-printing materialization.",
);
expect(
  !plan.validation.issues.some(
    (entry) => entry.code === "physical_variants_deferred",
  ),
  "Phase 2 must not defer supported physical variants.",
);
expect(
  firstNotes.languageCode === "ja",
  "Source notes should retain languageCode ja.",
);
expect(
  firstNotes.sourceSetId === "SV11B-FIXTURE",
  "Source set ID should be preserved.",
);
expect(
  firstNotes.sourceCardId === "SV11B-FIXTURE-001",
  "Source card ID should be preserved.",
);
expect(
  firstNotes.phase === "physical_printings",
  "Source notes should identify the physical-printing phase.",
);
expect(
  firstNotes.variantEvidence?.some(
    (variant) =>
      variant.type === "reverse" && variant.foil === "masterball",
  ),
  "Master Ball reverse evidence should be preserved.",
);
expect(
  firstNotes.materializedPhysicalPrintings?.includes(
    "Master Ball Reverse Holo",
  ),
  "Master Ball reverse evidence should become a named exact identity.",
);
expect(
  secondNotes.materializedPhysicalPrintings?.includes(
    "Shadowless — 1st Edition",
  ),
  "Subtype and stamp evidence should become one exact printing label.",
);
expect(
  !notes.includes("12345.67"),
  "Pricing values must not be stored in Registry notes.",
);

const output = {
  schema: "tcos.checklist.tcgdexJapaneseSimulation.v2",
  status: failures.length ? "failed" : "passed",
  adapter: { id: plan.adapterId, version: plan.adapterVersion },
  release: plan.release,
  counts: plan.validation.counts,
  baseIdentities: baseIdentities.length,
  physicalVariantIdentities: physicalVariantIdentities.length,
  parallelNames,
  languageNamespaced: fingerprints.every((entry) =>
    entry.canonicalKey.endsWith("|language_code=ja"),
  ),
  uniqueDatabaseCardKeys: new Set(databaseKeys).size,
  disambiguatedCards: collisionCards.length,
  variantEvidencePreserved: Boolean(firstNotes.variantEvidence?.length),
  variantsMaterialized: Boolean(
    firstNotes.materializedPhysicalPrintings?.length,
  ),
  pricesDiscarded: !notes.includes("12345.67"),
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
