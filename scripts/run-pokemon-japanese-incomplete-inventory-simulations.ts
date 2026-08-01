import assert from "node:assert/strict";

import {
  analyzeOfficialCrosswalk,
  mapOfficialProducts,
  normalizedLocalId,
  parseOfficialDetail,
  parseOfficialProductOptions,
} from "./inventory-pokemon-japanese-incomplete-sets";

const options = parseOfficialProductOptions(`
<script>
const rows = [
  { name: "pg", value: "1001", group: "group-item-name", label: "ワイルドフォース" },
  { name: "pg", value: "1002", group: "group-item-name", label: "超電ブレイカー" },
  { name: "pg", value: "1003", group: "group-item-name", label: "同名商品" },
  { name: "pg", value: "1004", group: "group-item-name", label: "同名商品" }
];
</script>
`);
assert.equal(options.length, 4);
assert.deepEqual(mapOfficialProducts("SV5K", "ワイルドフォース", options), [
  { value: "1001", label: "ワイルドフォース" },
]);
assert.equal(mapOfficialProducts("TEST", "同名商品", options).length, 2);
assert.equal(normalizedLocalId("001"), "1");
assert.equal(normalizedLocalId("  SV-P  "), "SV-P");

const parsedDetail = parseOfficialDetail(`
<html>
  <h1 class="Heading1">テストカード</h1>
  <img class="img-regulation" alt="TST" src="set.png">
  &nbsp; 002 &nbsp;/&nbsp; 100 &nbsp;
</html>
`);
assert.deepEqual(parsedDetail, {
  name: "テストカード",
  setCode: "TST",
  numerator: "002",
  denominator: "100",
});

const source = {
  setId: "TST",
  setName: "テストセット",
  seriesId: "TEST",
  seriesName: "テストシリーズ",
  releaseDate: "2026-01-01",
  officialCardCount: 3,
  sourceSetPath: "data-asia/TEST/TST.ts",
  missingJapaneseCardNames: 1,
  sourceCards: [
    {
      localId: "001",
      normalizedLocalId: "1",
      sourcePath: "data-asia/TEST/TST/001.ts",
      name: "既知カード",
      category: "Pokemon",
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
    },
    {
      localId: "002",
      normalizedLocalId: "2",
      sourcePath: "data-asia/TEST/TST/002.ts",
      name: null,
      category: "Pokemon",
      rarity: null,
      illustrator: null,
      regulationMark: null,
      dexId: [],
      variants: [],
    },
  ],
};

const product = { value: "2001", label: "テストセット" };
const details = [
  {
    cardID: "9001",
    url: "https://example.test/9001",
    status: 200,
    name: "既知カード",
    summaryName: "既知カード",
    setCode: "TST",
    numerator: "001",
    denominator: "003",
    normalizedLocalId: "1",
    error: null,
  },
  {
    cardID: "9002",
    url: "https://example.test/9002",
    status: 200,
    name: "補完カード",
    summaryName: "補完カード",
    setCode: "TST",
    numerator: "002",
    denominator: "003",
    normalizedLocalId: "2",
    error: null,
  },
  {
    cardID: "9003",
    url: "https://example.test/9003",
    status: 200,
    name: "追加カード",
    summaryName: "追加カード",
    setCode: "TST",
    numerator: "003",
    denominator: "003",
    normalizedLocalId: "3",
    error: null,
  },
];

const cleanCrosswalk = analyzeOfficialCrosswalk({
  source,
  product,
  hitCount: 3,
  details,
});
assert.equal(cleanCrosswalk.status, "ready_for_card_backfill_proposal");
assert.equal(cleanCrosswalk.resolvedMissingNames.length, 1);
assert.equal(cleanCrosswalk.resolvedMissingNames[0].officialName, "補完カード");
assert.equal(cleanCrosswalk.officialOnlyCards.length, 1);
assert.equal(cleanCrosswalk.sourceOnlyLocalIds.length, 0);

const nameOnlyCrosswalk = analyzeOfficialCrosswalk({
  source: {
    ...source,
    officialCardCount: 2,
  },
  product,
  hitCount: 2,
  details: details.slice(0, 2),
});
assert.equal(nameOnlyCrosswalk.status, "ready_for_name_backfill");
assert.equal(nameOnlyCrosswalk.officialOnlyCards.length, 0);

const duplicateCrosswalk = analyzeOfficialCrosswalk({
  source,
  product,
  hitCount: 4,
  details: [
    ...details,
    {
      ...details[1],
      cardID: "9902",
      url: "https://example.test/9902",
    },
  ],
});
assert.equal(duplicateCrosswalk.status, "partial_official_crosswalk");
assert.deepEqual(duplicateCrosswalk.duplicateOfficialLocalIds, [
  { localId: "2", cardIDs: ["9002", "9902"] },
]);

const wrongCodeCrosswalk = analyzeOfficialCrosswalk({
  source,
  product,
  hitCount: 3,
  details: details.map((detail) => ({ ...detail, setCode: "OTHER" })),
});
assert.equal(wrongCodeCrosswalk.status, "partial_official_crosswalk");
assert.ok(
  wrongCodeCrosswalk.reasons.includes("official_target_set_code_unresolved"),
);

console.log(
  JSON.stringify(
    {
      schema: "tcos.checklist.pokemonJapaneseIncompleteInventorySimulation.v1",
      status: "passed",
      assertions: 19,
      readyForNameBackfill: nameOnlyCrosswalk.status,
      readyForCardBackfill: cleanCrosswalk.status,
      duplicateStatus: duplicateCrosswalk.status,
      wrongCodeStatus: wrongCodeCrosswalk.status,
    },
    null,
    2,
  ),
);
