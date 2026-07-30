import assert from "node:assert/strict";
import {
  buildDealHunterEbayQueryFamilies,
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

const players = parseDealHunterPlayers(
  "Jesus Made, Leo De Vries, <script>, Jesus Made",
);
assert.deepEqual(players, ["Jesus Made", "Leo De Vries"]);

const all = buildDealHunterEbayQueryFamilies({ scope: "all", players });
assert.equal(all.length, 15 + 3 + players.length * 2 + players.length);
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
      fixedScopes: [
        "wnba",
        "ivan_demidov",
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
