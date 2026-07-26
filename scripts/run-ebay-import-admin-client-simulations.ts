import assert from "node:assert/strict";
import fs from "node:fs";
import {
  listingImageAltText,
  listingImageIdentity,
  normalizeListingImageUrls,
  preferHighResolutionListingImage,
  selectFrontBackListingImages,
} from "../src/lib/listing-image-utils";
import { isLaunchSportsCard } from "../src/lib/sports-card-launch-scope";

const adminEngine = fs.readFileSync(
  "src/modules/inventory/admin-engine.ts",
  "utf8",
);
const inventoryIndex = fs.readFileSync(
  "src/modules/inventory/index.ts",
  "utf8",
);
const checkoutInventoryEngine = fs.readFileSync(
  "src/modules/inventory/checkout-engine.ts",
  "utf8",
);
const inventoryRepository = fs.readFileSync(
  "src/modules/inventory/repository.ts",
  "utf8",
);
const importRoute = fs.readFileSync(
  "src/app/api/ebay/import-listings/route.ts",
  "utf8",
);
const importRunner = fs.readFileSync(
  "src/app/admin/ebay/import-runner/EbayImportRunner.tsx",
  "utf8",
);
const publicInventoryEngine = fs.readFileSync(
  "src/lib/server-inventory-engine.ts",
  "utf8",
);
const productImageRoute = fs.readFileSync(
  "src/app/api/storefront/product-images/[id]/route.ts",
  "utf8",
);
const productActions = fs.readFileSync(
  "src/app/product/[id]/ProductActions.tsx",
  "utf8",
);
const imageSync = fs.readFileSync(
  "src/lib/ebay-front-back-image-sync.ts",
  "utf8",
);
const scheduledEbaySync = fs.readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "utf8",
);

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
  /class InventoryEngine extends BaseInventoryEngine/,
  "Checkout launch-scope enforcement must preserve the base inventory API.",
);
assert.match(
  checkoutInventoryEngine,
  /items\.find\(\(item\) => !isLaunchSportsCard\(item\)\)/,
  "Checkout must reject every cart line outside the sports-card launch scope.",
);
assert.match(
  checkoutInventoryEngine,
  /Product \$\{blockedItem\.legacyProductId\} is not available for purchase/,
  "Checkout must fail closed before reserving an out-of-scope item.",
);

const upsertStart = inventoryRepository.indexOf("async upsertBySku");
const legacyProductLookup = inventoryRepository.indexOf(
  "getByLegacyProductId",
  upsertStart,
);
const skuLookup = inventoryRepository.indexOf("getBySku", upsertStart);
assert.ok(
  upsertStart >= 0 &&
    legacyProductLookup > upsertStart &&
    skuLookup > legacyProductLookup,
  "Inventory upserts must resolve the existing legacy product row before falling back to SKU.",
);
assert.match(
  inventoryRepository,
  /existingByLegacyProductId\s*\?\?\s*\(await this\.getBySku\(input\.sku\)\)/,
  "SKU fallback must reuse the canonical product-linked inventory row when available.",
);

