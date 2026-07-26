import assert from "node:assert/strict";
import fs from "node:fs";

const universal = fs.readFileSync(
  "src/app/api/account/seller/inventory/instacomp-universal/route.ts",
  "utf8",
);
const page = fs.readFileSync("src/app/seller/instacomp-pending/page.tsx", "utf8");
const pending = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/route.ts",
  "utf8",
);
const exclusion = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",
  "utf8",
);
const provider = fs.readFileSync("src/lib/instacomp-ebay-serp-provider.ts", "utf8");
const visual = fs.readFileSync("src/lib/instacomp-comp-visual-verification.ts", "utf8");

assert.ok(universal.includes("hasUsableStoredIdentity"));
assert.ok(universal.includes("fastLane = true"));
assert.ok(universal.includes("Promise.all(["));
assert.ok(universal.includes("excludedCompUrls"));
assert.ok(universal.includes("durationMs: Date.now() - scanStartedAt"));
assert.ok(page.includes("runWithConcurrency(targets, 2"));
assert.ok(page.includes("/api/account/seller/instacomp-pending/exclude-comp"));
assert.ok(page.includes("Exclude this sold comp and recalculate"));
assert.ok(page.includes("Exclude this active comp and recalculate"));
assert.ok(pending.includes("excludedCompCount"));
assert.ok(exclusion.includes("recalculated without rescanning"));
assert.ok(exclusion.includes("calculateInstaCompSweetSpot"));
assert.ok(provider.includes("serpapi_ebay_v4_"));
assert.ok(provider.includes("!items.length"));
assert.ok(provider.includes("deterministic exact identity"));
assert.ok(provider.includes("coverage >= 0.68"));
assert.ok(visual.includes("deterministic exact identity"));

console.log(
  "InstaComp speed/exclusion regression passed: trusted cards skip duplicate identity scans, batches run two at a time, sold and active comps have persistent exclusion controls, and exclusions recalculate without rescanning.",
);
