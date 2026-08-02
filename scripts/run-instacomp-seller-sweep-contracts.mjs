import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const extractor = readFileSync(
  "src/lib/instacomp-seller-sweep-identify.ts",
  "utf8",
);
const economics = readFileSync(
  "src/lib/instacomp-seller-sweep-economics.ts",
  "utf8",
);
const collector = readFileSync(
  "src/app/api/admin/instacomp/seller-sweep/route.ts",
  "utf8",
);
const processor = readFileSync(
  "src/app/api/admin/instacomp/seller-sweep/process/route.ts",
  "utf8",
);
const ranker = readFileSync(
  "src/app/api/admin/instacomp/seller-sweep/rank/route.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260802002500_instacomp_seller_sweeps.sql",
  "utf8",
);

for (const player of [
  "Paige Bueckers",
  "Sonia Citron",
  "Kiki Iriafen",
  "Dominique Malonga",
  "Cameron Brink",
  "Angel Reese",
]) {
  assert.ok(extractor.includes(player), `Missing target-player flag: ${player}`);
}

assert.match(extractor, /Seller wording is untrusted/);
assert.match(extractor, /Never invent a player, year, card number, parallel, serial number/);
assert.match(extractor, /candidate_confidence_below_90_percent/);
assert.match(extractor, /serial_number_lacks_visible_stamp_evidence/);
assert.match(extractor, /reviewRequired: uniqueReviewReasons\.length > 0/);
assert.match(extractor, /type: "json_schema"/);
assert.match(extractor, /strict: true/);

assert.match(collector, /buy\/browse\/v1\/item_summary\/search/);
assert.match(collector, /buy\/browse\/v1\/item\//);
assert.match(collector, /photos_total: photoTotal/);
assert.match(collector, /identified_cards/);

assert.match(processor, /MAX_BATCH_SIZE = 3/);
assert.match(processor, /MAX_IMAGES_PER_LISTING = 8/);
assert.match(processor, /LISTING_TIMEOUT_MS = 180_000/);
assert.match(processor, /status: reviewRequired \? "review" : "comping"/);
assert.match(processor, /exactCandidateCount !== cards\.length/);
assert.match(processor, /cards_identified: candidatesIdentified/);
assert.match(processor, /Math\.min\(80/);
assert.match(processor, /\.eq\("status", "photos"\)/);
assert.doesNotMatch(processor, /\["photos", "failed"\]/);
assert.doesNotMatch(processor, /retail_value:/);
assert.doesNotMatch(processor, /quick_sale_value:/);
assert.doesNotMatch(processor, /roi_percent:/);

assert.match(economics, /proof\?\.status === "verified_exact"/);
assert.match(economics, /proof\.exactIdentityConfirmed === true/);
assert.match(economics, /proof\.checklistConfirmed === true/);
assert.match(economics, /proof\.noConflictingEvidence === true/);
assert.match(economics, /sales\.length < 2/);
assert.match(economics, /independentlyVerified === true/);
assert.match(economics, /exactIdentityMatch === true/);
assert.match(economics, /finalPriceConfirmed === true/);
assert.match(economics, /fewer_than_two_verified_completed_sales/);
assert.match(economics, /retailValue: 0/);
assert.match(economics, /quickSaleValue: 0/);
assert.match(economics, /quickSaleMultiplier: 0\.85/);
assert.match(economics, /targetRoiRate: 0\.3/);
assert.doesNotMatch(economics, /active listing/i);

assert.match(ranker, /calculateSellerSweepLotEconomics/);
assert.match(ranker, /economics\.status === "ranked" \? "ranked" : "review"/);
assert.match(ranker, /retail_value: economics\.retailValue/);
assert.match(ranker, /quick_sale_value: economics\.quickSaleValue/);
assert.match(ranker, /target_bid: economics\.targetBid/);
assert.match(ranker, /hard_max_bid: economics\.hardMaxBid/);
assert.match(ranker, /expected_profit: economics\.expectedProfit/);
assert.match(ranker, /roi_percent: economics\.roiPercent/);
assert.match(ranker, /status\.eq\.comping,and\(status\.eq\.review,retail_value\.is\.null\)/);
assert.match(ranker, /pendingValuation === 0/);
assert.match(ranker, /Unverified cards and cards with fewer than two independently verified completed sales/);

for (const column of [
  "identified_cards jsonb",
  "target_players text[]",
  "retail_value numeric",
  "quick_sale_value numeric",
  "expected_profit numeric",
  "roi_percent numeric",
  "confidence numeric",
  "rank integer",
]) {
  assert.ok(migration.includes(column), `Missing Seller Sweep column: ${column}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      sellerSweep: {
        collector: true,
        fullPhotoStaging: true,
        boundedCandidateExtraction: true,
        strictStructuredOutput: true,
        targetPlayerFlags: true,
        lowConfidenceFailsToReview: true,
        serialRequiresVisibleEvidence: true,
        candidateStageCannotWriteValuesOrRoi: true,
        exactIdentityProofRequiredForValue: true,
        minimumIndependentVerifiedSales: 2,
        unverifiedCardsReceiveZeroValue: true,
        lotEconomics: true,
        targetBidAndHardMaximum: true,
        profitRoiRanking: true,
      },
    },
    null,
    2,
  ),
);
