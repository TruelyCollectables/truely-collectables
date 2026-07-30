import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const offerPriceMigration = read(
  "supabase/migrations/20260730001950_correct_offer_order_item_paid_prices.sql",
);
const saleMigration = read(
  "supabase/migrations/20260730002000_sold_storefront_retention_and_sale_history.sql",
);
const outboxMigration = read(
  "supabase/migrations/20260730002100_manual_sale_ebay_outbox.sql",
);
const inactiveSaleMigration = read(
  "supabase/migrations/20260730002200_capture_ebay_inactive_sale_state.sql",
);
const verifiedTimeMigration = read(
  "supabase/migrations/20260730002300_refine_verified_sale_timestamps.sql",
);
const idempotencyMigration = read(
  "supabase/migrations/20260730002400_make_sale_recording_idempotent.sql",
);
const restockMigration = read(
  "supabase/migrations/20260730002500_reset_sold_presentation_on_restock.sql",
);
const atomicEbayMigration = read(
  "supabase/migrations/20260730002600_atomic_ebay_order_sales_and_outbox_scope.sql",
);
const saleHistory = read("src/lib/collectible-sale-history.ts");
const collxBoundaryMigration = read("supabase/migrations/20260730002800_enforce_collx_inventory_boundary.sql");
const checkoutEngine = read("src/modules/inventory/checkout-engine.ts");
const publicInventoryEngine = read("src/lib/server-inventory-engine.ts");
const ebayOrders = read("src/lib/ebay-order-sale-sync.ts");
const ebayAliases = read("src/lib/ebay-merged-listing-groups.ts");
const ebayAuth = read("src/app/api/ebay/auth/route.ts");
const adminOrdersHealth = read("src/app/api/admin-orders-health/route.ts");
const fulfillmentHealth = read("src/app/api/fulfillment-health/route.ts");
const overlay = read("src/components/SoldOverlay.tsx");
const shop = read("src/app/shop/page.tsx");
const productLayout = read("src/app/product/[id]/layout.tsx");
const admin = read("src/app/admin/sales-history/page.tsx");
const adminProductLayout = read("src/app/admin/products/[id]/layout.tsx");
const archiveCron = read("src/app/api/cron/sold-collectible-archive/route.ts");
const ebayOrderCron = read("src/app/api/cron/ebay-order-sale-sync/route.ts");
const vercel = JSON.parse(read("vercel.json"));

assert.match(offerPriceMigration, /stripe_session_id = order_row\.stripe_session_id/);
assert.match(offerPriceMigration, /coalesce\(offer_row\.counter_amount, offer_row\.offer_amount\)/);
assert.match(offerPriceMigration, /before insert or update/);
assert.match(offerPriceMigration, /update public\.order_items/);
assert.match(offerPriceMigration, /new\.price := paid_offer_price/);

assert.match(saleMigration, /create table if not exists public\.collectible_sales/);
assert.match(saleMigration, /unique \(store_id, event_key\)/);
assert.match(saleMigration, /collectible_sales_append_only/);
assert.match(saleMigration, /record_collectible_sale/);
assert.match(saleMigration, /archive_after[^;]+interval '7 days'/s);
assert.match(saleMigration, /archive_expired_collectible_sales/);
assert.match(saleMigration, /instacomp_internal_sold_comps/);
assert.match(saleMigration, /evidence_status in \('verified','manual'\)/);
assert.match(saleMigration, /2026-07-28 00:00:00\+00/);
assert.match(saleMigration, /historical_order_items_backfill/);
assert.match(saleMigration, /sold_price_status = 'unresolved'/);

assert.match(outboxMigration, /'manual_sale'/);
assert.match(outboxMigration, /desired_quantity,\s*status/s);
assert.match(outboxMigration, /\n    0,\n    'pending'/);
assert.match(outboxMigration, /after insert on public\.collectible_sales/);

assert.match(inactiveSaleMigration, /capture_ebay_inactive_collectible_sale/);
assert.match(inactiveSaleMigration, /ebay_not_active_at_last_full_sync/);
assert.match(inactiveSaleMigration, /previous_inactive_at_text is not distinct from inactive_at_text/);
assert.match(inactiveSaleMigration, /ebay_or_collx_via_ebay/);
assert.match(inactiveSaleMigration, /source_chain/);
assert.match(inactiveSaleMigration, /force_zero|,\s*true\s*\)/s);

assert.match(verifiedTimeMigration, /refine_collectible_sold_time_from_verified_sale/);
assert.match(verifiedTimeMigration, /new\.evidence_status not in \('verified', 'manual'\)/);
assert.match(verifiedTimeMigration, /least\(sold_at, new\.sold_at\)/);
assert.match(verifiedTimeMigration, /new\.sold_at \+ interval '7 days'/);
assert.match(verifiedTimeMigration, /quantity <= 0/);
assert.match(verifiedTimeMigration, /lifecycle_status = 'sold'/);

