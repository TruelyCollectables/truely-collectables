import assert from "node:assert/strict";
import fs from "node:fs";
import { isLaunchSportsCard } from "../src/lib/sports-card-launch-scope";

const adminEngine = fs.readFileSync(
  "src/modules/inventory/admin-engine.ts",
  "utf8",
);
const inventoryIndex = fs.readFileSync(
  "src/modules/inventory/index.ts",
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

console.log("eBay import and sports-card launch-scope simulations passed: 26/26");
