import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MAX_LISTING_IMAGES,
  listingImageAltText,
  listingImageIdentity,
  normalizeListingImageUrls,
  preferHighResolutionListingImage,
  selectFrontBackListingImages,
} from "../src/lib/listing-image-utils";
import { isLaunchSportsCard } from "../src/lib/sports-card-launch-scope";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

const adminEngine = read("src/modules/inventory/admin-engine.ts");
const inventoryIndex = read("src/modules/inventory/index.ts");
const checkoutInventoryEngine = read("src/modules/inventory/checkout-engine.ts");
const inventoryRepository = read("src/modules/inventory/repository.ts");
const importRoute = read("src/app/api/ebay/import-listings/route.ts");
const importRunner = read("src/app/admin/ebay/import-runner/EbayImportRunner.tsx");
const publicInventoryEngine = read("src/lib/server-inventory-engine.ts");
const productImageRoute = read("src/app/api/storefront/product-images/[id]/route.ts");
const productPage = read("src/app/product/[id]/page.tsx");
const productGallery = read("src/app/product/[id]/ProductGallery.tsx");
const imageSync = read("src/lib/ebay-all-image-sync.ts");
const scheduledEbaySync = read("src/app/api/cron/ebay-store-fixed-price-sync/route.ts");

assert.match(
  adminEngine,
  /createSupabaseServerClient\(\{ admin: true \}\)/,
  "Server inventory engine must request the service-role Supabase client.",
);
assert.match(
  adminEngine,
  /new InventoryRepository\(storeId, database\)/,
  "Inventory repository must receive the same admin database client.",
);
assert.match(
  adminEngine,
  /new InventoryEngine\([\s\S]*repository,[\s\S]*database,[\s\S]*\)/,
  "Inventory engine must receive both the admin repository and database client.",
);
assert.match(
  inventoryIndex,
  /export \{ adminInventoryEngine as inventoryEngine \} from "\.\/admin-engine";/,
  "Shared server imports must resolve inventoryEngine to the admin-backed engine.",
);
assert.match(
  inventoryIndex,
  /export \{ InventoryEngine \} from "\.\/checkout-engine";/,
  "Public checkout imports must resolve InventoryEngine to the launch-scope guard.",
);
assert.match(
  checkoutInventoryEngine,
  /items\.find\(\(item\) => !isLaunchSportsCard\(item\)\)/,
  "Checkout must reject every cart line outside the sports-card launch scope.",
);

const upsertStart = inventoryRepository.indexOf("async upsertBySku");
const legacyProductLookup = inventoryRepository.indexOf("getByLegacyProductId", upsertStart);
const skuLookup = inventoryRepository.indexOf("getBySku", upsertStart);
assert.ok(
  upsertStart >= 0 && legacyProductLookup > upsertStart && skuLookup > legacyProductLookup,
  "Inventory upserts must resolve the existing legacy product row before falling back to SKU.",
);
assert.match(
  inventoryRepository,
  /existingByLegacyProductId\s*\?\?\s*\(await this\.getBySku\(input\.sku\)\)/,
  "SKU fallback must reuse the canonical product-linked inventory row when available.",
);

for (const contract of [
  "items.filter(isLaunchSportsCard)",
  "class PublicStorefrontInventoryEngine extends InventoryEngine",
  "return item && isLaunchSportsCard(item) ? item : null;",
  "return items.filter(isLaunchSportsCard);",
]) {
  assert.ok(publicInventoryEngine.includes(contract), `Public inventory scope is missing ${contract}.`);
}

assert.match(
  productImageRoute,
  /createServerInventoryEngine\(\)\.getByLegacyProductId/,
  "The legacy public product-image endpoint must retain the sports-card scope guard.",
);
assert.match(
  productImageRoute,
  /selectFrontBackListingImages/,
  "The legacy endpoint must still return a deterministic front/back pair.",
);
for (const contract of [
  '.from("inventory_images")',
  '.from("inventory_items")',
  "selectFrontBackListingImages([",
  "...stringList(metadata.ebay_image_urls)",
  "<ProductGallery title={product.title} images={galleryImages} />",
]) {
  assert.ok(productPage.includes(contract), `Product page gallery is missing ${contract}.`);
}
for (const contract of [
  "listingImageAltText",
  "listingImageLabel",
  "images.map((image, index)",
  'aria-label="Choose listing photo"',
  "className=\"object-contain p-3\"",
  "className=\"object-contain\"",
]) {
  assert.ok(productGallery.includes(contract), `Product gallery is missing ${contract}.`);
}

