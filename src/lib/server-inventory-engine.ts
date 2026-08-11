import {
  InventoryEngine,
  InventoryRepository,
  type UniversalInventoryItem,
} from "../modules/inventory";
import { deriveCardIdentity } from "./card-identity";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";
import { deriveStrictStorefrontFeatures } from "./storefront-feature-evidence";
import {
  matchesStorefrontFilters,
  normalizeStorefrontFeature,
  sortStorefrontItems,
  type StorefrontSort,
} from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const STOREFRONT_INVENTORY_PAGE_SIZE = 1000;
const STOREFRONT_LOOKUP_CHUNK_SIZE = 500;
const STOREFRONT_LOOKUP_CONCURRENCY = 4;
const MAX_STOREFRONT_INVENTORY_PAGES = 50;

function enforceStrictStorefrontFeatures(item: UniversalInventoryItem) {
  const identity = deriveCardIdentity({
    title: item.title,
    aspectPlayer: item.player,
  });

  return {
    ...item,
    player: identity.player,
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

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }
  return chunks;
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
    const storeId = getActiveStoreId();
    const database = createSupabaseServerClient({ admin: true });
    const legacyProductIds = new Set<number>();
    const skuOnlyLinks = new Set<string>();

    for (let page = 0; page < MAX_STOREFRONT_INVENTORY_PAGES; page += 1) {
      const from = page * STOREFRONT_INVENTORY_PAGE_SIZE;
      const { data, error } = await database
        .from("inventory_items")
        .select("legacy_product_id,sku")
        .eq("store_id", storeId)
        .eq("status", "active")
        .gt("quantity", 0)
        .order("id", { ascending: true })
        .range(from, from + STOREFRONT_INVENTORY_PAGE_SIZE - 1);

      if (error) throw error;

      const batch = data || [];
      for (const row of batch) {
        const legacyProductId = Number(row.legacy_product_id);
        if (Number.isInteger(legacyProductId) && legacyProductId > 0) {
          legacyProductIds.add(legacyProductId);
        } else if (typeof row.sku === "string" && row.sku.trim()) {
          skuOnlyLinks.add(row.sku.trim());
        }
      }

      if (batch.length < STOREFRONT_INVENTORY_PAGE_SIZE) break;

      if (page === MAX_STOREFRONT_INVENTORY_PAGES - 1) {
        throw new Error(
          `Active storefront inventory exceeded ${MAX_STOREFRONT_INVENTORY_PAGES * STOREFRONT_INVENTORY_PAGE_SIZE} rows.`,
        );
      }
    }

    if (skuOnlyLinks.size > 0) {
      for (const skuChunk of chunkValues(
        Array.from(skuOnlyLinks),
        STOREFRONT_LOOKUP_CHUNK_SIZE,
      )) {
        const { data, error } = await database
          .from("products")
          .select("id")
          .eq("store_id", storeId)
          .in("sku", skuChunk);

        if (error) throw error;

        for (const row of data || []) {
          const id = Number(row.id);
          if (Number.isInteger(id) && id > 0) legacyProductIds.add(id);
        }
      }
    }

    const idChunks = chunkValues(
      Array.from(legacyProductIds),
      STOREFRONT_LOOKUP_CHUNK_SIZE,
    );
    const items: UniversalInventoryItem[] = [];

    for (
      let offset = 0;
      offset < idChunks.length;
      offset += STOREFRONT_LOOKUP_CONCURRENCY
    ) {
      const lookupBatch = idChunks.slice(
        offset,
        offset + STOREFRONT_LOOKUP_CONCURRENCY,
      );
      const results = await Promise.all(
        lookupBatch.map((ids) => super.getByLegacyProductIds(ids)),
      );
      items.push(...results.flat());
    }

    const requestedFeature = normalizeStorefrontFeature(params.feature);
    const section = params.section || params.sport;
    const available = items
      .map(enforceStrictStorefrontFeatures)
      .filter(isPublicStorefrontItem)
      .filter(
        (item) =>
          Boolean(item.imageUrl) &&
          item.price > 0 &&
          item.quantity > 0 &&
          item.status === "active",
      )
      .filter((item) =>
        matchesStorefrontFilters(item, {
          query: params.query,
          section,
          feature: undefined,
          category: params.category,
        }),
      )
      .filter((item) => !requestedFeature || item.features[requestedFeature]);

    return sortStorefrontItems(available, params.sort || "section");
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
    let item = await super.getByLegacyProductId(legacyProductId);
    if (item) item = enforceStrictStorefrontFeatures(item);
    return item && isPublicStorefrontItem(item) ? item : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const items = (await super.getByLegacyProductIds(legacyProductIds)).map(
      enforceStrictStorefrontFeatures,
    );
    return items.filter(isPublicStorefrontItem);
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
