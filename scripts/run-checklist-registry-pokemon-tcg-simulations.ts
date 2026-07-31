import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  parsePokemonTcgRepositorySnapshot,
  pokemonTcgRepositorySnapshotAdapter,
} from "../src/lib/checklist-registry/pokemon-tcg-repository";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const fixturePath = resolve(
  process.cwd(),
  "scripts/fixtures/checklist-registry/pokemon-tcg-repository.fixture.json",
);
const fixtureText = readFileSync(fixturePath, "utf8");

const artifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://github.com/PokemonTCG/pokemon-tcg-data/blob/master/cards/en/fixture1.json",
  originalFilename: "pokemon-tcg-fixture1.snapshot.json",
  mimeType: "application/json",
  content: fixtureText,
  retrievedAt: "2026-07-31T23:45:00.000Z",
  authority: "approved_dataset",
  redistributionAllowed: true,
};

type Scenario = {
  key: string;
  passed: boolean;
  detail: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
function scenario(
  key: string,
  detail: string,
  passed: boolean,
  evidence: Record<string, unknown>,
) {
  scenarios.push({ key, detail, passed, evidence });
}

const plan = parsePokemonTcgRepositorySnapshot(artifact);

scenario(
  "pokemon_repository_snapshot_parses",
  "A complete Pokémon repository set snapshot produces a validated Checklist Registry import plan.",
  plan.validation.status === "passed" &&
    plan.adapterId === "pokemon-tcg-repository-snapshot" &&
    plan.release.product === "TCOS Fixture Set",
  {
    status: plan.validation.status,
    adapterId: plan.adapterId,
    release: plan.release,
  },
);

scenario(
  "pokemon_import_counts_are_exact",
  "The importer accounts for the set, every card, known finish definitions, and exact identities.",
  plan.validation.counts.sets === 1 &&
    plan.validation.counts.cards === 2 &&
    plan.validation.counts.parallels === 2 &&
    plan.validation.counts.identities === 4,
  plan.validation.counts,
);

const pikachu = plan.cards.find((card) => card.sourceKey === "fixture1-1");
scenario(
  "pokemon_identity_metadata_is_preserved_without_prices",
  "Pokémon source IDs, rarity, artist, Pokédex number, and image URLs are retained while dollar values are not imported.",
  pikachu?.metadata?.pokemonTcgCardId === "fixture1-1" &&
    pikachu?.metadata?.rarity === "Common" &&
    pikachu?.metadata?.artist === "TCOS Fixture Artist" &&
    Array.isArray(pikachu?.metadata?.nationalPokedexNumbers) &&
    pikachu?.metadata?.imageLargeUrl ===
      "https://images.pokemontcg.io/fixture1/1_hires.png" &&
    !("prices" in (pikachu?.metadata || {})),
  {
    metadata: pikachu?.metadata,
  },
);

const pikachuIdentities = plan.identities.filter(
  (identity) => identity.cardSourceKey === "fixture1-1",
);
scenario(
  "pokemon_finishes_remain_distinct",
  "Pikachu Base, Normal, and Reverse Holofoil remain three different exact-card fingerprints.",
  pikachuIdentities.length === 3 &&
    new Set(
      pikachuIdentities.map(
        (identity) => identity.fingerprint.fingerprintSha256,
      ),
    ).size === 3 &&
    new Set(
      pikachuIdentities.map(
        (identity) => identity.fingerprint.normalized.parallel,
      ),
    ).has("reverse holofoil"),
  {
    parallels: pikachuIdentities.map(
      (identity) => identity.fingerprint.normalized.parallel,
    ),
    fingerprints: pikachuIdentities.map(
      (identity) => identity.fingerprint.fingerprintSha256,
    ),
  },
);

scenario(
  "pokemon_source_archive_is_private_and_deterministic",
  "The source snapshot receives a private content-addressed Registry storage path.",
  plan.source.privateArchiveRequired &&
    plan.source.normalizedFactsInternalOnly &&
    plan.source.storage.isPublic === false &&
    plan.source.storage.objectPath.includes(plan.source.storage.sha256),
  {
    storage: plan.source.storage,
  },
);

scenario(
  "pokemon_adapter_only_claims_its_schema",
  "The Pokémon adapter selects its explicit snapshot schema and leaves unrelated JSON to other adapters.",
  pokemonTcgRepositorySnapshotAdapter.supports(artifact) &&
    !pokemonTcgRepositorySnapshotAdapter.supports({
      ...artifact,
      content: JSON.stringify({ schema: "something.else" }),
    }),
  {},
);

const wrongDomainPlan = parsePokemonTcgRepositorySnapshot({
  ...artifact,
  sourceUrl: "https://example.test/pokemon-data.json",
});
scenario(
  "approved_dataset_domain_is_enforced",
  "A source claiming approved-dataset authority must come from PokemonTCG/pokemon-tcg-data.",
  wrongDomainPlan.validation.status === "validation_required" &&
    wrongDomainPlan.validation.issues.some(
      (entry) =>
        entry.code === "approved_dataset_domain_mismatch" &&
        entry.severity === "error",
    ),
  {
    issues: wrongDomainPlan.validation.issues,
  },
);

const duplicateNumberSnapshot = JSON.parse(fixtureText) as {
  cards: Array<{ id: string; number: string }>;
};
duplicateNumberSnapshot.cards[1].number = "1";
const duplicateNumberPlan = parsePokemonTcgRepositorySnapshot({
  ...artifact,
  content: JSON.stringify(duplicateNumberSnapshot),
});
scenario(
  "duplicate_numbers_are_disambiguated_not_collapsed",
  "When a source set contains repeated printed numbers, dataset IDs become explicit variations so cards do not collide.",
  duplicateNumberPlan.validation.status === "passed" &&
    duplicateNumberPlan.validation.issues.some(
      (entry) => entry.code === "duplicate_card_number_disambiguated",
    ) &&
    duplicateNumberPlan.cards.every((card) => card.variation?.startsWith("Dataset ID ")),
  {
    cards: duplicateNumberPlan.cards.map((card) => ({
      sourceKey: card.sourceKey,
      number: card.cardNumber,
      variation: card.variation,
    })),
    issues: duplicateNumberPlan.validation.issues,
  },
);

scenario(
  "all_pokemon_identity_fingerprints_are_unique",
  "No generated Pokémon exact-card identity collides within the import plan.",
  new Set(plan.identities.map((entry) => entry.fingerprint.fingerprintSha256))
    .size === plan.identities.length,
  {
    identityCount: plan.identities.length,
  },
);

const failed = scenarios.filter((entry) => !entry.passed);
const output = {
  schema: "tcos.checklist.pokemonTcgSimulation.v1",
  status: failed.length ? "failed" : "passed",
  scenarioCount: scenarios.length,
  passedCount: scenarios.length - failed.length,
  failedCount: failed.length,
  scenarios,
};

console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exitCode = 1;
