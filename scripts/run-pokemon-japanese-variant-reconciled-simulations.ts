import assert from "node:assert/strict";

import {
  POKEMON_JAPANESE_POKEBALL_REVERSE_NAME,
  POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA,
  parsePokemonJapaneseVariantReconciledBundle,
  type PokemonJapaneseVariantReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-variant-reconciled";

const productUrl =
  "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=859";
const detailUrl = (cardID: string) =>
  `https://www.pokemon-card.com/card-search/details.php/card/${cardID}/regu/all`;

const bundle: PokemonJapaneseVariantReconciledBundle = {
  schema: POKEMON_JAPANESE_VARIANT_RECONCILED_SCHEMA,
  phase: "official_variant_backfill",
  language: "ja",
  generatedAt: "2026-08-02T00:00:00.000Z",
  baseSource: {
    repository: "https://github.com/tcgdex/cards-database",
    commit: "138c145b80f1a0d6a533f98fd3afe1ffc5b4f8d6",
    setSourcePath: "data-asia/S/S10a.ts",
    sourceCardCount: 2,
  },
  official: {
    resolutionGeneratedAt: "2026-08-02T00:00:00.000Z",
    resolutionSchema:
      "tcos.checklist.pokemonJapaneseHistoricalProductResolution.v1",
    product: {
      value: "859",
      label: "強化拡張パック「ダークファンタズマ」",
      url: productUrl,
    },
    baseCardCount: 3,
    officialPrintingCount: 4,
    sourceBasePrintingCount: 2,
    sourceReversePokeballPrintingCount: 1,
    numberedAddedCardCount: 1,
    printings: [
      {
        bundleCardId: "S10a-001",
        cardID: "100",
        name: "合成ポケモン",
        setCode: "S10a",
        numerator: "001",
        denominator: "071",
        detailUrl: detailUrl("100"),
        origin: "source_base_printing",
        sourcePath: "data-asia/S/S10a/001.ts",
        sourceLocalId: "001",
        parallelName: null,
      },
      {
        bundleCardId: "S10a-001",
        cardID: "200",
        name: "合成ポケモン",
        setCode: "S10a",
        numerator: "001",
        denominator: "071",
        detailUrl: detailUrl("200"),
        origin: "source_reverse_pokeball_printing",
        sourcePath: "data-asia/S/S10a/001.ts",
        sourceLocalId: "001",
        parallelName: POKEMON_JAPANESE_POKEBALL_REVERSE_NAME,
      },
      {
        bundleCardId: "S10a-002",
        cardID: "101",
        name: "通常ポケモン",
        setCode: "S10a",
        numerator: "002",
        denominator: "071",
        detailUrl: detailUrl("101"),
        origin: "source_base_printing",
        sourcePath: "data-asia/S/S10a/002.ts",
        sourceLocalId: "002",
        parallelName: null,
      },
      {
        bundleCardId: "pokemon-card-S10a-300",
        cardID: "300",
        name: "追加ポケモン",
        setCode: "S10a",
        numerator: "072",
        denominator: "071",
        detailUrl: detailUrl("300"),
        origin: "official_numbered_addition",
        sourcePath: null,
        sourceLocalId: null,
        parallelName: null,
      },
    ],
  },
  series: { id: "S", name: "ソード＆シールド" },
  set: {
    id: "S10a",
    name: "ダークファンタズマ",
    officialCardCount: 3,
    releaseDate: "2022-05-13",
    sourcePath: "data-asia/S/S10a.ts",
  },
  cards: [
    {
      id: "S10a-001",
      localId: "001",
      name: "合成ポケモン",
      category: "Pokemon",
      rarity: "C",
      illustrator: "TEST",
      regulationMark: "F",
      dexId: [1],
      variants: [
        {
          type: "normal",
          subtype: null,
          size: null,
          stamps: [],
          foil: null,
          languages: ["ja"],
        },
        {
          type: "reverse",
          subtype: "pokeball",
          size: null,
          stamps: [],
          foil: null,
          languages: ["ja"],
        },
      ],
      sourcePath: "data-asia/S/S10a/001.ts",
    },
    {
      id: "S10a-002",
      localId: "002",
      name: "通常ポケモン",
      category: "Pokemon",
      rarity: "C",
      illustrator: "TEST",
      regulationMark: "F",
      dexId: [2],
      variants: [],
      sourcePath: "data-asia/S/S10a/002.ts",
    },
    {
      id: "pokemon-card-S10a-300",
      localId: "072",
      name: "追加ポケモン",
      category: null,
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
      sourcePath: null,
    },
  ],
};

function parse(value: PokemonJapaneseVariantReconciledBundle) {
  return parsePokemonJapaneseVariantReconciledBundle({
    sourceUrl: productUrl,
    originalFilename: "S-S10a.pokemon-ja-variant-reconciled.bundle.json",
    mimeType: "application/json",
    content: JSON.stringify(value),
    retrievedAt: "2026-08-02T00:00:00.000Z",
    authority: "official_manufacturer",
    redistributionAllowed: false,
  });
}

function clone() {
  return structuredClone(bundle);
}

const plan = parse(bundle);
assert.equal(
  plan.validation.status,
  "passed",
  JSON.stringify(plan.validation.issues, null, 2),
);
assert.deepEqual(plan.validation.counts, {
  sets: 1,
  cards: 3,
  parallels: 1,
  identities: 4,
});
assert.equal(plan.adapterId, "pokemon-japanese-official-variant-reconciled");
assert.equal(plan.adapterVersion, "1.0.0");
assert.equal(plan.parallels[0]?.name, POKEMON_JAPANESE_POKEBALL_REVERSE_NAME);
assert.equal(
  plan.identities.filter((identity) => identity.parallelSourceKey).length,
  1,
);

const variantCard = plan.cards.find((card) => card.cardNumber === "001");
if (!variantCard) throw new Error("Variant card was not materialized.");
const variantNotes = JSON.parse(variantCard.sourceNotes || "{}") as {
  officialPrintingEvidence?: Array<{
    cardID?: string;
    origin?: string;
    parallelName?: string | null;
  }>;
  materializedPhysicalPrintings?: string[];
};
assert.deepEqual(variantNotes.materializedPhysicalPrintings, [
  "Base",
  POKEMON_JAPANESE_POKEBALL_REVERSE_NAME,
]);
assert.deepEqual(
  variantNotes.officialPrintingEvidence?.map((row) => ({
    cardID: row.cardID,
    origin: row.origin,
    parallelName: row.parallelName,
  })),
  [
    {
      cardID: "100",
      origin: "source_base_printing",
      parallelName: null,
    },
    {
      cardID: "200",
      origin: "source_reverse_pokeball_printing",
      parallelName: POKEMON_JAPANESE_POKEBALL_REVERSE_NAME,
    },
  ],
);

const wrongLabel = clone();
wrongLabel.official.printings[1].parallelName = "Reverse Holo";
const wrongLabelPlan = parse(wrongLabel);
assert.equal(wrongLabelPlan.validation.status, "validation_required");
assert.ok(
  wrongLabelPlan.validation.issues.some(
    (entry) => entry.code === "variant_pokeball_reverse_invalid",
  ),
);

const reversedIds = clone();
reversedIds.official.printings[1].cardID = "99";
const reversedIdsPlan = parse(reversedIds);
assert.equal(reversedIdsPlan.validation.status, "validation_required");
assert.ok(
  reversedIdsPlan.validation.issues.some(
    (entry) => entry.code === "variant_pokeball_reverse_invalid",
  ),
);

const missingVariant = clone();
missingVariant.cards[0].variants = [];
const missingVariantPlan = parse(missingVariant);
assert.equal(missingVariantPlan.validation.status, "validation_required");
assert.ok(
  missingVariantPlan.validation.issues.some(
    (entry) => entry.code === "variant_pokeball_reverse_invalid",
  ),
);

const unsupported = clone();
unsupported.set.id = "S11";
unsupported.official.printings = unsupported.official.printings.map((row) => ({
  ...row,
  setCode: "S11",
}));
const unsupportedPlan = parse(unsupported);
assert.equal(unsupportedPlan.validation.status, "validation_required");
assert.ok(
  unsupportedPlan.validation.issues.some(
    (entry) => entry.code === "variant_set_not_supported",
  ),
);

console.log(
  JSON.stringify(
    {
      schema:
        "tcos.checklist.pokemonJapaneseVariantReconciledSimulation.v1",
      status: "passed",
      assertions: 22,
      counts: plan.validation.counts,
      parallel: plan.parallels[0]?.name,
      printingEvidence: variantNotes.officialPrintingEvidence?.length,
      wrongLabelStatus: wrongLabelPlan.validation.status,
      reversedIdsStatus: reversedIdsPlan.validation.status,
      missingVariantStatus: missingVariantPlan.validation.status,
      unsupportedStatus: unsupportedPlan.validation.status,
    },
    null,
    2,
  ),
);
