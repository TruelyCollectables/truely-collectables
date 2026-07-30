#!/usr/bin/env bash
set -euo pipefail

cat > src/lib/collx-inventory-boundary.ts <<'TS'
const MARKETPLACE_METADATA_KEYS = [
  "source_marketplace",
  "sourceMarketplace",
  "marketplace",
  "marketplaces",
  "source_marketplaces",
  "sourceMarketplaces",
  "listing_marketplace",
  "listingMarketplace",
  "inventory_source",
  "inventorySource",
  "source",
  "origin",
] as const;

export const DIRECT_COLLX_CONNECTOR_VERIFIED = false;
export const COLLX_VIA_EBAY_LISTING_SYNC_MINUTES = 15;
export const COLLX_VIA_EBAY_RECONCILIATION_OFFSET_MINUTES = 5;
export const COLLX_VIA_EBAY_MAX_SCHEDULED_PROTECTION_MINUTES =
  COLLX_VIA_EBAY_LISTING_SYNC_MINUTES +
  COLLX_VIA_EBAY_RECONCILIATION_OFFSET_MINUTES;

function marketplaceTokens(metadata: Record<string, unknown> | null | undefined) {
  const tokens = new Set<string>();
  if (!metadata) return tokens;

  const add = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value !== "string") return;
    for (const token of value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
      tokens.add(token);
    }
  };

  for (const key of MARKETPLACE_METADATA_KEYS) add(metadata[key]);
  return tokens;
}

