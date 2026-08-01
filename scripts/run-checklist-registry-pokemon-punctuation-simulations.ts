import { createHash } from "node:crypto";

import { pokemonTcgDataSourceIdSafeAdapter } from "../src/lib/checklist-registry/pokemon-tcg-data-source-ids";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const bundle = {
  schema: "tcos.pokemonTcgData.setBundle.v1",
  scope: "full_set",
  language: "en",
  set: {
    id: "ex10-punctuation-fixture",
    name: "Unseen Forces Punctuation Fixture",
    series: "EX",
    printedTotal: 2,
    total: 2,
    releaseDate: "2005/08/01",
  },
  cards: [
    {
      id: "ex10-!",
      name: "Unown",
      number: "!",
      supertype: "Pokémon",
      subtypes: ["Basic"],
      rarity: "Rare",
    },
    {
      id: "ex10-?",
      name: "Unown",
      number: "?",
      supertype: "Pokémon",
      subtypes: ["Basic"],
      rarity: "Rare",
    },
  ],
} as const;

const content = JSON.stringify(bundle);
const artifact: ChecklistSourceArtifact = {
  sourceUrl:
    "https://github.com/PokemonTCG/pokemon-tcg-data/blob/master/cards/en/ex10.json",
  originalFilename: "ex10.pokemon-tcg-data.bundle.json",
  mimeType: "application/json",
  content,
  retrievedAt: "2026-07-31T19:45:00.000-06:00",
  authority: "approved_reference_dataset",
  redistributionAllowed: false,
};

const failures: string[] = [];
function expect(condition: unknown, message: string) {
  if (!condition) failures.push(message);
}

const plan = pokemonTcgDataSourceIdSafeAdapter.parse(artifact);
const sourceIds = plan.cards.map((card) => {
  const notes = JSON.parse(card.sourceNotes || "{}") as { sourceCardId?: string };
  return notes.sourceCardId;
});
const sourceKeys = plan.cards.map((card) => card.sourceKey);
const cardNumbers = plan.identities.map(
  (identity) => identity.fingerprint.normalized.cardNumber,
);
const expectedSha256 = createHash("sha256").update(content, "utf8").digest("hex");

expect(plan.validation.status === "passed", "Punctuation fixture should validate.");
expect(plan.cards.length === 2, "Both punctuation cards should be retained.");
expect(plan.identities.length === 2, "Both punctuation identities should exist.");
expect(new Set(sourceKeys).size === 2, "Punctuation source keys must remain unique.");
expect(sourceKeys.includes("pokemon-card:ex10-!"), "Unown ! source key is missing.");
expect(sourceKeys.includes("pokemon-card:ex10-%3F"), "Unown ? source key is missing.");
expect(sourceIds.includes("ex10-!"), "Unown ! source ID should be restored.");
expect(sourceIds.includes("ex10-?"), "Unown ? source ID should be restored.");
expect(cardNumbers.includes("!"), "Unown ! identity number is missing.");
expect(cardNumbers.includes("?"), "Unown ? identity number is missing.");
expect(
  !plan.validation.issues.some((issue) => issue.code === "duplicate_card"),
  "Punctuation cards must not be reported as duplicates.",
);
expect(
  !plan.validation.issues.some((issue) => issue.code === "set_total_mismatch"),
  "Complete punctuation fixture should match the source total.",
);
expect(
  plan.source.storage.sha256 === expectedSha256,
  "Archived source hash must describe the original unmodified file.",
);

const output = {
  schema: "tcos.checklist.pokemonPunctuationSimulation.v1",
  status: failures.length ? "failed" : "passed",
  counts: plan.validation.counts,
  sourceKeys,
  sourceIds,
  cardNumbers,
  originalSourceHashPreserved: plan.source.storage.sha256 === expectedSha256,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exitCode = 1;
