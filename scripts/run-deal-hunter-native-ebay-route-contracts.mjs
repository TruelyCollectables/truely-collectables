import assert from "node:assert/strict";
import {
  buildDealHunterEbayQueryFamilies,
  DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT,
  DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT,
  extractEbayItemId,
  parseDealHunterPlayers,
  screenDealHunterEbayTitle,
} from "../src/lib/deal-hunter-ebay-query-families.js";

const wnba = buildDealHunterEbayQueryFamilies({ scope: "wnba" });
assert.equal(wnba.length, DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT);
assert.equal(new Set(wnba.map((family) => family.familyId)).size, 15);
for (const player of [
  "Caitlin Clark",
  "Paige Bueckers",
  "Dominique Malonga",
  "Sonia Citron",
  "Kiki Iriafen",
]) {
  const families = wnba.filter((family) => family.watchedPerson === player);
  assert.equal(families.length, 3);
  assert.deepEqual(
    new Set(families.map((family) => family.lane)),
    new Set([
      "broad_professional_rookies",
      "silver_color_numbered_ssp",
      "autograph_memorabilia",
    ]),
  );
}

const michkov = buildDealHunterEbayQueryFamilies({
  scope: "matvei_michkov_young_guns",
});
assert.equal(michkov.length, DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT);
assert.equal(new Set(michkov.map((family) => family.familyId)).size, 8);
assert.ok(michkov.every((family) => family.watchedPerson === "Matvei Michkov"));
assert.ok(michkov.every((family) => family.itemType === "young_guns_rookie_card"));
assert.ok(michkov.some((family) => /Matvey Michkov/i.test(family.query)));
assert.ok(michkov.some((family) => /Matvei Michov/i.test(family.query)));
assert.ok(michkov.some((family) => /Mitchkov/i.test(family.query)));

const canonicalMichkov = screenDealHunterEbayTitle({
  title: "2024-25 Upper Deck Matvei Michkov Young Guns Rookie RC",
  family: michkov[0],
});
assert.equal(canonicalMichkov.accepted, true);
assert.equal(canonicalMichkov.manualReviewRequired, false);

const misspelledMichkov = screenDealHunterEbayTitle({
  title: "2024-25 Upper Deck Matvey Michov Young Guns Rookie",
  family: michkov[3],
});
assert.equal(misspelledMichkov.accepted, true);
assert.equal(misspelledMichkov.manualReviewRequired, true);
assert.ok(
  misspelledMichkov.reviewReasons.includes(
    "seller_name_variant_or_misspelling_detected_verify_images",
  ),
);

assert.equal(
  screenDealHunterEbayTitle({
    title: "Upper Deck Matvei Michkov Dazzlers Rookie",
    family: michkov[0],
  }).accepted,
  false,
);
assert.equal(
  screenDealHunterEbayTitle({
    title: "Upper Deck Matvei Michkov Young Guns Checklist",
    family: michkov[0],
  }).accepted,
  false,
);

const players = parseDealHunterPlayers(
  "Jesus Made, Leo De Vries, <script>, Jesus Made",
);
assert.deepEqual(players, ["Jesus Made", "Leo De Vries"]);

const all = buildDealHunterEbayQueryFamilies({ scope: "all", players });
assert.equal(
  all.length,
  15 + 3 + DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT + players.length * 2 + players.length,
);
assert.equal(new Set(all.map((family) => family.familyId)).size, all.length);

const silverFamily = wnba.find(
  (family) => family.lane === "silver_color_numbered_ssp",
);
assert.equal(
  screenDealHunterEbayTitle({
    title: "2025 Panini Prizm WNBA Paige Bueckers Silver Prizm Rookie",
    family: silverFamily,
  }).accepted,
  true,
);
assert.equal(
  screenDealHunterEbayTitle({
    title: "Paige Bueckers UConn Bowman University Base Rookie",
    family: silverFamily,
  }).accepted,
  false,
);
assert.equal(
  screenDealHunterEbayTitle({
    title: "Caitlin Clark custom digital rookie card",
    family: silverFamily,
  }).accepted,
  false,
);
const photoReview = screenDealHunterEbayTitle({
  title: "Sonia Citron WNBA Rookie Card",
  family: silverFamily,
});
assert.equal(photoReview.accepted, true);
assert.equal(photoReview.manualReviewRequired, true);

assert.equal(
  extractEbayItemId({
    itemWebUrl: "https://www.ebay.com/itm/Paige-Bueckers-Rookie/123456789012",
  }),
  "123456789012",
);
assert.equal(extractEbayItemId({ itemId: "v1|999888777666|0" }), "v1|999888777666|0");

assert.throws(
  () => buildDealHunterEbayQueryFamilies({ scope: "arbitrary" }),
  /Unsupported Deal Hunter eBay scope/,
);

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "TCOS_NATIVE_EBAY_FEED_V1",
      wnbaQueryFamilies: wnba.length,
      michkovYoungGunsQueryFamilies: michkov.length,
      fixedScopes: [
        "wnba",
        "ivan_demidov",
        "matvei_michkov_young_guns",
        "baseball_prospects",
        "signed_baseballs",
        "all",
      ],
      arbitraryQueryAccepted: false,
      purchaseCapability: false,
    },
    null,
    2,
  ),
);
