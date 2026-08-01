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
  variantEvidence?: Array<{ type?: string; foil?: string }>;
};
const fingerprints = plan.identities.map((identity) => identity.fingerprint);
const normalizedWithLanguage = fingerprints.map(
  (fingerprint) => fingerprint.normalized as typeof fingerprint.normalized & {
    languageCode?: string;
  },
);

expect(plan.adapterId === TCGDEX_JAPANESE_ADAPTER_ID, "Adapter ID mismatch.");
expect(plan.adapterVersion === TCGDEX_JAPANESE_ADAPTER_VERSION, "Adapter version mismatch.");
expect(plan.validation.status === "passed", "Japanese fixture should pass validation.");
expect(plan.release.product === "ブラックボルト・フィクスチャ", "Japanese product name mismatch.");
expect(plan.release.releaseYear === "2026", "Release year should derive from Japanese release date.");
expect(plan.release.releaseSlug.startsWith("tcgdex-ja-"), "Release slug should use the ja namespace.");
expect(plan.sets.length === 1, "Fixture should create one Japanese set.");
expect(plan.cards.length === 2, "Fixture should create two Japanese base cards.");
expect(plan.parallels.length === 0, "Phase 1 must not create physical parallel rows.");
expect(plan.identities.length === 2, "Fixture should create two base-card identities.");
expect(
  fingerprints.every((fingerprint) => fingerprint.canonicalKey.endsWith("|language_code=ja")),
  "Japanese fingerprints must include the ja language namespace.",
);
expect(
  normalizedWithLanguage.every((normalized) => normalized.languageCode === "ja"),
  "Japanese normalized identities must retain languageCode ja.",
);
expect(
  new Set(fingerprints.map((fingerprint) => fingerprint.fingerprintSha256)).size ===
    fingerprints.length,
  "Japanese exact identities must remain unique.",
);
expect(firstNotes.languageCode === "ja", "Source notes should retain languageCode ja.");
expect(firstNotes.sourceSetId === "SV11B-FIXTURE", "Source set ID should be preserved.");
expect(firstNotes.sourceCardId === "SV11B-FIXTURE-001", "Source card ID should be preserved.");
expect(
  firstNotes.variantEvidence?.some(
    (variant) => variant.type === "reverse" && variant.foil === "masterball",
  ),
  "Master Ball reverse evidence should be preserved for Phase 2.",
);
expect(!notes.includes("12345.67"), "Pricing values must not be stored in Registry notes.");
expect(
  plan.validation.issues.some((entry) => entry.code === "physical_variants_deferred"),
  "Phase 1 should record that physical variants are deferred to Phase 2.",
);

const output = {
  schema: "tcos.checklist.tcgdexJapaneseSimulation.v1",
  status: failures.length ? "failed" : "passed",
  adapter: { id: plan.adapterId, version: plan.adapterVersion },
  release: plan.release,
  counts: plan.validation.counts,
  languageNamespaced: fingerprints.every((entry) =>
    entry.canonicalKey.endsWith("|language_code=ja"),
  ),
  variantEvidencePreserved: Boolean(firstNotes.variantEvidence?.length),
  pricesDiscarded: !notes.includes("12345.67"),
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
