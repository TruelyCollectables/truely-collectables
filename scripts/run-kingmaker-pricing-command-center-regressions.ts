import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("src/app/admin/instacomp/pricing/page.tsx", "utf8");
const server = fs.readFileSync("src/lib/kingmaker-pricing-command-center-server.ts", "utf8");
const snapshotRoute = fs.readFileSync("src/app/api/instacomp/pricing/command-center/route.ts", "utf8");
const viewsRoute = fs.readFileSync("src/app/api/instacomp/pricing/views/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260803233000_kingmaker_pricing_command_center.sql", "utf8");

for (const label of [
  "Pricing Receipts",
  "Pricing Analytics",
  "Pricing Profiles",
  "Bulk Planner",
  "Profile Comparison",
  "Exception Queue",
  "Saved Views",
  "Profile Activity",
]) assert.match(page, new RegExp(label));

assert.match(server, /receiptLimit: 250/);
assert.match(server, /limited: true/);
assert.match(server, /kingmakerPricingProfileOwner/);
assert.match(server, /advisory_only/);
assert.match(snapshotRoute, /sourceDisclosure: null/);
assert.match(viewsRoute, /assertTrustedInstaCompMutationRequest/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all.*anon, authenticated/);

const customerFacingSurfaces = page + snapshotRoute + viewsRoute;
assert.doesNotMatch(customerFacingSurfaces, /store_id|seller_account_id/);

const commandCenterCode = server + snapshotRoute + viewsRoute;
const mutationPattern = String.raw`from\(["']TABLE["']\)[\s\S]*?\.(insert|update|upsert|delete)\(`;
for (const table of ["products", "orders", "offers", "market_intel_purchases"]) {
  assert.doesNotMatch(commandCenterCode, new RegExp(mutationPattern.replace("TABLE", table)));
}

console.log("KINGMAKER Pricing Command Center regressions passed.");
