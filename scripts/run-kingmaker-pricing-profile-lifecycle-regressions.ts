import assert from "node:assert/strict";
import fs from "node:fs";
import {
  KINGMAKER_PRICING_PROFILE_PRESETS,
  normalizeCloneName,
  normalizeKingmakerPricingProfileMutation,
  resolveKingmakerPricingProfilePreset,
} from "../src/lib/kingmaker-pricing-profile-lifecycle";

assert.equal(KINGMAKER_PRICING_PROFILE_PRESETS.length, 3);
assert.equal(resolveKingmakerPricingProfilePreset("fast-flip")?.targetMarginPct, 0.2);
assert.equal(resolveKingmakerPricingProfilePreset("missing"), null);
assert.equal(normalizeCloneName("", "Standard"), "Standard Copy");
assert.equal(normalizeCloneName("Custom", "Standard"), "Custom");

const normalized = normalizeKingmakerPricingProfileMutation({
  name: "  Seller Profile  ",
  marketplaceFeePct: 99,
  paymentFeePct: -1,
  paymentFixedFee: 100,
  estimatedShippingCost: 999,
  targetMarginPct: 0,
  isDefault: true,
  expectedVersion: 4,
});
assert.equal(normalized.name, "Seller Profile");
assert.equal(normalized.marketplaceFeePct, 0.5);
assert.equal(normalized.paymentFeePct, 0);
assert.equal(normalized.paymentFixedFee, 25);
assert.equal(normalized.estimatedShippingCost, 250);
assert.equal(normalized.targetMarginPct, 0.05);
assert.equal(normalized.isDefault, true);
assert.equal(normalized.expectedVersion, 4);
assert.equal(
  normalizeKingmakerPricingProfileMutation({ name: "No Version" }).expectedVersion,
  undefined,
);

const server = fs.readFileSync(
  "src/lib/kingmaker-pricing-profile-lifecycle-server.ts",
  "utf8",
);
const route = fs.readFileSync(
  "src/app/api/instacomp/pricing/profiles/[profileId]/route.ts",
  "utf8",
);
const migration = fs.readFileSync(
  "supabase/migrations/20260804004500_kingmaker_pricing_profile_atomic_lifecycle.sql",
  "utf8",
);

for (const marker of [
  "tcos_create_kingmaker_pricing_profile_atomic",
  "tcos_update_kingmaker_pricing_profile_atomic",
  "tcos_clone_kingmaker_pricing_profile_atomic",
  "tcos_retire_kingmaker_pricing_profile_atomic",
  "Pricing profile expectedVersion is required.",
]) {
  assert.ok(server.includes(marker), `Missing atomic profile server marker: ${marker}`);
}
assert.equal(server.includes("resetDefaults"), false);
assert.equal(
  server.includes('.from("tcos_kingmaker_pricing_profiles").update('),
  false,
  "Lifecycle server must not perform multi-call profile updates outside the atomic RPC.",
);
assert.ok(route.includes("expectedVersion: body.expectedVersion"));

for (const marker of [
  "pg_advisory_xact_lock",
  "is not distinct from p_seller_account_id",
  "v_current_version <> p_expected_version",
  "tcos_kingmaker_pricing_profile_audit",
  "from public, anon, authenticated",
  "to service_role",
]) {
  assert.ok(migration.includes(marker), `Missing atomic profile SQL marker: ${marker}`);
}

console.log("KINGMAKER Pricing profile lifecycle regressions passed.");
