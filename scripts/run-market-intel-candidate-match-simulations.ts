import assert from "node:assert/strict";
import {
  evaluateMarketIntelEbayIdentityMatch,
  type MarketIntelEbayCandidateIdentity,
} from "../src/lib/market-intel-ebay-candidate-match";

const cabaRefractor: MarketIntelEbayCandidateIdentity = {
  subject_name: "Starlyn Caba",
  season_year: "2023",
  manufacturer: "Bowman",
  product_line: "Bowman Chrome",
  set_name: "Bowman Chrome",
  insert_name: null,
  card_number: "BCP-164",
  parallel_name: "Refractor",
  variation_name: null,
  condition_type: "raw",
  grading_company: null,
  grade: null,
  autograph: false,
  memorabilia: false,
  serial_numbered_to: null,
};

const demidovNhcd: MarketIntelEbayCandidateIdentity = {
  subject_name: "Ivan Demidov",
  season_year: "2026",
  manufacturer: "Upper Deck",
  product_line: "National Hockey Card Day",
  set_name: "Rookie Moments",
  insert_name: "Rookie Moments",
  card_number: "NHCD-31",
  parallel_name: "Base",
  variation_name: null,
  condition_type: "raw",
  grading_company: null,
  grade: null,
  autograph: false,
  memorabilia: false,
  serial_numbered_to: null,
};

const demidovAllureBase: MarketIntelEbayCandidateIdentity = {
  subject_name: "Ivan Demidov",
  season_year: "2025-26",
  manufacturer: "Upper Deck",
  product_line: "Allure",
  set_name: null,
  insert_name: null,
  card_number: "110",
  parallel_name: "Base",
  variation_name: null,
  condition_type: "raw",
  grading_company: null,
  grade: null,
  autograph: false,
  memorabilia: false,
  serial_numbered_to: null,
};

const demidovUpperDeck743: MarketIntelEbayCandidateIdentity = {
  subject_name: "Ivan Demidov",
  season_year: "2025-26",
  manufacturer: "Upper Deck",
  product_line: "Upper Deck",
  set_name: "Upper Deck",
  insert_name: null,
  card_number: "743",
  parallel_name: "Base",
  variation_name: "Star Rookie",
  condition_type: "raw",
  grading_company: null,
  grade: null,
  autograph: false,
  memorabilia: false,
  serial_numbered_to: null,
};

const shimmer = evaluateMarketIntelEbayIdentityMatch(cabaRefractor, {
  title:
    "2023 Bowman Chrome Prospects Shimmer Refractor Starlyn Caba Jesus #BCP-164",
  condition: "Ungraded",
});
assert.equal(shimmer.hardConflict, true);
assert.match(shimmer.conflicts.join(" "), /shimmer/i);

const speckleGraded = evaluateMarketIntelEbayIdentityMatch(cabaRefractor, {
  title: "2023 Bowman Chrome Starlyn Caba #BCP-164 Speckle Refractor /299",
  shortDescription: "Authenticated by PSA.",
  condition: "Graded",
});
assert.equal(speckleGraded.hardConflict, true);
assert.match(speckleGraded.conflicts.join(" "), /speckle/i);
assert.match(speckleGraded.conflicts.join(" "), /graded/i);
assert.match(speckleGraded.conflicts.join(" "), /serial/i);

const signedMojo = evaluateMarketIntelEbayIdentityMatch(cabaRefractor, {
  title: "Starlyn Caba 2023 Bowman Mojo Refractor #BCP-164 SIGNED",
  condition: "Ungraded",
});
assert.equal(signedMojo.hardConflict, true);
assert.match(signedMojo.conflicts.join(" "), /mojo/i);
assert.match(signedMojo.conflicts.join(" "), /autograph|signed/i);

const omittedParallel = evaluateMarketIntelEbayIdentityMatch(cabaRefractor, {
  title: "2023 Bowman Chrome Prospects Starlyn Caba #BCP-164",
  condition: "Ungraded",
});
assert.equal(omittedParallel.hardConflict, false);
assert.equal(omittedParallel.reasons.includes("card number matches"), true);

const cleanNhcd = evaluateMarketIntelEbayIdentityMatch(demidovNhcd, {
  title: "IVAN DEMIDOV 2026 Upper Deck National Hockey Card Day #NHCD-31",
  condition: "Ungraded",
});
assert.equal(cleanNhcd.hardConflict, false);
assert.ok(cleanNhcd.score >= 75);

const redRainbow = evaluateMarketIntelEbayIdentityMatch(demidovAllureBase, {
  title: "2025-26 Upper Deck Allure Rookies Ivan Demidov #110 Red Rainbow",
  condition: "Ungraded",
});
assert.equal(redRainbow.hardConflict, true);
assert.match(redRainbow.conflicts.join(" "), /red rainbow/i);

const cleanAllure = evaluateMarketIntelEbayIdentityMatch(demidovAllureBase, {
  title: "2025-26 Upper Deck Allure Rookies Ivan Demidov #110 Rookie RC",
  condition: "Ungraded",
});
assert.equal(cleanAllure.hardConflict, false);
assert.ok(cleanAllure.score >= 70);

const wrongInsert = evaluateMarketIntelEbayIdentityMatch(demidovUpperDeck743, {
  title: "Upper Deck Allure 2025-26 Ivan Demidov Hitting Their Groove #HTG-2",
  condition: "Ungraded",
});
assert.equal(wrongInsert.hardConflict, true);
assert.match(wrongInsert.conflicts.join(" "), /card number|allure/i);

const lot = evaluateMarketIntelEbayIdentityMatch(demidovUpperDeck743, {
  title: "2025-26 Upper Deck Ivan Demidov Rookie Lot of 4 Cards",
  condition: "Ungraded",
});
assert.equal(lot.lotListing, true);
assert.equal(lot.hardConflict, true);
assert.match(lot.conflicts.join(" "), /lot-composition/i);

console.log(
  JSON.stringify(
    {
      passed: true,
      matcher: "tcos.marketIntel.ebayCandidateMatch.v2",
      wrongParallelBlocked: true,
      gradedRawConflictBlocked: true,
      autographConflictBlocked: true,
      wrongCardNumberBlocked: true,
      lotsQuarantined: true,
      cleanExactCandidatesPreserved: true,
    },
    null,
    2,
  ),
);
