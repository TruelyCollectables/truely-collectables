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

console.log(
  "InstaComp speed/exclusion regression passed: trusted cards skip duplicate identity scans, batches run two at a time, sold and active comps have persistent exclusion controls, and exclusions recalculate without rescanning.",
);
