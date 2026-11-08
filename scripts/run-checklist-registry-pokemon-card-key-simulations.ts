import { createHash } from "node:crypto";

import { pokemonTcgDataSourceIdSafeAdapter } from "../src/lib/checklist-registry/pokemon-tcg-data-source-ids";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const bundle = {
  schema: "tcos.pokemonTcgData.setBundle.v1",
  scope: "full_set",
  language: "en",
  set: {
    id: "database-key-collision-fixture",
    name: "Database Key Collision Fixture",
    series: "Regression",
    printedTotal: 7,
    total: 7,
    releaseDate: "2026/08/01",
  },
  cards: [
    { id: "fixture-15-a", name: "Venusaur", number: "15" },
    { id: "fixture-15-b", name: "Here Comes Team Rocket!", number: "15" },
    { id: "fixture-exclamation", name: "Unown", number: "!" },
    { id: "fixture-question", name: "Unown", number: "?" },
    { id: "fixture-a-dash-1", name: "Variant Alpha", number: "A-1" },
    { id: "fixture-a-space-1", name: "Variant Beta", number: "A 1" },
    { id: "fixture-99", name: "Unique Card", number: "99" },
  ],
} as const;

const content = JSON.stringify(bundle);
const artifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://github.com/PokemonTCG/pokemon-tcg-data/tree/master/cards/en",
  originalFilename: "database-key-collision-fixture.pokemon-tcg-data.bundle.json",
  mimeType: "application/json",
  content,
  retrievedAt: "2026-08-01T02:45:00.000Z",
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

const plan = pokemonTcgDataSourceIdSafeAdapter.parse(artifact);
const databaseKeys = plan.cards.map((card) =>
  [
    card.setSourceKey,
    databaseNormalizedCardNumber(card.cardNumber),
    databaseNormalizedVariation(card.variation),
  ].join("|"),
);
const cardsBySourceId = new Map(
  plan.cards.map((card) => {
    const notes = JSON.parse(card.sourceNotes || "{}") as { sourceCardId?: string };
    return [notes.sourceCardId || "", card] as const;
  }),
);
const expectedSha256 = createHash("sha256").update(content, "utf8").digest("hex");
const disambiguatedCards = plan.cards.filter((card) => card.variation);
const untouchedCard = cardsBySourceId.get("fixture-99");

expect(plan.validation.status === "passed", "Collision fixture should validate.");
expect(plan.adapterVersion === "1.0.2", "Corrected adapter version should be 1.0.2.");
expect(plan.cards.length === 7, "All seven source cards should be retained.");
expect(plan.identities.length === 7, "All seven exact identities should exist.");
expect(
  new Set(databaseKeys).size === databaseKeys.length,
  "Every Registry database card key should be unique.",
);
expect(
  disambiguatedCards.length === 6,
  "Only the six colliding cards should receive source-backed variations.",
);
expect(
  disambiguatedCards.every((card) =>
    /^Source Variant [a-f0-9]+$/.test(card.variation || ""),
  ),
  "Collision variations should use stable alphanumeric source tokens.",
);
expect(
  untouchedCard?.variation === null,
  "A unique card number should not receive a synthetic variation.",
);
expect(
  plan.validation.issues.some(
    (issue) => issue.code === "database_card_key_disambiguated",
  ),
  "The plan should record an auditable collision-disambiguation warning.",
);
expect(
  new Set(plan.identities.map((identity) => identity.fingerprint.fingerprintSha256))
    .size === plan.identities.length,
  "Rebuilt exact identities should remain unique.",
);
expect(
  plan.identities
    .filter((identity) => identity.cardSourceKey !== "pokemon-card:fixture-99")
    .every((identity) => identity.fingerprint.normalized.variation),
  "Disambiguated card identities should carry the same variation as their card rows.",
);
expect(
  plan.source.storage.sha256 === expectedSha256,
  "Private archive hash should continue to describe the original source bundle.",
);

const output = {
  schema: "tcos.checklist.pokemonDatabaseCardKeySimulation.v1",
  status: failures.length ? "failed" : "passed",
  adapterVersion: plan.adapterVersion,
  counts: plan.validation.counts,
  disambiguatedCards: disambiguatedCards.length,
  uniqueDatabaseKeys: new Set(databaseKeys).size,
  uniqueFingerprints: new Set(
    plan.identities.map((identity) => identity.fingerprint.fingerprintSha256),
  ).size,
  originalSourceHashPreserved: plan.source.storage.sha256 === expectedSha256,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