assert.match(
  publicInventoryEngine,
  /items\.filter\(isLaunchSportsCard\)/,
  "Every public inventory feed must enforce the sports-card launch scope.",
);
assert.match(
  publicInventoryEngine,
  /class PublicStorefrontInventoryEngine extends InventoryEngine/,
  "Public storefront filtering must preserve the full InventoryEngine API.",
);
assert.match(
  publicInventoryEngine,
  /async getByLegacyProductId\([\s\S]*return item && isLaunchSportsCard\(item\) \? item : null;/,
  "Direct product URLs must return no product when launch scope rejects the item.",
);
assert.match(
  publicInventoryEngine,
  /async getByLegacyProductIds\([\s\S]*return items\.filter\(isLaunchSportsCard\);/,
  "Bulk public product lookups must enforce the same launch scope.",
);

assert.match(
  productImageRoute,
  /createServerInventoryEngine\(\)\.getByLegacyProductId/,
  "The public product-image endpoint must reuse the sports-card scope guard.",
);
assert.match(
  productImageRoute,
  /selectFrontBackListingImages/,
  "Public product images must choose one complete front/back pair.",
);
assert.match(
  productActions,
  /\/api\/storefront\/product-images\/\$\{product\.id\}/,
  "Product pages must load the scoped front/back image response.",
);
assert.match(
  productActions,
  /index === 0 \? "Front" : "Back"/,
  "The native product photo panel must label front and back deterministically.",
);
assert.match(
  imageSync,
  /ebay_front_back_image_sync_version/,
  "The eBay image repair must use a persisted one-time synchronization version.",
);
assert.match(
  imageSync,
  /sort_order: index,[\s\S]*is_primary: index === 0/,
  "Image repair must remove sort collisions and preserve exactly one primary image.",
);
assert.match(
  scheduledEbaySync,
  /syncEbayFrontBackImages/,
  "The scheduled authoritative eBay job must run the guarded front/back image sync.",
);

assert.equal(
  preferHighResolutionListingImage(
    "https://i.ebayimg.com/images/g/example/s-l140.jpg",
  ),
  "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
  "eBay thumbnails must be upgraded to the high-resolution image path.",
);
assert.equal(
  listingImageIdentity(
    "https://i.ebayimg.com/images/g/example/s-l140.jpg",
  ),
  listingImageIdentity(
    "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
  ),
  "Different eBay size variants of the same photo must share one identity.",
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
  "Image normalization must keep one front and one distinct back photo.",
);
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
  "A complete existing front/back pair must beat a lone eBay thumbnail.",
);
assert.equal(
  listingImageAltText("Test Card", 1),
  "Test Card back",
  "The second synchronized image must receive a back-photo alt label.",
);

assert.match(
  importRoute,
  /limit: Number\(url\.searchParams\.get\("limit"\) \|\| "10"\)/,
  "Import route must default to ten-listing batches.",
);
assert.match(
  importRoute,
  /result\.debugSamples\.find\([\s\S]*includes\("failed"\)/,
  "Import route must inspect diagnostics for batch failures.",
);
assert.match(
  importRoute,
  /success: false,[\s\S]*status: 409/,
  "Diagnostic failures must stop the browser runner with a non-success response.",
);
assert.match(
  importRunner,
  /const \[limit, setLimit\] = useState\(10\);/,
  "Browser import runner must default to ten listings.",
);
assert.match(
  importRunner,
  /\{\[5, 10\]\.map\(\(value\) => \(/,
  "Browser import runner must offer only timeout-safe batch sizes.",
);
assert.match(
  importRunner,
  /border-rose-300 bg-rose-50[\s\S]*border-sky-300 bg-sky-50/,
  "Import status banner must distinguish error red from success blue.",
);

const launchScopeCases = [
  {
    title: "2025-26 Upper Deck #702 Florian Xhekaj",
    sport: null,
    expected: true,
  },
  {
    title: "2023 Topps Max Meyer 1988 35th Chrome RC Auto /249 PSA 8",
    sport: null,
    expected: true,
  },
  {
    title: "2025-26 SP Game Used #115 Dustin Byfuglien Red Jersey",
    sport: "HOCKEY",
    expected: true,
  },
  {
    title: "2014-15 Flawless Nick Van Exel Momentous Autographed Memorabilia /20",
    sport: "BASKETBALL",
    expected: true,
  },
  {
    title: "2017-18 SP Authentic #188 Cole Sillinger #/999",
    sport: "HOCKEY",
    expected: true,
  },
  {
    title: "18-19 Contenders Nick Van Exel Legendary Auto /99",
    sport: "BASKETBALL",
    expected: true,
  },
  {
    title: "Wailord ex 016/084 Double Rare Pokemon Pitch Black 2026 NM",
    sport: null,
    expected: false,
  },
  {
    title: "Prize Pack Series Cards #005 Basic Psychic Energy",
    sport: null,
    expected: false,
  },
  {
    title: "Adidas Ultraboost Men's Running Shoes Size 11",
    sport: null,
    expected: false,
  },
  {
    title: "Upper Deck Authenticated Wayne Gretzky Signed Puck",
    sport: "HOCKEY",
    expected: false,
  },
  {
    title: "Connor McDavid Autographed Edmonton Oilers Jersey",
    sport: "HOCKEY",
    expected: false,
  },
  {
    title: "Oakley Sports Sunglasses Black",
    sport: null,
    expected: false,
  },
] as const;

for (const testCase of launchScopeCases) {
  assert.equal(
    isLaunchSportsCard(testCase),
    testCase.expected,
    `Unexpected launch scope decision for: ${testCase.title}`,
  );
}

console.log(
  "eBay import, sports-card scope, and front/back image simulations passed: 44/44",
);
