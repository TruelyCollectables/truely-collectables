import assert from "node:assert/strict";

import {
  evaluateCandidateGroup,
  selectBestGroup,
  type HistoricalProduct,
  type OfficialDetail,
} from "./resolve-pokemon-japanese-historical-products";

const productA: HistoricalProduct = { value: "100", label: "Candidate A" };
const productB: HistoricalProduct = { value: "101", label: "Candidate B" };
const source = {
  setId: "SYN",
  setName: "合成セット",
  seriesId: "S",
  seriesName: "ソード＆シールド",
  releaseDate: "2022-01-01",
  officialCardCount: 2,
  sourceSetPath: "data-asia/S/SYN.ts",
  missingJapaneseCardNames: 1,
  sourceCards: [
    {
      localId: "001",
      normalizedLocalId: "1",
      sourcePath: "data-asia/S/SYN/001.ts",
      name: "既知カード",
    },
    {
      localId: "002",
      normalizedLocalId: "2",
      sourcePath: "data-asia/S/SYN/002.ts",
      name: null,
    },
  ],
};

function detail(params: {
  id: string;
  localId: string | null;
  name: string;
  setCode?: string;
  productValues?: string[];
}): OfficialDetail {
  return {
    cardID: params.id,
    productValues: params.productValues || ["100"],
    url: `https://www.pokemon-card.com/card-search/details.php/card/${params.id}/regu/all`,
    name: params.name,
    summaryName: params.name,
    setCode: params.setCode || "SYN",
    numerator: params.localId,
    denominator: "002",
    normalizedLocalId: params.localId ? String(Number(params.localId)) : null,
    error: null,
  };
}

const complete = [
  detail({ id: "1", localId: "001", name: "既知カード" }),
  detail({ id: "2", localId: "002", name: "補完カード" }),
];
const completeWithAddition = [
  ...complete,
  detail({ id: "3", localId: "003", name: "追加カード", productValues: ["101"] }),
];

const single = evaluateCandidateGroup({
  source: source as never,
  seed: { products: [productA], reason: "simulation_single" },
  details: complete,
});
assert.equal(single.valid, true);
assert.equal(single.sourceMatchedCards, 2);
assert.equal(single.resolvedMissingNames, 1);
assert.equal(single.officialOnlyCards.length, 0);

const union = evaluateCandidateGroup({
  source: source as never,
  seed: { products: [productA, productB], reason: "simulation_union" },
  details: completeWithAddition,
});
assert.equal(union.valid, true);
assert.equal(union.officialComparableCards, 3);
assert.equal(union.officialOnlyCards.length, 1);

const selectedUnion = selectBestGroup([single, union]);
assert.equal(selectedUnion.selected?.products.length, 2);
assert.equal(selectedUnion.reason, "multi_product_union_proved");

const missing = evaluateCandidateGroup({
  source: source as never,
  seed: { products: [productA], reason: "simulation_missing" },
  details: complete.slice(0, 1),
});
assert.equal(missing.valid, false);
assert.ok(missing.reasons.includes("source_cards_not_crosswalked"));

const duplicate = evaluateCandidateGroup({
  source: source as never,
  seed: { products: [productA], reason: "simulation_duplicate" },
  details: [
    ...complete,
    detail({ id: "22", localId: "002", name: "補完カード" }),
  ],
});
assert.equal(duplicate.valid, false);
assert.ok(duplicate.reasons.includes("duplicate_official_printed_numbers"));

const nameMismatch = evaluateCandidateGroup({
  source: source as never,
  seed: { products: [productA], reason: "simulation_name_mismatch" },
  details: [
    detail({ id: "1", localId: "001", name: "違う名前" }),
    detail({ id: "2", localId: "002", name: "補完カード" }),
  ],
});
assert.equal(nameMismatch.valid, false);
assert.ok(nameMismatch.reasons.includes("known_japanese_name_mismatch"));

const alternatePopulation = evaluateCandidateGroup({
  source: source as never,
  seed: { products: [productB], reason: "simulation_alternate" },
  details: [
    detail({ id: "10", localId: "001", name: "既知カード", productValues: ["101"] }),
    detail({ id: "20", localId: "002", name: "補完カード", productValues: ["101"] }),
  ],
});
const ambiguous = selectBestGroup([single, alternatePopulation]);
assert.equal(ambiguous.selected, null);
assert.equal(
  ambiguous.reason,
  "multiple_valid_groups_with_different_official_populations",
);

console.log(
  JSON.stringify(
    {
      schema: "tcos.checklist.pokemonJapaneseHistoricalProductResolutionSimulation.v1",
      status: "passed",
      assertions: 18,
      singleProduct: single.officialComparableCards,
      unionProduct: union.officialComparableCards,
      blockedMissing: missing.reasons,
      blockedDuplicate: duplicate.reasons,
      blockedNameMismatch: nameMismatch.reasons,
      ambiguousReason: ambiguous.reason,
    },
    null,
    2,
  ),
);
