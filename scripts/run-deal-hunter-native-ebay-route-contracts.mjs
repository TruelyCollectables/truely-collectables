import assert from "node:assert/strict";
import { buildDealHunterEbaySearchUrl } from "../src/lib/deal-hunter-ebay-native-search.js";
import {
  buildDealHunterEbayQueryFamilies,
  DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT,
  DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT,
  extractEbayItemId,
  parseDealHunterPlayers,
  screenDealHunterEbayTitle,
} from "../src/lib/deal-hunter-ebay-query-families.js";

const searchContract = buildDealHunterEbaySearchUrl({
  query: "Paige Bueckers WNBA rookie card",
  maxResults: 20,
});
assert.equal(searchContract.requestedResults, 20);
assert.equal(searchContract.scanLimit, 40);
assert.equal(searchContract.url.searchParams.get("limit"), "40");
assert.equal(searchContract.url.searchParams.get("sort"), "newlyListed");
assert.equal(searchContract.url.searchParams.get("fieldgroups"), "EXTENDED");

const wnba = buildDealHunterEbayQueryFamilies({ scope: "wnba" });
assert.equal(wnba.length, DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT);
assert.equal(new Set(wnba.map((family) => family.familyId)).size, 35);
for (const player of ["Caitlin Clark", "Paige Bueckers", "Dominique Malonga"]) {
  const families = wnba.filter((family) => family.watchedPerson === player);
  assert.equal(families.length, 5);
  assert.equal(families.filter((family) => family.rescueMode).length, 2);
}
for (const player of [
  "Sonia Citron",
  "Kiki Iriafen",
  "Aneesah Morrow",
  "Saniya Rivers",
  "Sarah Ashlee Barker",
]) {
  const families = wnba.filter((family) => family.watchedPerson === player);
  assert.equal(families.length, 4);
  assert.ok(families.every((family) => family.nonBaseOnly));
  assert.ok(families.some((family) => family.lane === "rookie_lots"));
  assert.ok(families.some((family) => family.lane === "silver_color_numbered_ssp"));
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
  DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT +
    3 +
    DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT +
    players.length * 2 +
    players.length +
    8,
);
assert.equal(new Set(all.map((family) => family.familyId)).size, all.length);

const paigeSilverFamily = wnba.find(
  (family) =>
    family.watchedPerson === "Paige Bueckers" &&
    family.lane === "silver_color_numbered_ssp",
);
const soniaSilverFamily = wnba.find(
  (family) =>
    family.watchedPerson === "Sonia Citron" &&
    family.lane === "silver_color_numbered_ssp",
);
const kikiRescueFamily = wnba.find(
  (family) => family.watchedPerson === "Kiki Iriafen" && family.rescueMode,
);

assert.equal(
  screenDealHunterEbayTitle({
    title: "2025 Panini Prizm WNBA Paige Bueckers Silver Prizm Rookie",
    family: paigeSilverFamily,
  }).accepted,
  true,
);
assert.equal(
  screenDealHunterEbayTitle({
    title: "Paige Bueckers UConn Bowman University Base Rookie",
    family: paigeSilverFamily,
  }).accepted,
  false,
);
assert.equal(
  screenDealHunterEbayTitle({
    title: "Caitlin Clark custom digital rookie card",
    family: paigeSilverFamily,
  }).accepted,
  false,
);

const typoReview = screenDealHunterEbayTitle({
  title: "2025 Panini Prizm WNBA Paige Buecker Silver Rookie",
  family: paigeSilverFamily,
});
assert.equal(typoReview.accepted, true);
assert.equal(typoReview.manualReviewRequired, true);
assert.equal(typoReview.analysis.targetMatch.method, "fuzzy_name");
assert.ok(
  typoReview.reviewReasons.includes(
    "seller_name_typo_or_variant_detected_verify_image",
  ),
);

const metadataRescue = screenDealHunterEbayTitle({
  title: "2025 Panini Prizm WNBA Silver Rookie #149",
  description: "Kiki Iriafen Washington Mystics rookie card",
  raw: {
    categories: [{ categoryName: "Sports Trading Cards" }],
  },
  family: kikiRescueFamily,
});
assert.equal(metadataRescue.accepted, true);
assert.equal(metadataRescue.manualReviewRequired, true);
assert.equal(metadataRescue.analysis.targetMatchedInMetadata, true);
assert.equal(metadataRescue.analysis.cardNumberGuess, "149");
assert.ok(
  metadataRescue.analysis.mislistReasons.includes(
    "card_number_or_underspecified_title_rescue",
  ),
);

const lotReview = screenDealHunterEbayTitle({
  title: "Sonia Citron WNBA Rookie Silver Lot of 25 Cards",
  raw: {
    categories: [{ categoryName: "Sports Trading Cards" }],
  },
  family: soniaSilverFamily,
});
assert.equal(lotReview.accepted, true);
assert.equal(lotReview.manualReviewRequired, true);
assert.equal(lotReview.analysis.lotSignal, true);
assert.equal(lotReview.analysis.lotQuantityGuess, 25);
assert.ok(
  lotReview.reviewReasons.includes(
    "lot_or_bundle_unit_economics_review_required",
  ),
);

const wrongCategoryReview = screenDealHunterEbayTitle({
  title: "Sonia Citron WNBA Rookie Silver Prizm",
  raw: {
    categories: [{ categoryName: "Women's Shoes" }],
  },
  family: soniaSilverFamily,
});
assert.equal(wrongCategoryReview.accepted, true);
assert.equal(wrongCategoryReview.manualReviewRequired, true);
assert.equal(wrongCategoryReview.analysis.categoryLooksLikeCard, false);
assert.ok(
  wrongCategoryReview.analysis.mislistReasons.includes(
    "possible_wrong_category_listing",
  ),
);

const photoReview = screenDealHunterEbayTitle({
  title: "Sonia Citron WNBA Rookie Card",
  family: soniaSilverFamily,
});
assert.equal(photoReview.accepted, false);
assert.ok(photoReview.rejectionReasons.includes("non_base_not_proven"));

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
      hardeningVersion: "WNBA_EBAY_HARDENING_V2",
      wnbaQueryFamilies: wnba.length,
      wnbaRescueFamilies: wnba.filter((family) => family.rescueMode).length,
      newlyListedSort: searchContract.url.searchParams.get("sort"),
      screenedScanLimit: searchContract.scanLimit,
      metadataRescueCovered: true,
      typoRescueCovered: true,
      lotReviewCovered: true,
      wrongCategoryReviewCovered: true,
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
