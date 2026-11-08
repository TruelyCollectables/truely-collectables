import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  POKEMON_TCG_DATA_ADAPTER_ID,
  POKEMON_TCG_DATA_ADAPTER_VERSION,
  pokemonTcgDataSetBundleAdapter,
} from "../src/lib/checklist-registry/pokemon-tcg-data";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const fixturePath = resolve(
  "scripts/fixtures/checklist-registry/pokemon-tcg-data-set-bundle.fixture.json",
);
const content = readFileSync(fixturePath);
const artifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://github.com/PokemonTCG/pokemon-tcg-data/tree/master/cards/en",
  originalFilename: "sv-fixture.pokemon-tcg-data.bundle.json",
  mimeType: "application/json",
  content,
  retrievedAt: "2026-07-31T23:30:00.000Z",
  authority: "approved_distributor",
  redistributionAllowed: false,
};

const failures: string[] = [];

function expect(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

expect(
  pokemonTcgDataSetBundleAdapter.supports(artifact),
  "Pokémon adapter should support its set-bundle schema.",
);

const plan = pokemonTcgDataSetBundleAdapter.parse(artifact);
const identityParallels = plan.identities.map(
  (identity) => identity.fingerprint.normalized.parallel,
);
const notes = plan.cards.map((card) => card.sourceNotes || "").join("\n");
const firstCardNotes = JSON.parse(plan.cards[0]?.sourceNotes || "{}") as {
  sourceCardId?: string;
  sourceSetId?: string;
  finishes?: string[];
};

expect(plan.adapterId === POKEMON_TCG_DATA_ADAPTER_ID, "Adapter ID mismatch.");
expect(
  plan.adapterVersion === POKEMON_TCG_DATA_ADAPTER_VERSION,
  "Adapter version mismatch.",
);
expect(plan.validation.status === "passed", "Fixture should pass validation.");
expect(
  plan.release.manufacturer === "The Pokémon Company International",
  "Manufacturer should be normalized for the global Registry.",
);
expect(plan.release.brand === "Pokémon TCG", "Brand should be Pokémon TCG.");
expect(plan.release.product === "Scarlet & Violet Fixture", "Product mismatch.");
expect(plan.release.releaseYear === "2026", "Release year should derive from releaseDate.");
expect(plan.release.sport === "Trading Card Game", "Category mismatch.");
expect(plan.release.league === "Pokémon TCG", "League namespace mismatch.");
expect(plan.sets.length === 1, "Fixture should create one checklist set.");
expect(plan.cards.length === 3, "Fixture should create three cards.");
expect(plan.parallels.length === 2, "Fixture should create two finish parallels.");
expect(plan.identities.length === 4, "Fixture should create four exact identities.");
expect(identityParallels.includes("base"), "Base identity should exist.");
expect(identityParallels.includes("holofoil"), "Holofoil identity should exist.");
expect(
  identityParallels.includes("reverse holofoil"),
  "Reverse Holofoil identity should exist.",
);
expect(
  new Set(plan.identities.map((identity) => identity.fingerprint.fingerprintSha256))
    .size === plan.identities.length,
  "Every Pokémon exact identity should have a unique fingerprint.",
);
expect(
  plan.identities.every(
    (identity) => identity.fingerprint.fingerprintSha256.length === 64,
  ),
  "Every Registry identity should use a SHA-256 fingerprint.",
);
expect(
  firstCardNotes.sourceCardId === "sv-fixture-1",
  "Source card ID should be preserved for future crosswalks.",
);
expect(
  firstCardNotes.sourceSetId === "sv-fixture",
  "Source set ID should be preserved for future crosswalks.",
);
expect(
  firstCardNotes.finishes?.includes("reverseHolofoil"),
  "Finish evidence should be preserved without importing prices.",
);
expect(!notes.includes("12345.67"), "Pricing values must not be stored.");
expect(!notes.includes("23456.78"), "Reverse-holo pricing values must not be stored.");
expect(!notes.includes("34567.89"), "Holofoil pricing values must not be stored.");
expect(
  plan.validation.issues.some((issue) => issue.code === "test_batch_only"),
  "Fixture should warn that it is a test batch.",
);

const output = {
  schema: "tcos.checklist.pokemonSimulation.v1",
  status: failures.length ? "failed" : "passed",
  adapter: {
    id: plan.adapterId,
    version: plan.adapterVersion,
  },
  release: plan.release,
  counts: plan.validation.counts,
  exactIdentityParallels: [...new Set(identityParallels)].sort(),
  pricesDiscarded: !notes.includes("12345.67") && !notes.includes("23456.78"),
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
