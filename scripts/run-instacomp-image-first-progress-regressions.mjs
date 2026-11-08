import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("src/app/api/account/seller/inventory/instacomp/route.ts", "utf8");
const page = fs.readFileSync("src/app/seller/instacomp-pending/page.tsx", "utf8");
const verifier = fs.readFileSync("src/lib/instacomp-comp-visual-verification.ts", "utf8");

assert.ok(route.includes("verifyInstaCompCompetitionImages"));
assert.ok(route.includes("targetFrontImage: files[0]"));
assert.ok(route.includes('comp.source === "ebay_active"'));
assert.ok(route.includes("visualCompetitionReview.titleOverrides"));
assert.ok(verifier.includes("Seller titles are untrusted claims. The card images are ground truth."));
assert.ok(verifier.includes("seller title mislabeled"));
assert.ok(verifier.includes("exact_visual_match"));
assert.ok(page.includes("InstaComping:"));
assert.ok(page.includes("scanElapsedSeconds"));
assert.ok(page.includes("active listing image verification"));
assert.ok(page.includes('comp.flags.join(" · ")'));

console.log("InstaComp image-first competition and visible-progress regressions passed.");
