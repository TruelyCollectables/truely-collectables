import assert from "node:assert/strict";
import fs from "node:fs";

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

console.log("eBay import admin-client simulations passed: 12/12");
