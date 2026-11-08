import assert from "node:assert/strict";

import {
  parsePokemonJapaneseOfficialReconciledBundle,
  POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
  type PokemonJapaneseOfficialReconciledBundle,
} from "../src/lib/checklist-registry/pokemon-japanese-official-reconciled";

function fixture(): PokemonJapaneseOfficialReconciledBundle {
  return {
    schema: POKEMON_JAPANESE_OFFICIAL_RECONCILED_SCHEMA,
    phase: "official_gap_backfill",
    language: "ja",
    generatedAt: "2026-08-01T15:00:00.000Z",
    baseSource: {
      repository: "https://github.com/tcgdex/cards-database",
      commit: "138c145b80f1a0d6a533f98fd3afe1ffc5b4f8d6",
      setSourcePath: "data-asia/SV/SV5K.ts",
      baseCardCount: 2,
    },
    official: {
      auditGeneratedAt: "2026-08-01T14:00:00.000Z",
      product: {
        value: "fixture-product",
        label: "拡張パック「ワイルドフォース」",
        url: "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=fixture-product",
      },
      comparableCardCount: 3,
      addedCardCount: 1,
      cards: [
        {
          bundleCardId: "pokemon-card-SV5K-99999",
          cardID: "99999",
          name: "ウネルミナモex",
          setCode: "SV5K",
          numerator: "100",
          denominator: "071",
          detailUrl:
            "https://www.pokemon-card.com/card-search/details.php/card/99999/regu/all",
        },
      ],
    },
    series: { id: "SV", name: "スカーレット&バイオレット" },
    set: {
      id: "SV5K",
      name: "ワイルドフォース",
      officialCardCount: 3,
      releaseDate: "2024-01-26",
      sourcePath: "data-asia/SV/SV5K.ts",
    },
    cards: [
      {
        id: "SV5K-001",
        localId: "001",
        name: "ハヤシガメ",
        variants: [{ type: "normal" }, { type: "holo" }],
        sourcePath: "data-asia/SV/SV5K/001.ts",
      },
      {
        id: "SV5K-002",
        localId: "002",
        name: "ドダイトス",
        variants: [],
        sourcePath: "data-asia/SV/SV5K/002.ts",
      },
      {
        id: "pokemon-card-SV5K-99999",
        localId: "100",
        name: "ウネルミナモex",
        variants: [],
        sourcePath: null,
      },
    ],
  };
}

function artifact(bundle: PokemonJapaneseOfficialReconciledBundle) {
  return {
    sourceUrl: bundle.official.product.url,
    originalFilename:
      "SV-SV5K.pokemon-ja-official-reconciled.bundle.json",
    mimeType: "application/json",
    content: JSON.stringify(bundle),
    retrievedAt: "2026-08-01T15:00:00.000Z",
    authority: "official_manufacturer" as const,
    redistributionAllowed: false,
  };
}

const plan = parsePokemonJapaneseOfficialReconciledBundle(
  artifact(fixture()),
);
assert.equal(plan.validation.status, "passed");
assert.deepEqual(plan.validation.counts, {
  sets: 1,
  cards: 3,
  parallels: 1,
  identities: 4,
});
assert.equal(plan.release.releaseSlug, "tcgdex-ja-sv-sv5k");
assert.equal(plan.source.authority, "official_manufacturer");
assert.equal(plan.cards[0].sourceKey, "tcgdex-ja-card:SV5K:SV5K-001");

const officialCard = plan.cards.find((card) =>
  card.sourceKey.startsWith("pokemon-ja-official-card:"),
);
assert.ok(officialCard);
assert.equal(
  officialCard.sourceKey,
  "pokemon-ja-official-card:SV5K:99999",
);
const notes = JSON.parse(officialCard.sourceNotes || "{}") as Record<
  string,
  unknown
>;
assert.equal(notes.source, "pokemon-card.com");
assert.equal(notes.sourceAuthority, "official_manufacturer");
assert.equal(notes.officialCardId, "99999");
assert.equal(notes.localId, "100");
assert.deepEqual(notes.materializedPhysicalPrintings, ["Base"]);
assert.ok(
  plan.identities.some(
    (identity) => identity.cardSourceKey === officialCard.sourceKey,
  ),
);
assert.ok(
  plan.validation.issues.some(
    (entry) => entry.code === "official_source_gap_backfilled",
  ),
);
assert.equal(JSON.stringify(plan).includes("price"), false);

const badDomain = fixture();
badDomain.official.product.url = "https://example.com/not-official";
const badDomainPlan = parsePokemonJapaneseOfficialReconciledBundle({
  ...artifact(badDomain),
  sourceUrl: badDomain.official.product.url,
});
assert.equal(badDomainPlan.validation.status, "validation_required");
assert.ok(
  badDomainPlan.validation.issues.some(
    (entry) => entry.code === "official_source_domain_mismatch",
  ),
);

const unverifiedVariant = fixture();
unverifiedVariant.cards[2].variants = [{ type: "holo" }];
const unverifiedVariantPlan = parsePokemonJapaneseOfficialReconciledBundle(
  artifact(unverifiedVariant),
);
assert.equal(
  unverifiedVariantPlan.validation.status,
  "validation_required",
);
assert.ok(
  unverifiedVariantPlan.validation.issues.some(
    (entry) => entry.code === "unverified_official_variant_evidence",
  ),
);

const incomplete = fixture();
incomplete.cards.pop();
const incompletePlan = parsePokemonJapaneseOfficialReconciledBundle(
  artifact(incomplete),
);
assert.equal(incompletePlan.validation.status, "validation_required");
assert.ok(
  incompletePlan.validation.issues.some(
    (entry) => entry.code === "official_population_incomplete",
  ),
);

console.log(
  JSON.stringify(
    {
      schema: "tcos.checklist.pokemonJapaneseOfficialGapSimulation.v1",
      status: "passed",
      counts: plan.validation.counts,
      officialCardSourceKey: officialCard.sourceKey,
      releaseSlug: plan.release.releaseSlug,
      privateArchiveRequired: plan.source.privateArchiveRequired,
      pricingDiscarded: !JSON.stringify(plan).includes("price"),
    },
    null,
    2,
  ),
);
