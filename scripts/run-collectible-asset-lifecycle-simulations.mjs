import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const migration = read(
  "supabase/migrations/20260726050000_collectible_asset_lifecycle.sql",
);
const importer = read(
  "src/app/api/admin/verified-reference-import/route.ts",
);
const importPage = read(
  "src/app/admin/verified-reference-import/VerifiedReferenceImportWorkbench.tsx",
);
const assetsApi = read(
  "src/app/api/account/seller/collectible-assets/route.ts",
);
const assetsPage = read("src/app/seller/collectible-assets/page.tsx");
const activation = read("src/lib/inventory-activation.ts");
const collectible = read("src/lib/collectible-assets.ts");

for (const table of [
  "collectible_assets",
  "collectible_asset_events",
  "collectible_grader_verifications",
  "collectible_market_snapshots",
]) {
  assert.ok(migration.includes(`public.${table}`), `${table} must be migrated.`);
}

assert.match(
  migration,
  /mark_collectible_asset_sold_from_order_item/,
  "Sales must permanently update the physical collectible asset.",
);
assert.match(
  migration,
  /capture_collectible_market_snapshot_from_inventory/,
  "InstaComp market refreshes must create normalized snapshots.",
);
assert.match(
  migration,
  /append-only/,
  "Lifecycle evidence must be append-only.",
);

assert.match(
  importer,
  /human_verified/,
  "Only human-verified records may enter the cold reference path.",
);
assert.match(
  importer,
  /overallGrade !== "correct"/,
  "Incomplete card grades must be rejected.",
);
assert.match(
  importer,
  /price: 0/,
  "Verified cards must be allowed into private drafts before pricing.",
);
assert.match(
  importer,
  /exact_serial_number/,
  "Exact physical copy stamps must be preserved.",
);
assert.match(
  importer,
  /grading_cert_number/,
  "Grading certification numbers must be preserved.",
);
assert.match(
  importer,
  /verifyGraderCertification/,
  "Official grader verification must run during import.",
);
assert.match(
  importer,
  /createSellerDraftProduct/,
  "Imports must create real private inventory drafts.",
);

assert.match(
  collectible,
  /www\.psacard\.com\/cert/,
  "PSA verification must use PSA's official cert site.",
);
assert.match(
  collectible,
  /sold_early/,
  "Post-sale timing must identify cards sold too early.",
);
assert.match(
  collectible,
  /sold_late/,
  "Post-sale timing must identify cards sold too late.",
);
assert.match(
  collectible,
  /right_on_time/,
  "Post-sale timing must identify cards sold at the right time.",
);

assert.match(
  activation,
  /grader_verification_conflict/,
  "Conflicting grader evidence must block activation.",
);
assert.match(
  activation,
  /grader_verification_required/,
  "Unverified graded cards must remain pending.",
);

assert.match(
  importPage,
  /Import to Pending Listings/,
  "The admin importer must explicitly target Pending Listings.",
);
assert.match(
  assetsApi,
  /classifySaleTiming/,
  "The lifecycle API must calculate sale timing.",
);
assert.match(
  assetsPage,
  /Run Post-Sale Market Check/,
  "Sold cards must expose a post-sale market refresh.",
);

console.log("Collectible asset lifecycle simulations passed.");
