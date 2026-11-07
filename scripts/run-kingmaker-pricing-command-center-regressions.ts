import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("src/app/admin/instacomp/pricing/page.tsx", "utf8");
const server = fs.readFileSync("src/lib/kingmaker-pricing-command-center-server.ts", "utf8");
const snapshotRoute = fs.readFileSync("src/app/api/instacomp/pricing/command-center/route.ts", "utf8");
const viewsRoute = fs.readFileSync("src/app/api/instacomp/pricing/views/route.ts", "utf8");
const viewRetireRoute = fs.readFileSync("src/app/api/instacomp/pricing/views/[viewId]/route.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260803233000_kingmaker_pricing_command_center.sql", "utf8");
const atomicMigration = fs.readFileSync("supabase/migrations/20260804011000_kingmaker_pricing_saved_view_atomic_lifecycle.sql", "utf8");
const receiptMigration = fs.readFileSync("supabase/migrations/20260803200000_kingmaker_pricing_decision_receipts.sql", "utf8");

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
assert.match(viewRetireRoute, /expectedVersion/);
assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all.*anon, authenticated/);

assert.match(receiptMigration, /tcos_kingmaker_pricing_decision_receipts/);
assert.match(receiptMigration, /decision_status/);
assert.match(receiptMigration, /expected_profit/);
assert.match(server, /from\("tcos_kingmaker_pricing_decision_receipts"\)/);
assert.match(server, /decision_status,confidence,sold_comp_count,expected_profit,created_at/);
assert.doesNotMatch(server, /from\("tcos_kingmaker_pricing_receipts"\)/);
assert.doesNotMatch(server, /row\.status/);
assert.doesNotMatch(server, /estimated_profit_at_ceiling/);

for (const marker of [
  "tcos_create_kingmaker_pricing_saved_view_atomic",
  "tcos_retire_kingmaker_pricing_saved_view_atomic",
  "pg_advisory_xact_lock",
  "v_current_version <> p_expected_version",
  "from public, anon, authenticated",
  "to service_role",
]) {
  assert.ok(
    (server + atomicMigration).includes(marker),
    `Missing Command Center hardening marker: ${marker}`,
  );
}
assert.doesNotMatch(
  server,
  /from\("tcos_kingmaker_pricing_saved_views"\)[\s\S]{0,300}\.(insert|update)\(/,
);

const customerFacingSurfaces = page + snapshotRoute + viewsRoute + viewRetireRoute;
assert.doesNotMatch(customerFacingSurfaces, /store_id|seller_account_id/);

const commandCenterCode = server + snapshotRoute + viewsRoute + viewRetireRoute;
const mutationPattern = String.raw`from\(["']TABLE["']\)[\s\S]*?\.(insert|update|upsert|delete)\(`;
for (const table of ["products", "orders", "offers", "market_intel_purchases"]) {
  assert.doesNotMatch(commandCenterCode, new RegExp(mutationPattern.replace("TABLE", table)));
}

console.log("KINGMAKER Pricing Command Center regressions passed.");
