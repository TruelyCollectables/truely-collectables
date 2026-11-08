import assert from "node:assert/strict";

import {
  POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA,
  parsePokemonJapaneseHistoricalReconciledBundle,
  type PokemonJapaneseHistoricalReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-historical-reconciled";

const productUrl =
  "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=999";
const detailUrl = (cardID: string) =>
  `https://www.pokemon-card.com/card-search/details.php/card/${cardID}/regu/all`;

const bundle: PokemonJapaneseHistoricalReconciledBundle = {
  schema: POKEMON_JAPANESE_HISTORICAL_RECONCILED_SCHEMA,
  phase: "official_historical_backfill",
  language: "ja",
  generatedAt: "2026-08-01T00:00:00.000Z",
  baseSource: {
    repository: "https://github.com/tcgdex/cards-database",
    commit: "138c145b80f1a0d6a533f98fd3afe1ffc5b4f8d6",
    setSourcePath: "data-asia/S/SYN.ts",
    sourceCardCount: 2,
  },
  official: {
    resolutionGeneratedAt: "2026-08-01T00:00:00.000Z",
    resolutionSchema:
      "tcos.checklist.pokemonJapaneseHistoricalProductResolution.v1",
    product: {
      value: "999",
      label: "合成商品",
      url: productUrl,
    },
    officialCardCount: 4,
    sourceNumberCrosswalkCount: 1,
    sourceEnergyAliasCount: 1,
    numberedAddedCardCount: 1,
    unnumberedAddedCardCount: 1,
    cards: [
      {
        bundleCardId: "SYN-001",
        cardID: "100",
        name: "合成ポケモン",
        setCode: "SYN",
        numerator: "001",
        denominator: "004",
        detailUrl: detailUrl("100"),
        origin: "source_number_crosswalk",
        sourcePath: "data-asia/S/SYN/001.ts",
        sourceLocalId: "001",
        variation: null,
      },
      {
        bundleCardId: "SYN-GRA",
        cardID: "200",
        name: "基本草エネルギー",
        setCode: "SYN",
        numerator: null,
        denominator: null,
        detailUrl: detailUrl("200"),
        origin: "source_energy_alias",
        sourcePath: "data-asia/S/SYN/GRA.ts",
        sourceLocalId: "GRA",
        variation: null,
      },
      {
        bundleCardId: "pokemon-card-SYN-300",
        cardID: "300",
        name: "追加カード",
        setCode: "SYN",
        numerator: "003",
        denominator: "004",
        detailUrl: detailUrl("300"),
        origin: "official_numbered_addition",
        sourcePath: null,
        sourceLocalId: null,
        variation: null,
      },
      {
        bundleCardId: "pokemon-card-SYN-400",
        cardID: "400",
        name: "基本炎エネルギー",
        setCode: "SYN",
        numerator: null,
        denominator: null,
        detailUrl: detailUrl("400"),
        origin: "official_unnumbered_energy_addition",
        sourcePath: null,
        sourceLocalId: null,
        variation: "Official Card 400",
      },
    ],
  },
  series: { id: "S", name: "ソード＆シールド" },
  set: {
    id: "SYN",
    name: "合成セット",
    officialCardCount: 4,
    releaseDate: "2022-01-01",
    sourcePath: "data-asia/S/SYN.ts",
  },
  cards: [
    {
      id: "SYN-001",
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
          type: "holo",
          subtype: null,
          size: null,
          stamps: [],
          foil: null,
          languages: ["ja"],
        },
      ],
      sourcePath: "data-asia/S/SYN/001.ts",
    },
    {
      id: "SYN-GRA",
      localId: "GRA",
      name: "基本草エネルギー",
      category: "Energy",
      rarity: null,
      illustrator: null,
      regulationMark: "F",
      dexId: [],
      variants: [],
      sourcePath: "data-asia/S/SYN/GRA.ts",
    },
    {
      id: "pokemon-card-SYN-300",
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
    {
      id: "pokemon-card-SYN-400",
      localId: "UNNUMBERED",
      name: "基本炎エネルギー",
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

function parse(value: PokemonJapaneseHistoricalReconciledBundle) {
  return parsePokemonJapaneseHistoricalReconciledBundle({
    sourceUrl: productUrl,
    originalFilename: "S-SYN.pokemon-ja-historical-reconciled.bundle.json",
    mimeType: "application/json",
    content: JSON.stringify(value),
    retrievedAt: "2026-08-01T00:00:00.000Z",
    authority: "official_manufacturer",
    redistributionAllowed: false,
  });
}

function clone() {
  return structuredClone(bundle);
}

const plan = parse(bundle);
assert.equal(plan.validation.status, "passed");
assert.deepEqual(plan.validation.counts, {
  sets: 1,
  cards: 4,
  parallels: 1,
  identities: 5,
});
assert.equal(
  plan.adapterId,
  "pokemon-japanese-official-historical-reconciled",
);
assert.equal(plan.adapterVersion, "1.0.0");

const unnumbered = plan.cards.find((card) => {
  const notes = JSON.parse(card.sourceNotes || "{}") as {
    officialCardId?: string;
  };
  return notes.officialCardId === "400";
});
assert.ok(unnumbered);
assert.equal(unnumbered.cardNumber, "UNNUMBERED");
assert.equal(unnumbered.variation, "Official Card 400");
const unnumberedNotes = JSON.parse(unnumbered.sourceNotes || "{}") as {
  officialPrintedNumber?: unknown;
  officialUnnumbered?: unknown;
  materializedPhysicalPrintings?: unknown;
};
assert.equal(unnumberedNotes.officialPrintedNumber, null);
assert.equal(unnumberedNotes.officialUnnumbered, true);
assert.deepEqual(unnumberedNotes.materializedPhysicalPrintings, ["Base"]);
const unnumberedIdentity = plan.identities.find(
  (identity) => identity.cardSourceKey === unnumbered.sourceKey,
);
assert.ok(unnumberedIdentity);
assert.equal(
  unnumberedIdentity.fingerprint.normalized.variation,
  "official card 400",
);

const alias = plan.cards.find((card) => card.cardNumber === "GRA");
assert.ok(alias);
const aliasNotes = JSON.parse(alias.sourceNotes || "{}") as {
  officialPrintedNumber?: unknown;
  officialEvidenceOrigin?: unknown;
  tcgdexSourceLocalId?: unknown;
};
assert.equal(aliasNotes.officialPrintedNumber, null);
assert.equal(aliasNotes.officialEvidenceOrigin, "source_energy_alias");
assert.equal(aliasNotes.tcgdexSourceLocalId, "GRA");

const held = clone();
held.set.id = "S10a";
held.official.cards = held.official.cards.map((row) => ({
  ...row,
  setCode: "S10a",
}));
const heldPlan = parse(held);
assert.equal(heldPlan.validation.status, "validation_required");
assert.ok(
  heldPlan.validation.issues.some(
    (issue) => issue.code === "variant_review_set_blocked",
  ),
);

const badAlias = clone();
badAlias.official.cards[1].name = "基本炎エネルギー";
badAlias.cards[1].name = "基本炎エネルギー";
const badAliasPlan = parse(badAlias);
assert.equal(badAliasPlan.validation.status, "validation_required");
assert.ok(
  badAliasPlan.validation.issues.some(
    (issue) => issue.code === "source_energy_alias_invalid",
  ),
);

const badVariation = clone();
badVariation.official.cards[3].variation = "Official Card 999";
const badVariationPlan = parse(badVariation);
assert.equal(badVariationPlan.validation.status, "validation_required");
assert.ok(
  badVariationPlan.validation.issues.some(
    (issue) => issue.code === "official_unnumbered_addition_invalid",
  ),
);

const duplicate = clone();
duplicate.official.cards[3].cardID = "300";
const duplicatePlan = parse(duplicate);
assert.equal(duplicatePlan.validation.status, "validation_required");
assert.ok(
  duplicatePlan.validation.issues.some(
    (issue) => issue.code === "official_card_evidence_duplicate",
  ),
);

console.log(
  JSON.stringify(
    {
      schema:
        "tcos.checklist.pokemonJapaneseHistoricalReconciledSimulation.v1",
      status: "passed",
      assertions: 24,
      counts: plan.validation.counts,
      adapterId: plan.adapterId,
      adapterVersion: plan.adapterVersion,
      unnumberedVariation: unnumbered.variation,
      aliasOrigin: aliasNotes.officialEvidenceOrigin,
      heldStatus: heldPlan.validation.status,
      badAliasStatus: badAliasPlan.validation.status,
      badVariationStatus: badVariationPlan.validation.status,
      duplicateStatus: duplicatePlan.validation.status,
    },
    null,
    2,
  ),
);
