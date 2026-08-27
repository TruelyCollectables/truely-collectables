import assert from "node:assert/strict";

import {
  POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_ID,
  POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_VERSION,
  POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA,
  parsePokemonJapaneseIncompleteReconciledBundle,
  type PokemonJapaneseIncompleteReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-incomplete-reconciled";

const productUrl =
  "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=fixture";

const bundle: PokemonJapaneseIncompleteReconciledBundle = {
  schema: POKEMON_JAPANESE_INCOMPLETE_RECONCILED_SCHEMA,
  phase: "official_incomplete_backfill",
  language: "ja",
  generatedAt: "2026-08-01T00:00:00.000Z",
  baseSource: {
    repository: "https://github.com/tcgdex/cards-database",
    commit: "1".repeat(40),
    setSourcePath: "data-asia/SV/TST.ts",
    sourceCardCount: 2,
  },
  official: {
    inventoryGeneratedAt: "2026-08-01T00:00:00.000Z",
    product: {
      value: "fixture",
      label: "テストセット",
      url: productUrl,
    },
    comparableCardCount: 3,
    sourceCardCount: 2,
    preservedNamedCardCount: 1,
    nameBackfilledCardCount: 1,
    addedCardCount: 1,
    cards: [
      {
        bundleCardId: "TST-001",
        cardID: "50001",
        name: "既知カード",
        setCode: "TST",
        numerator: "001",
        denominator: "002",
        detailUrl:
          "https://www.pokemon-card.com/card-search/details.php/card/50001/regu/all",
        origin: "source_preserved_name",
        sourcePath: "data-asia/SV/TST/001.ts",
      },
      {
        bundleCardId: "TST-002",
        cardID: "50002",
        name: "補完カード",
        setCode: "TST",
        numerator: "002",
        denominator: "002",
        detailUrl:
          "https://www.pokemon-card.com/card-search/details.php/card/50002/regu/all",
        origin: "source_name_backfill",
        sourcePath: "data-asia/SV/TST/002.ts",
      },
      {
        bundleCardId: "pokemon-card-TST-50003",
        cardID: "50003",
        name: "追加カード",
        setCode: "TST",
        numerator: "003",
        denominator: "002",
        detailUrl:
          "https://www.pokemon-card.com/card-search/details.php/card/50003/regu/all",
        origin: "official_only_addition",
        sourcePath: null,
      },
    ],
  },
  series: { id: "SV", name: "テストシリーズ" },
  set: {
    id: "TST",
    name: "テストセット",
    officialCardCount: 3,
    releaseDate: "2026-01-01",
    sourcePath: "data-asia/SV/TST.ts",
  },
  cards: [
    {
      id: "TST-001",
      localId: "001",
      name: "既知カード",
      category: "Pokemon",
      rarity: null,
      illustrator: null,
      regulationMark: "I",
      dexId: [],
      variants: [],
      sourcePath: "data-asia/SV/TST/001.ts",
    },
    {
      id: "TST-002",
      localId: "002",
      name: "補完カード",
      category: "Pokemon",
      rarity: null,
      illustrator: null,
      regulationMark: "I",
      dexId: [],
      variants: [{ type: "normal" }, { type: "holo" }],
      sourcePath: "data-asia/SV/TST/002.ts",
    },
    {
      id: "pokemon-card-TST-50003",
      localId: "003",
      name: "追加カード",
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

function parse(candidate: PokemonJapaneseIncompleteReconciledBundle) {
  return parsePokemonJapaneseIncompleteReconciledBundle({
    sourceUrl: productUrl,
    originalFilename: "SV-TST.pokemon-ja-incomplete-reconciled.bundle.json",
    mimeType: "application/json",
    content: JSON.stringify(candidate),
    retrievedAt: "2026-08-01T00:00:00.000Z",
    authority: "official_manufacturer",
    redistributionAllowed: false,
  });
}

const plan = parse(bundle);
assert.equal(plan.adapterId, POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_ID);
assert.equal(
  plan.adapterVersion,
  POKEMON_JAPANESE_INCOMPLETE_RECONCILED_ADAPTER_VERSION,
);
assert.equal(plan.validation.status, "passed");
assert.deepEqual(plan.validation.counts, {
  sets: 1,
  cards: 3,
  parallels: 1,
  identities: 4,
});
assert.equal(
  plan.validation.issues.filter((issue) => issue.severity === "error").length,
  0,
);

const cardByNumber = new Map(plan.cards.map((card) => [card.cardNumber, card]));
const preserved = cardByNumber.get("001");
const backfilled = cardByNumber.get("002");
const addition = cardByNumber.get("003");
assert.ok(preserved?.sourceKey.startsWith("tcgdex-ja-card:TST:"));
assert.ok(backfilled?.sourceKey.startsWith("pokemon-ja-official-card:TST:"));
assert.ok(addition?.sourceKey.startsWith("pokemon-ja-official-card:TST:"));
assert.equal(JSON.parse(preserved?.sourceNotes || "{}").officialIdentityVerified, true);
assert.equal(
  JSON.parse(backfilled?.sourceNotes || "{}").officialEvidenceOrigin,
  "source_name_backfill",
);
assert.deepEqual(
  JSON.parse(backfilled?.sourceNotes || "{}").materializedPhysicalPrintings,
  ["Base", "Holo"],
);
assert.equal(
  JSON.parse(addition?.sourceNotes || "{}").officialEvidenceOrigin,
  "official_only_addition",
);
assert.deepEqual(
  JSON.parse(addition?.sourceNotes || "{}").materializedPhysicalPrintings,
  ["Base"],
);

const invalidAddition = structuredClone(bundle);
invalidAddition.cards[2].variants = [{ type: "holo" }];
const invalidAdditionPlan = parse(invalidAddition);
assert.equal(invalidAdditionPlan.validation.status, "validation_required");
assert.ok(
  invalidAdditionPlan.validation.issues.some(
    (issue) => issue.code === "unverified_official_variant_evidence",
  ),
);

const incompleteEvidence = structuredClone(bundle);
incompleteEvidence.official.cards = incompleteEvidence.official.cards.slice(0, 2);
const incompletePlan = parse(incompleteEvidence);
assert.equal(incompletePlan.validation.status, "validation_required");
assert.ok(
  incompletePlan.validation.issues.some(
    (issue) => issue.code === "official_population_incomplete",
  ),
);

console.log(
  JSON.stringify(
    {
      schema:
        "tcos.checklist.pokemonJapaneseIncompleteReconciledSimulation.v1",
      status: "passed",
      assertions: 16,
      counts: plan.validation.counts,
      adapterId: plan.adapterId,
      adapterVersion: plan.adapterVersion,
      invalidAdditionStatus: invalidAdditionPlan.validation.status,
      incompleteEvidenceStatus: incompletePlan.validation.status,
    },
    null,
    2,
  ),
);
