import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260731044000_grant_collx_boundary_view_to_service_role.sql",
  "utf8",
);
const soldHistory = fs.readFileSync(
  "src/lib/collectible-sale-history.ts",
  "utf8",
);
const shopPage = fs.readFileSync("src/app/shop/page.tsx", "utf8");
const nextConfig = fs.readFileSync("next.config.ts", "utf8");

for (const token of [
  "to_regclass('public.collx_only_inventory_boundary_violations')",
  "grant select on public.collx_only_inventory_boundary_violations to service_role",
  "Required storefront boundary view",
]) {
  assert.ok(migration.includes(token), `Missing database permission contract: ${token}`);
}

assert.ok(
  soldHistory.includes('.from("collx_only_inventory_boundary_violations")'),
  "Sold-history boundary must keep excluding CollX-only inventory.",
);
assert.ok(
  shopPage.includes("createSupabaseServerClient({ admin: true })"),
  "The storefront sold-history query must use the privileged server client.",
);
assert.ok(
  shopPage.includes("listRecentSoldStorefrontItems"),
  "The shop must keep recently sold inventory behind the boundary filter.",
);

for (const token of [
  "Content-Security-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "frame-ancestors 'none'",
  "protocol: \"https\"",
]) {
  assert.ok(nextConfig.includes(token), `Missing storefront security contract: ${token}`);
}
assert.doesNotMatch(
  nextConfig,
  /protocol:\s*"http"/,
  "The image optimizer must not fetch arbitrary plaintext HTTP images.",
);

console.log("Storefront boundary permission and security simulations passed.");
