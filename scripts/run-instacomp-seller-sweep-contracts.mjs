import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const extractor = readFileSync(
  "src/lib/instacomp-seller-sweep-identify.ts",
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
assert.doesNotMatch(processor, /retail_value:/);
assert.doesNotMatch(processor, /quick_sale_value:/);
assert.doesNotMatch(processor, /roi_percent:/);

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
        exactIdentityAndCompGateStillRequired: true,
      },
    },
    null,
    2,
  ),
);