assert.match(idempotencyMigration, /record_collectible_sale_unsafe_20260730/);
assert.match(idempotencyMigration, /pg_advisory_xact_lock/);
assert.match(idempotencyMigration, /store_id = p_store_id/);
assert.match(idempotencyMigration, /event_key = normalized_event_key/);
assert.match(idempotencyMigration, /return existing_sale_id/);
assert.match(idempotencyMigration, /from public, anon, authenticated, service_role/);

assert.match(restockMigration, /reset_product_sold_presentation_on_restock/);
assert.match(restockMigration, /reset_inventory_sold_presentation_on_restock/);
assert.match(restockMigration, /reset_collectible_asset_sold_presentation_on_restock/);
assert.match(restockMigration, /new\.sold_at := null/);
assert.match(restockMigration, /sold_price_evidence = '\{\}'::jsonb/);
assert.match(restockMigration, /- 'ebay_not_active_at_last_full_sync'/);
assert.match(restockMigration, /immutable collectible_sales history remains untouched/);
assert.doesNotMatch(restockMigration, /delete\s+from\s+public\.collectible_sales/i);

assert.match(atomicEbayMigration, /apply_ebay_order_collectible_sale/);
assert.match(atomicEbayMigration, /pg_advisory_xact_lock/);
assert.match(atomicEbayMigration, /for update/);
assert.match(atomicEbayMigration, /next_product_quantity/);
assert.match(atomicEbayMigration, /next_inventory_quantity/);
assert.match(atomicEbayMigration, /record_collectible_sale_unsafe_20260730/);
assert.match(atomicEbayMigration, /'website',\s*'ebay',\s*'ebay_or_collx_via_ebay'/s);
assert.match(atomicEbayMigration, /new\.source_marketplace in/);
assert.match(atomicEbayMigration, /create table if not exists public\.ebay_inbound_sale_guards/);
assert.match(atomicEbayMigration, /protected_quantity integer not null/);
assert.match(atomicEbayMigration, /truely_protect_ebay_order_product_quantity/);
assert.match(atomicEbayMigration, /truely_protect_ebay_order_inventory_quantity/);
assert.match(atomicEbayMigration, /new\.quantity > guarded_quantity/);
assert.match(atomicEbayMigration, /release_ebay_inbound_sale_guard/);
assert.match(atomicEbayMigration, /A restock release reason is required/);
assert.match(atomicEbayMigration, /insert into public\.ebay_inbound_sale_guards as existing/);
assert.match(atomicEbayMigration, /protected_quantity = least\(existing\.protected_quantity, excluded\.protected_quantity\)/);
assert.match(atomicEbayMigration, /Durable lower-bound inventory protection/);

assert.match(saleHistory, /SOLD_STOREFRONT_RETENTION_DAYS = 7/);
assert.match(saleHistory, /listRecentSoldStorefrontItems/);
assert.match(saleHistory, /\.gte\("sold_at", cutoff\)/);
assert.match(saleHistory, /\.is\("archived_at", null\)/);
assert.match(saleHistory, /isLaunchCollectible/);
assert.match(saleHistory, /isMergedEbayAliasItemId/);
assert.match(saleHistory, /listAdminSaleHistory/);
assert.match(saleHistory, /\.is\("sold_price", null\)/);

assert.match(overlay, /-rotate-\[32deg\]/);
assert.match(overlay, /bg-red-600/);
assert.match(overlay, />\s*\{label\}\s*</);

assert.match(shop, /Recently sold collectibles/);
assert.match(shop, /<SoldOverlay compact \/>/);
assert.match(shop, /Sold price pending verification/);
assert.match(shop, /locked from checkout, offers, and cart actions/);
assert.doesNotMatch(shop, /SoldProductCard[\s\S]*ProductActions/);
assert.doesNotMatch(shop, /SoldProductCard[\s\S]*OfferForm/);

assert.match(productLayout, /Sold · Research only/);
assert.match(productLayout, /locked from cart, checkout, Buy Now, and Best/);
assert.match(productLayout, /<SoldOverlay \/>/);
assert.match(productLayout, /function isSoldRetentionExpired/);
assert.match(productLayout, /archiveTime <= Date\.now\(\)/);
assert.match(productLayout, /if \(isSoldRetentionExpired\(saleState\)\)/);
assert.match(productLayout, /notFound\(\)/);
assert.doesNotMatch(productLayout, /ProductActions/);
assert.doesNotMatch(productLayout, /OfferForm/);

assert.match(admin, /Mark Sold Elsewhere/);
assert.match(admin, /forceZero: true/);
assert.match(admin, /Sold Price Unresolved/);
assert.match(admin, /Original Listing Price/);
assert.match(admin, /Actual sold price/);

