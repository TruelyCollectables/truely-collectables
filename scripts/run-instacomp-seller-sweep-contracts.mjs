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
const proof = readFileSync(
  "src/lib/instacomp-seller-sweep-proof.ts",
  "utf8",
);
const proofCore = readFileSync(
  "src/lib/instacomp-seller-sweep-proof-core.ts",
  "utf8",
);
const purchaseInbox = readFileSync(
  "src/lib/market-intel-ebay-purchase-inbox.ts",
  "utf8",
);
const purchaseComps = readFileSync(
  "src/lib/market-intel-ebay-purchase-comps.ts",
  "utf8",
);
const purchaseIntakeRoute = readFileSync(
  "src/app/api/admin/market-intel/purchases/ebay-intake/route.ts",
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
const statusRoute = readFileSync(
  "src/app/api/admin/instacomp/seller-sweep/status/route.ts",
  "utf8",
);
const client = readFileSync(
  "src/app/admin/instacomp/seller-sweep/SellerSweepClient.tsx",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260802002500_instacomp_seller_sweeps.sql",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/instacomp-seller-sweep.yml",
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
assert.match(extractor, /autograph_state_not_confirmed/);
assert.match(extractor, /relic_state_not_confirmed/);
assert.match(extractor, /grading_state_not_confirmed/);
assert.match(extractor, /packaging_state_not_confirmed/);
assert.match(extractor, /sealed_product_requires_product_level_review/);
assert.match(extractor, /reviewRequired: uniqueReviewReasons\.length > 0/);
assert.match(extractor, /type: "json_schema"/);
assert.match(extractor, /strict: true/);

assert.match(collector, /buy\/browse\/v1\/item_summary\/search/);
assert.match(collector, /buy\/browse\/v1\/item\//);
assert.match(collector, /const MAX_LISTING_LIMIT = 200/);
assert.match(collector, /Math\.max\(1, Math\.min\(MAX_LISTING_LIMIT/);
assert.match(collector, /limit: String\(limit\)/);
assert.match(collector, /photos_total: photoTotal/);
assert.match(collector, /identified_cards/);

assert.match(processor, /MAX_BATCH_SIZE = 3/);
assert.match(processor, /MAX_IMAGES_PER_LISTING = 8/);
assert.match(processor, /LISTING_TIMEOUT_MS = 180_000/);
assert.match(processor, /status: reviewRequired \? "review" : "comping"/);
assert.match(processor, /verifySellerSweepCandidates/);
assert.match(processor, /exactCandidateCount !== cards\.length/);
assert.match(processor, /cards_identified: candidatesIdentified/);
assert.match(processor, /Math\.min\(80/);
assert.match(processor, /\.eq\("status", "photos"\)/);
assert.doesNotMatch(processor, /\["photos", "failed"\]/);
assert.doesNotMatch(processor, /retail_value:/);
assert.doesNotMatch(processor, /quick_sale_value:/);
assert.doesNotMatch(processor, /roi_percent:/);

assert.match(proof, /findChecklistRegistryMatch/);
assert.match(proof, /status: "verified_exact"/);
assert.match(proof, /exactIdentityConfirmed: true/);
assert.match(proof, /checklistConfirmed: true/);
assert.match(proof, /noConflictingEvidence: true/);
assert.match(proof, /verifiedCompletedSales: \[\]/);
assert.match(proof, /graded_identity_requires_certification_verification/);
assert.match(proof, /listing_candidate_limit_exceeded/);
assert.match(proofCore, /findExactSellerSweepMarketIdentity/);
assert.match(proofCore, /sellerSweepVerifiedReceiptSales/);
assert.match(proofCore, /metadata\.verified_from === "connected_ebay_buyer_order"/);
assert.match(proofCore, /metadata\.connected_buyer_order_verified === true/);
assert.match(proofCore, /Number\(metadata\.receipt_order_line_count\) === 1/);
assert.match(proofCore, /metadata\.final_price_confirmed === true/);
assert.match(proofCore, /metadata\.shipping_price_confirmed === true/);
assert.match(proofCore, /Number\(row\.quantity\) === 1/);
assert.match(purchaseIntakeRoute, /source: "connected_ebay_buyer_order"/);
assert.match(purchaseIntakeRoute, /orderLineCount: order\.lines\.length/);
assert.match(purchaseInbox, /connected_buyer_order_verified/);
assert.match(purchaseInbox, /receipt_order_line_count/);
assert.match(purchaseComps, /independently_verified: connectedReceipt/);
assert.match(purchaseComps, /shipping_price_confirmed: singleLineReceipt/);

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

assert.match(statusRoute, /export async function GET/);
assert.match(statusRoute, /identified_cards/);
assert.match(statusRoute, /expected_profit/);
assert.match(statusRoute, /progress: Math\.max\(0, Math\.min\(100, progress\)\)/);
assert.match(client, /seller-sweep\/status\?sweepId=/);
assert.match(client, /seller-sweep\/process/);
assert.match(client, /seller-sweep\/rank/);
assert.match(client, /window\.setInterval/);
assert.match(client, /never changes a listing, publishes an item, or applies a price automatically/);
assert.match(workflow, /run-instacomp-seller-sweep-proof-simulations\.ts/);

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
assert.match(
  migration,
  /revoke all on table public\.instacomp_seller_sweeps from anon, authenticated/,
);
assert.match(
  migration,
  /revoke all on table public\.instacomp_seller_sweep_listings from anon, authenticated/,
);
assert.match(
  migration,
  /grant select, insert, update, delete on table public\.instacomp_seller_sweeps to service_role/,
);
assert.match(
  migration,
  /grant select, insert, update, delete on table public\.instacomp_seller_sweep_listings to service_role/,
);

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
