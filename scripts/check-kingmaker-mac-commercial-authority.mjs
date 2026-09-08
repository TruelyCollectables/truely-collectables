import fs from "node:fs";

function source(path) {
  return fs.readFileSync(path, "utf8");
}
function requireText(text, needle, message) {
  if (!text.includes(needle)) throw new Error(message || `Missing ${needle}`);
}
function forbid(text, needle, message) {
  if (text.includes(needle)) throw new Error(message || `Forbidden ${needle}`);
}

const admin = source("src/app/api/account/seller/inventory-admin/route.ts");
const runner = source("services/instacomp-ai/scripts/kingmaker_ebay_publish.ts");
const callback = source("src/app/api/ebay/callback/route.ts");
const publisher = source("src/lib/ebay-inventory-publisher-audited.ts");
const macRoutes = source("services/instacomp-ai/app/kingmaker_accounting_routes.py");

forbid(admin, "createSupabaseServerClient", "Inventory Admin must not load commercial inventory from Supabase.");
forbid(admin, '.from("inventory_items")', "Inventory Admin must not use the cloud inventory table.");
requireText(admin, "/v1/kingmaker/accounting/commercial-inventory");
requireText(admin, 'sourceOfTruth: "mac_local"');

forbid(runner, "createSupabaseServerClient", "Mac eBay runner must not read credentials/listings from Supabase.");
requireText(runner, "ebay-seller-token.json");
requireText(runner, 'mode === "inventory_snapshot"');
requireText(runner, "persistLocalToken(data)");
requireText(runner, '"GetMyeBaySelling"', "Mac inventory snapshot must enumerate active eBay listings through the Trading API.");
requireText(runner, 'source: "trading_api_get_my_ebay_selling"');
forbid(runner, 'fetchPaged(accessToken, "/sell/inventory/v1/offer"', "Mac inventory snapshot must not fail globally on one malformed Inventory API SKU.");

forbid(callback, "encryptMarketplaceToken", "OAuth callback must not persist eBay credentials in cloud tables.");
forbid(callback, '.from("ebay_tokens").insert', "OAuth callback must not write the legacy eBay token table.");
requireText(callback, "data.tokenStored !== true");
requireText(callback, 'token_storage_key: "mac_local:TCOS-Current-Review/ebay-seller-token.json"');

requireText(publisher, "refreshToken?: string | null");
requireText(macRoutes, '"/commercial-inventory"');
requireText(macRoutes, '"sourceOfTruth": "mac_local"');

console.log("PASS KINGMAKER commercial inventory and eBay credential authority are Mac-local.");