export function isCollxOnlyInventory(params: {
  ebayItemId?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (params.ebayItemId?.trim()) return false;
  const tokens = marketplaceTokens(params.metadata);
  return (
    DIRECT_COLLX_CONNECTOR_VERIFIED === false &&
    tokens.has("collx") &&
    !tokens.has("ebay")
  );
}
TS

cat > supabase/migrations/20260730002800_enforce_collx_inventory_boundary.sql <<'SQL'
-- Launch 2.0 issue #253: CollX-only inventory is excluded until a direct connector is verified.
create or replace function public.inventory_metadata_mentions_collx(p_metadata jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  source_text text;
begin
  source_text := lower(concat_ws(' ',
    p_metadata ->> 'source_marketplace',
    p_metadata ->> 'sourceMarketplace',
    p_metadata ->> 'marketplace',
    p_metadata ->> 'marketplaces',
    p_metadata ->> 'source_marketplaces',
    p_metadata ->> 'sourceMarketplaces',
    p_metadata ->> 'listing_marketplace',
    p_metadata ->> 'listingMarketplace',
    p_metadata ->> 'inventory_source',
    p_metadata ->> 'inventorySource',
    p_metadata ->> 'source',
    p_metadata ->> 'origin'
  ));
  return source_text ~ '(^|[^a-z0-9])collx([^a-z0-9]|$)';
end;
$$;

create or replace view public.collx_only_inventory_boundary_violations
with (security_invoker = true)
as
select
  i.id as inventory_item_id,
  i.store_id,
  i.legacy_product_id,
  i.sku,
  p.ebay_item_id
from public.inventory_items i
left join public.products p
  on p.store_id = i.store_id
 and (
   p.id = i.legacy_product_id
   or (i.legacy_product_id is null and i.sku is not null and p.sku = i.sku)
 )
where public.inventory_metadata_mentions_collx(i.metadata)
  and nullif(btrim(coalesce(p.ebay_item_id, '')), '') is null;

create or replace function public.enforce_collx_inventory_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  linked_ebay_item_id text;
begin
  if not public.inventory_metadata_mentions_collx(new.metadata) then
    return new;
  end if;

  select nullif(btrim(p.ebay_item_id), '')
    into linked_ebay_item_id
  from public.products p
  where p.store_id = new.store_id
    and (
      p.id = new.legacy_product_id
      or (new.legacy_product_id is null and new.sku is not null and p.sku = new.sku)
    )
  order by (p.id = new.legacy_product_id) desc
  limit 1;

  if linked_ebay_item_id is null then
    raise exception using
      errcode = '23514',
      message = 'COLLX_ONLY_INVENTORY_BLOCKED',
      detail = 'CollX-only inventory cannot be imported or published until a direct CollX inventory-and-sales connector is verified.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_collx_inventory_boundary on public.inventory_items;
create trigger enforce_collx_inventory_boundary
before insert or update of store_id, legacy_product_id, sku, metadata
on public.inventory_items
for each row execute function public.enforce_collx_inventory_boundary();

revoke all on function public.enforce_collx_inventory_boundary() from public, anon, authenticated;
grant execute on function public.enforce_collx_inventory_boundary() to service_role;
SQL

python - <<'PY'
from pathlib import Path

def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    if text.count(old) != count:
        raise SystemExit(f"{path}: expected {count} anchor(s), found {text.count(old)}")
    p.write_text(text.replace(old, new, count))

replace(
    "src/modules/inventory/types.ts",
    "  isSoldRetention?: boolean;\n};",
    "  isSoldRetention?: boolean;\n  collxOnly?: boolean;\n};",
)
replace(
    "src/modules/inventory/engine.ts",
    'import { getStoreSettings } from "../../lib/store-settings";\n',
    'import { getStoreSettings } from "../../lib/store-settings";\nimport { isCollxOnlyInventory } from "../../lib/collx-inventory-boundary";\n',
)
replace(
    "src/modules/inventory/engine.ts",
    "      ebayItemId: product.ebay_item_id,\n      status: inventoryItem.status,",
    "      ebayItemId: product.ebay_item_id,\n      collxOnly: isCollxOnlyInventory({\n        ebayItemId: product.ebay_item_id,\n        metadata: inventoryItem.metadata,\n      }),\n      status: inventoryItem.status,",
)
replace(
    "src/modules/inventory/engine.ts",
    "    ebayItemId: product.ebay_item_id,\n    status: normalizeStatus(product.quantity),",
    "    ebayItemId: product.ebay_item_id,\n    collxOnly: false,\n    status: normalizeStatus(product.quantity),",
)
replace(
    "src/lib/server-inventory-engine.ts",
    "    isLaunchCollectible(item) &&\n    !isMergedEbayAliasItemId(item.ebayItemId)",
    "    isLaunchCollectible(item) &&\n    item.collxOnly !== true &&\n    !isMergedEbayAliasItemId(item.ebayItemId)",
)
replace(
    "src/modules/inventory/checkout-engine.ts",
    "    const blockedItem = items.find((item) => !isLaunchSportsCard(item));",
    "    const blockedItem = items.find(\n      (item) => !isLaunchSportsCard(item) || item.collxOnly === true,\n    );",
)
replace(
    "src/lib/collectible-sale-history.ts",
    'import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";\n',
    'import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";\nimport { isCollxOnlyInventory } from "./collx-inventory-boundary";\n',
)
replace(
    "src/lib/collectible-sale-history.ts",
    "        ebayItemId: product.ebay_item_id || null,\n        status: \"sold\" as const,",
    "        ebayItemId: product.ebay_item_id || null,\n        collxOnly: isCollxOnlyInventory({\n          ebayItemId: product.ebay_item_id || null,\n          metadata: inventory?.metadata || null,\n        }),\n        status: \"sold\" as const,",
)
replace(
    "src/lib/collectible-sale-history.ts",
    "    .filter((item) => isLaunchCollectible(item))\n    .filter((item) => !isMergedEbayAliasItemId(item.ebayItemId))",
    "    .filter((item) => isLaunchCollectible(item))\n    .filter((item) => item.collxOnly !== true)\n    .filter((item) => !isMergedEbayAliasItemId(item.ebayItemId))",
)
replace(
    "scripts/run-sold-lifecycle-simulations.mjs",
    'const saleHistory = read("src/lib/collectible-sale-history.ts");\n',
    'const saleHistory = read("src/lib/collectible-sale-history.ts");\nconst collxBoundary = read("src/lib/collx-inventory-boundary.ts");\nconst collxBoundaryMigration = read("supabase/migrations/20260730002800_enforce_collx_inventory_boundary.sql");\nconst inventoryEngine = read("src/modules/inventory/engine.ts");\nconst checkoutEngine = read("src/modules/inventory/checkout-engine.ts");\nconst publicInventoryEngine = read("src/lib/server-inventory-engine.ts");\n',
)
marker = "const cronByPath = new Map(\n"
assertions = '''assert.match(collxBoundary, /DIRECT_COLLX_CONNECTOR_VERIFIED = false/);
assert.match(collxBoundary, /tokens\.has\("collx"\)/);
assert.match(collxBoundary, /!tokens\.has\("ebay"\)/);
assert.match(collxBoundary, /if \(params\.ebayItemId\?\.trim\(\)\) return false/);
assert.match(collxBoundary, /COLLX_VIA_EBAY_MAX_SCHEDULED_PROTECTION_MINUTES/);
assert.match(collxBoundaryMigration, /create or replace view public\.collx_only_inventory_boundary_violations/);
assert.match(collxBoundaryMigration, /COLLX_ONLY_INVENTORY_BLOCKED/);
assert.match(collxBoundaryMigration, /before insert or update/);
assert.match(collxBoundaryMigration, /nullif\(btrim\(coalesce\(p\.ebay_item_id/);
assert.match(inventoryEngine, /collxOnly: isCollxOnlyInventory/);
assert.match(checkoutEngine, /item\.collxOnly === true/);
assert.match(publicInventoryEngine, /item\.collxOnly !== true/);
assert.match(saleHistory, /item\.collxOnly !== true/);
assert.equal(fs.existsSync("src/app/api/cron/collx-inventory-sync/route.ts"), false);
assert.equal(fs.existsSync("src/app/api/cron/collx-sales-sync/route.ts"), false);

'''
replace("scripts/run-sold-lifecycle-simulations.mjs", marker, assertions + marker)
replace(
    "scripts/run-sold-lifecycle-simulations.mjs",
    "      checks: 144,",
    "      checks: 159,",
)
PY

git diff --check
