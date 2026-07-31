import assert from "node:assert/strict";
import fs from "node:fs";
import { validatedHttpsImageUrls } from "../src/lib/ebay-listing-content";

for (const unsafeUrl of [
  "https://localhost/card.jpg",
  "https://127.0.0.1/card.jpg",
  "https://10.0.0.8/card.jpg",
  "https://172.16.1.5/card.jpg",
  "https://192.168.1.5/card.jpg",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/card.jpg",
  "https://printer.local/card.jpg",
]) {
  assert.throws(
    () => validatedHttpsImageUrls([unsafeUrl]),
    /public HTTPS URLs/,
    `${unsafeUrl} must not be accepted as a public eBay image URL.`,
  );
}

assert.throws(
  () => validatedHttpsImageUrls([`https://example.com/${"x".repeat(2_100)}`]),
  /2,000 characters/,
);
assert.deepEqual(
  validatedHttpsImageUrls([
    "https://cdn.example.com/card.jpg",
    "https://fcdn.example.com/card.jpg",
  ]),
  [
    "https://cdn.example.com/card.jpg",
    "https://fcdn.example.com/card.jpg",
  ],
  "Public CDN hostnames that merely begin with an IPv6-looking prefix must stay allowed.",
);

const adminRoute = fs.readFileSync(
  "src/lib/dual-marketplace-admin-route.ts",
  "utf8",
);
const routeGuard = fs.readFileSync(
  "src/lib/dual-marketplace-admin-route-guard.ts",
  "utf8",
);
const studio = fs.readFileSync(
  "src/app/admin/products/new/AuditedDualMarketplaceListingStudio.tsx",
  "utf8",
);
const apiRoute = fs.readFileSync(
  "src/app/api/admin/dual-marketplace-listings/route.ts",
  "utf8",
);

assert.match(
  adminRoute,
  /\.is\("seller_account_id", null\)/,
  "Flagship admin listing actions must never absorb third-party seller inventory.",
);
assert.doesNotMatch(
  adminRoute,
  /Math\.max\(1,\s*quantity/,
  "Zero stock must never be silently resurrected to one.",
);
assert.doesNotMatch(
  adminRoute,
  /\.slice\(0,\s*100\)/,
  "The API must never silently drop selected listings after item 100.",
);
assert.match(
  routeGuard,
  /eBay is already live; do not blindly republish this row/,
  "Split-channel failures must identify that eBay is already live.",
);
assert.match(
  routeGuard,
  /externalPublished: true/,
  "Split-channel responses must expose external publication state.",
);
assert.match(
  studio,
  /window\.confirm/,
  "Real eBay publishing must require explicit operator confirmation.",
);
assert.match(
  studio,
  /chunkDualMarketplaceItems/,
  "The studio must batch large selections without loss.",
);
assert.match(
  studio,
  /ebayReadiness\?\.ready !== true/,
  "eBay controls must fail closed until readiness is positively proven.",
);
assert.doesNotMatch(
  studio,
  /setSelectedIds\([^\n]*merged\.filter/,
  "The studio must not auto-select every new draft for publication.",
);
assert.match(
  apiRoute,
  /handleGuardedDualMarketplacePost/,
  "The production route must use the pre-write safety guard.",
);

console.log("Dual-marketplace edge and reconciliation audit simulations passed.");
