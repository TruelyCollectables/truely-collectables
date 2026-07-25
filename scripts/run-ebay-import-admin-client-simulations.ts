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
const importRoute = fs.readFileSync(
  "src/app/api/ebay/import-listings/route.ts",
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

console.log("eBay import admin-client simulations passed: 7/7");
