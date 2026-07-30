import {
  InventoryEngine,
  InventoryRepository,
  type UniversalInventoryItem,
} from "../modules/inventory";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";
import { deriveStrictStorefrontFeatures } from "./storefront-feature-evidence";
import {
  normalizeStorefrontFeature,
  type StorefrontSort,
} from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const DATABASE_PAGE_SIZE = 1000;
const MAX_DATABASE_PAGES = 50;
const COLLX_METADATA_KEYS = [
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

function metadataMentionsCollx(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  const focused = COLLX_METADATA_KEYS.map((key) => metadata[key])
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry) =>
      typeof entry === "string" ? entry : JSON.stringify(entry),
    )
    .join(" ")
    .toLowerCase();
  return /(^|[^a-z0-9])collx([^a-z0-9]|$)/.test(focused);
}

async function readAllStoreRows(params: {
  table: "products" | "inventory_items";
  columns: string;
  storeId: string;
}) {
  const supabase = createSupabaseServerClient({ admin: true });
  const rows: any[] = [];

  for (let page = 0; page < MAX_DATABASE_PAGES; page += 1) {
    const from = page * DATABASE_PAGE_SIZE;
    const { data, error } = await supabase
      .from(params.table)
      .select(params.columns)
      .eq("store_id", params.storeId)
      .order("id", { ascending: true })
      .range(from, from + DATABASE_PAGE_SIZE - 1);

    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < DATABASE_PAGE_SIZE) return rows;
  }

  throw new Error(
    `${params.table} boundary pagination exceeded ${MAX_DATABASE_PAGES * DATABASE_PAGE_SIZE} rows.`,
  );
}

async function collxOnlyLegacyProductIds() {
  const storeId = getActiveStoreId();
  const [products, inventoryItems] = await Promise.all([
    readAllStoreRows({
      table: "products",
      columns: "id,sku,ebay_item_id",
      storeId,
    }),
    readAllStoreRows({
      table: "inventory_items",
      columns: "id,legacy_product_id,sku,metadata",
      storeId,
    }),
  ]);

  const productById = new Map(
    products.map((product) => [Number(product.id), product]),
  );
  const productBySku = new Map(
    products
      .filter((product) => String(product.sku || "").trim())
      .map((product) => [String(product.sku).trim(), product]),
  );
  const blocked = new Set<number>();

  for (const inventory of inventoryItems) {
    if (!metadataMentionsCollx(inventory.metadata)) continue;

    const rawLegacyProductId = inventory.legacy_product_id;
    const legacyProductId =
      rawLegacyProductId === null ||
      rawLegacyProductId === undefined ||
      rawLegacyProductId === ""
        ? null
        : Number(rawLegacyProductId);
    const inventorySku = String(inventory.sku || "").trim();
    const linkedProduct =
      legacyProductId !== null && Number.isFinite(legacyProductId)
        ? productById.get(legacyProductId)
        : inventorySku
          ? productBySku.get(inventorySku)
          : undefined;
    const linkedEbayItemId = String(linkedProduct?.ebay_item_id || "").trim();
    if (linkedEbayItemId) continue;

    const blockedId = Number(linkedProduct?.id ?? legacyProductId);
    if (Number.isFinite(blockedId) && blockedId > 0) blocked.add(blockedId);
  }

  return blocked;
}

function enforceStrictStorefrontFeatures(item: UniversalInventoryItem) {
  return {
    ...item,
    features: deriveStrictStorefrontFeatures({
      title: item.title,
      section: item.storefrontSection || item.sport,
    }),
  };
}

function isPublicStorefrontItem(item: UniversalInventoryItem) {
  return (
    isLaunchCollectible(item) && !isMergedEbayAliasItemId(item.ebayItemId)
  );
}

class PublicStorefrontInventoryEngine extends InventoryEngine {
  async listAvailable(
    params: {
      query?: string;
      sport?: string;
      section?: string;
      feature?: string;
      category?: string;
      sort?: StorefrontSort;
    } = {},
  ) {
    const requestedFeature = normalizeStorefrontFeature(params.feature);
    const baseParams = requestedFeature ? { ...params, feature: undefined } : params;
    const [items, collxOnlyProductIds] = await Promise.all([
      super.listAvailable(baseParams),
      collxOnlyLegacyProductIds(),
    ]);

    return items
      .map(enforceStrictStorefrontFeatures)
      .filter(isPublicStorefrontItem)
      .filter((item) => !collxOnlyProductIds.has(item.legacyProductId))
      .filter((item) => !requestedFeature || item.features[requestedFeature]);
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(
        items.map((item) => item.sport?.trim()).filter(Boolean) as string[],
      ),
    ).sort();
  }

  async getByLegacyProductId(legacyProductId: number) {
    const [item, collxOnlyProductIds] = await Promise.all([
      super.getByLegacyProductId(legacyProductId),
      collxOnlyLegacyProductIds(),
    ]);
    if (item && collxOnlyProductIds.has(item.legacyProductId)) return null;
    return item && isPublicStorefrontItem(item)
      ? enforceStrictStorefrontFeatures(item)
      : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const [rawItems, collxOnlyProductIds] = await Promise.all([
      super.getByLegacyProductIds(legacyProductIds),
      collxOnlyLegacyProductIds(),
    ]);
    return rawItems
      .filter((item) => !collxOnlyProductIds.has(item.legacyProductId))
      .filter(isPublicStorefrontItem)
      .map(enforceStrictStorefrontFeatures);
  }
}

export function createServerInventoryEngine() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });

  return new PublicStorefrontInventoryEngine(
    storeId,
    new InventoryRepository(storeId, supabase),
    supabase,
  );
}
