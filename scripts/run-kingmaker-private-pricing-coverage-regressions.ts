import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = {
  migration: read("supabase/migrations/20260804034500_kingmaker_private_pricing_coverage.sql"),
  server: read("src/lib/kingmaker-private-pricing-coverage-server.ts"),
  route: read("src/app/api/instacomp/pricing/coverage/route.ts"),
  component: read("src/app/admin/instacomp/pricing/_components/private-pricing-coverage.tsx"),
  page: read("src/app/admin/instacomp/pricing/coverage/page.tsx"),
  commandCenter: read("src/app/admin/instacomp/pricing/page.tsx"),
};

const forbiddenAttribution = String.fromCharCode(98, 101, 99, 107, 101, 116, 116);
for (const [name, contents] of Object.entries(files)) {
  assert.equal(
    contents.toLowerCase().includes(forbiddenAttribution),
    false,
    `${name} contains prohibited publisher attribution`,
  );
}

for (const marker of [
  "tcos_kingmaker_private_pricing_coverage_report",
  "missing_release",
  "checklist_pending",
  "set_gap",
  "identity_gap",
  "aggregate_private_reference_only",
  "revoke all on function",
  "to service_role",
]) {
  assert.ok(files.migration.includes(marker), `Migration missing ${marker}`);
}

for (const marker of [
  'actor.type !== "admin"',
  "KINGMAKER_PRIVATE_PRICING_COVERAGE_ADMIN_REQUIRED",
  'databaseClient().rpc(',
  '"tcos_kingmaker_private_pricing_coverage_report"',
  'boundary !== "aggregate_private_reference_only"',
]) {
  assert.ok(files.server.includes(marker), `Server missing ${marker}`);
}

for (const marker of [
  "requireInstaCompJobActor",
  "getKingmakerPrivatePricingCoverage",
  "sourceDisclosure: null",
  '"cache-control": "no-store"',
]) {
  assert.ok(files.route.includes(marker), `Route missing ${marker}`);
}

for (const marker of [
  "Coverage Attack Queue",
  "Potential Unlock",
  "Missing release",
  "Checklist pending",
  "Set gap",
  "Identity gap",
  "No price promotion",
  "No source disclosure",
  "/api/instacomp/pricing/coverage",
]) {
  assert.ok(files.component.includes(marker), `Coverage workspace missing ${marker}`);
}

for (const forbiddenField of [
  "rawText",
  "raw_text",
  "valueLow",
  "valueHigh",
  "originalFilename",
  "sourceSha256",
]) {
  assert.equal(
    files.component.includes(forbiddenField),
    false,
    `Coverage workspace exposes ${forbiddenField}`,
  );
  assert.equal(
    files.route.includes(forbiddenField),
    false,
    `Coverage route exposes ${forbiddenField}`,
  );
}

assert.ok(
  files.page.includes("<PrivatePricingCoverage />"),
  "Coverage page is not connected to its workspace",
);
assert.ok(
  files.commandCenter.includes('/admin/instacomp/pricing/coverage'),
  "Pricing Command Center does not link the coverage workspace",
);
assert.ok(
  files.commandCenter.includes("Coverage Attack Queue"),
  "Pricing Command Center does not name the coverage workspace",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      adminOnly: true,
      aggregateOnly: true,
      gapTypes: 4,
      sourceDisclosure: false,
      automaticPromotion: false,
    },
    null,
    2,
  ),
);

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}