assert.equal(MAX_LISTING_IMAGES, 24, "Internal ingestion must preserve up to twenty-four ordered source images.");
assert.match(imageSync, /ebay_all_image_sync_version/, "Image repair must persist its complete-image version.");
assert.match(
  imageSync,
  /sort_order: index,[\s\S]*is_primary: index === 0/,
  "Image repair must remove sort collisions and preserve exactly one primary image.",
);
assert.match(
  imageSync,
  /imageListsMatch\(currentImages, finalImages\)/,
  "Image repair must compare the complete ordered image list.",
);
assert.match(
  scheduledEbaySync,
  /syncEbayAllListingImages/,
  "The scheduled authoritative eBay job must run complete image reconciliation.",
);

assert.equal(
  preferHighResolutionListingImage("https://i.ebayimg.com/images/g/example/s-l140.jpg"),
  "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
);
assert.equal(
  listingImageIdentity("https://i.ebayimg.com/images/g/example/s-l140.jpg"),
  listingImageIdentity("https://i.ebayimg.com/images/g/example/s-l1600.jpg"),
);
assert.deepEqual(
  normalizeListingImageUrls([
    "https://i.ebayimg.com/images/g/front/s-l140.jpg",
    "https://i.ebayimg.com/images/g/front/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/back/s-l140.jpg",
  ]),
  [
    "https://i.ebayimg.com/images/g/front/s-l1600.jpg",
    "https://i.ebayimg.com/images/g/back/s-l1600.jpg",
  ],
);
const normalizedImages = normalizeListingImageUrls(
  Array.from({ length: 30 }, (_, index) =>
    `https://i.ebayimg.com/images/g/photo-${index + 1}/s-l140.jpg`,
  ),
);
assert.equal(normalizedImages.length, 24);
assert.equal(normalizedImages.at(-1), "https://i.ebayimg.com/images/g/photo-24/s-l1600.jpg");
assert.deepEqual(
  selectFrontBackListingImages([
    "https://i.ebayimg.com/images/g/front/s-l140.jpg",
    "https://storage.googleapis.com/cards/front.jpg",
    "https://storage.googleapis.com/cards/back.jpg",
  ]),
  [
    "https://storage.googleapis.com/cards/front.jpg",
    "https://storage.googleapis.com/cards/back.jpg",
  ],
);
assert.equal(listingImageAltText("Test Card", 1), "Test Card back");

for (const [pattern, message] of [
  [/limit: Number\(url\.searchParams\.get\("limit"\) \|\| "10"\)/, "Import route must default to ten-listing batches."],
  [/result\.debugSamples\.find\([\s\S]*includes\("failed"\)/, "Import route must inspect diagnostics for batch failures."],
  [/success: false,[\s\S]*status: 409/, "Diagnostic failures must stop the browser runner."],
  [/result\.nextOffset === null[\s\S]*syncEbayAllListingImages/, "Final import page must reconcile all images."],
] as const) {
  assert.match(importRoute, pattern, message);
}
assert.match(importRunner, /const \[limit, setLimit\] = useState\(10\);/);
assert.match(importRunner, /\{\[5, 10\]\.map\(\(value\) => \(/);
assert.match(importRunner, /border-rose-300 bg-rose-50[\s\S]*border-sky-300 bg-sky-50/);

const launchScopeCases = [
  ["2025-26 Upper Deck #702 Florian Xhekaj", null, true],
  ["2023 Topps Max Meyer 1988 35th Chrome RC Auto /249 PSA 8", null, true],
  ["2025-26 SP Game Used #115 Dustin Byfuglien Red Jersey", "HOCKEY", true],
  ["2014-15 Flawless Nick Van Exel Momentous Autographed Memorabilia /20", "BASKETBALL", true],
  ["2017-18 SP Authentic #188 Cole Sillinger #/999", "HOCKEY", true],
  ["18-19 Contenders Nick Van Exel Legendary Auto /99", "BASKETBALL", true],
  ["Wailord ex 016/084 Double Rare Pokemon Pitch Black 2026 NM", null, false],
  ["Prize Pack Series Cards #005 Basic Psychic Energy", null, false],
  ["Adidas Ultraboost Men's Running Shoes Size 11", null, false],
  ["Upper Deck Authenticated Wayne Gretzky Signed Puck", "HOCKEY", false],
  ["Connor McDavid Autographed Edmonton Oilers Jersey", "HOCKEY", false],
  ["Oakley Sports Sunglasses Black", null, false],
] as const;

for (const [title, sport, expected] of launchScopeCases) {
  assert.equal(isLaunchSportsCard({ title, sport }), expected, `Unexpected launch scope decision for: ${title}`);
}

console.log("eBay import, sports-card scope, internal image preservation, and public front/back simulations passed.");