assert.match(adminProductLayout, /Actual sale evidence/);
assert.match(adminProductLayout, /Original listing price/);
assert.match(adminProductLayout, /Actual sold price/);
assert.match(adminProductLayout, /collectible_sales/);
assert.match(adminProductLayout, /evidence_status/);
assert.match(adminProductLayout, /Open Sale History/);

for (const healthRoute of [adminOrdersHealth, fulfillmentHealth]) {
  assert.match(healthRoute, /ADMIN_SESSION_COOKIE_NAMES/);
  assert.match(healthRoute, /isValidAdminSessionValue/);
  assert.match(healthRoute, /status:\s*401/);
  assert.match(healthRoute, /createSupabaseServerClient\(\{ admin: true \}\)/);
}

assert.match(ebayAliases, /canonicalLegacyProductIdForEbayItemId/);
assert.match(ebayAliases, /aliasItemIds\.some/);
assert.match(ebayAuth, /https:\/\/api\.ebay\.com\/oauth\/api_scope/);
assert.match(ebayOrders, /GetOrders/);
assert.match(ebayOrders, /<OrderStatus>Completed<\/OrderStatus>/);
assert.doesNotMatch(ebayOrders, /<OrderStatus>All<\/OrderStatus>/);
assert.match(ebayOrders, /TransactionPrice/);
assert.match(ebayOrders, /OrderLineItemID/);
assert.match(ebayOrders, /orderPaidAt/);
assert.match(ebayOrders, /xmlMoney/);
assert.match(ebayOrders, /DEFAULT_LOOKBACK_DAYS = 2/);
assert.match(ebayOrders, /canonicalLegacyProductIdForEbayItemId/);
assert.match(ebayOrders, /canonical_legacy_product_id/);
assert.match(ebayOrders, /matched_product_ebay_item_id/);
assert.match(ebayOrders, /apply_ebay_order_collectible_sale/);
assert.doesNotMatch(ebayOrders, /decrementAfterSale/);
assert.match(ebayOrders, /evidence_source: "ebay_get_orders"/);
assert.match(ebayOrders, /alreadyRecorded/);
assert.match(ebayOrderCron, /safeLookbackDays/);
assert.match(ebayOrderCron, /Math\.min\(Math\.max\(Math\.floor\(requested\), 1\), 90\)/);

assert.match(archiveCron, /archiveExpiredCollectibleSales/);
assert.match(archiveCron, /timingSafeEqual/);

assert.match(collxBoundaryMigration, /collx_only_inventory_boundary_violations/);
assert.match(collxBoundaryMigration, /COLLX_ONLY_INVENTORY_BLOCKED/);
assert.match(collxBoundaryMigration, /before insert or update/);
assert.match(collxBoundaryMigration, /actual sale price\/date\/reference ingestion/);
assert.match(collxBoundaryMigration, /race\/retry\/duplicate\/reconciliation tests pass/);
assert.match(publicInventoryEngine, /collx_only_inventory_boundary_violations/);
assert.match(publicInventoryEngine, /!collxOnlyProductIds\.has\(item\.legacyProductId\)/);
assert.match(checkoutEngine, /collx_only_inventory_boundary_violations/);
assert.match(checkoutEngine, /collxOnlyProductIds\.has\(item\.legacyProductId\)/);
assert.match(saleHistory, /collx_only_inventory_boundary_violations/);
assert.match(saleHistory, /!collxOnlyProductIds\.has\(item\.legacyProductId\)/);
assert.equal(fs.existsSync("src/app/api/cron/collx-inventory-sync/route.ts"), false);
assert.equal(fs.existsSync("src/app/api/cron/collx-sales-sync/route.ts"), false);

const cronByPath = new Map(
  (vercel.crons || []).map((cron) => [cron.path, cron.schedule]),
);
assert.equal(
  cronByPath.get("/api/cron/ebay-order-sale-sync?lookbackDays=2"),
  "*/5 * * * *",
);
assert.equal(
  cronByPath.get("/api/cron/ebay-store-fixed-price-sync"),
  "2,17,32,47 * * * *",
);
assert.equal(
  cronByPath.get("/api/cron/seller-ebay-reconciliation"),
  "7,22,37,52 * * * *",
);
assert.equal(cronByPath.get("/api/cron/sold-collectible-archive"), "11 * * * *");

console.log(
  JSON.stringify(
    {
      ok: true,
      contract: "Launch 2.0 issue #253",
      soldRetentionDays: 7,
      ebayOrderPollingMinutes: 5,
      ebayOrderRecurringLookbackDays: 2,
      authoritativeEbayPollingMinutes: 15,
      checks: 165,
    },
    null,
    2,
  ),
);
