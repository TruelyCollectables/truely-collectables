import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

const route = read("src/app/api/admin/ebay/launch-ready-sync/route.ts");
for (const token of [
  "runEbayAuthoritativeStoreSync",
  "syncEbayAllListingImages",
  "enrichAndAuditEbayLaunchCatalog",
  "catalogSync.cycleComplete",
  "readiness.notReady === 0",
  "EBAY_LAUNCH_SYNC_ADMIN_REQUIRED",
]) {
  assert.ok(route.includes(token), `Launch-ready route must include ${token}.`);
}
assert.match(route, /mode:\s*"preview"/);
assert.match(route, /mode:\s*"apply"/);

const enrichment = read("src/lib/ebay-launch-ready-enrichment.ts");
for (const token of [
  '"GetItem"',
  '"Description"',
  '"BestOfferEnabled"',
  'website_best_offer_enabled: true',
  "website_shipping_policy_version",
  "website_shipping_uses_listing_price_basis: true",
  '"STANDARD_ENVELOPE"',
  '"GROUND_ADVANTAGE"',
  "missing_description",
  "missing_inventory_images",
  "invalid_primary_image_count",
  "website_best_offer_not_enabled",
  "website_shipping_policy_not_stamped",
]) {
  assert.ok(enrichment.includes(token), `Enrichment must include ${token}.`);
}
assert.doesNotMatch(
  enrichment,
  /\.delete\(|\.truncate\(/,
  "Launch enrichment must never delete or truncate catalog data.",
);

const cleanup = read("src/app/product/[id]/PublicProductCleanup.tsx");
assert.ok(cleanup.includes('toLowerCase() !== "ebay"'));
assert.ok(cleanup.includes("fact.remove()"));
assert.ok(cleanup.includes("MutationObserver"));

const layout = read("src/app/product/[id]/layout.tsx");
assert.ok(layout.includes("PublicProductCleanup"));
assert.ok(layout.includes("{children}"));

const productPage = read("src/app/product/[id]/page.tsx");
assert.ok(
  productPage.includes("<OfferForm"),
  "Every available website product must retain Best Offer checkout.",
);

const shipping = read("src/lib/shipping.ts");
for (const token of [
  "STANDARD_ENVELOPE",
  "GROUND_ADVANTAGE",
  "PRIORITY_MAIL",
  "listingPriceBasis",
]) {
  assert.ok(shipping.includes(token), `Website shipping engine must include ${token}.`);
}

console.log("eBay launch-ready catalog simulations passed.");
