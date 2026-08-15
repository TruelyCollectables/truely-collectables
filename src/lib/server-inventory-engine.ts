import type { SupabaseClient } from "@supabase/supabase-js";
import {
  InventoryEngine,
  InventoryRepository,
  type UniversalInventoryItem,
} from "../modules/inventory";
import { extractAuthenticityProfile } from "./authenticity";
import { deriveCardIdentity } from "./card-identity";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";
import { deriveStrictStorefrontFeatures } from "./storefront-feature-evidence";
import {
  classifyStorefrontItem,
  matchesStorefrontFilters,
  normalizeStorefrontFeature,
  sortStorefrontItems,
  sortStorefrontSections,
  type StorefrontSort,
} from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const PUBLIC_PRODUCT_PAGE_SIZE = 1000;
const PUBLIC_PRODUCT_MAX_PAGES = 20;
const PUBLIC_PRODUCT_PAGE_CONCURRENCY = 5;
const PUBLIC_CATALOG_CACHE_TTL_MS = 15_000;
const PUBLIC_CATALOG_CACHE_MAX_STORES = 16;
const PUBLIC_PRODUCT_COLUMNS =
  "id,seller_account_id,card_uuid,sku,title,description,price,quantity,image_url,ebay_item_id,player,sport,archived_at";

type PublicCatalogCacheEntry = {
  expiresAt: number;
  promise: Promise<UniversalInventoryItem[]>;
};

// Cloudflare reuses Worker isolates across nearby requests. Keep a very short
// best-effort cache of the already-classified public catalog so pagination,
// filters, and section navigation do not repeatedly pay the same Supabase read
// and classification cost. Correctness never depends on this cache: it expires
// quickly, checkout still validates live inventory, and failed loads evict
// themselves immediately.
const publicCatalogCache = new Map<string, PublicCatalogCacheEntry>();

function getCachedPublicCatalog(
  storeId: string,
  loader: () => Promise<UniversalInventoryItem[]>,
) {
  const now = Date.now();
  const cached = publicCatalogCache.get(storeId);
  if (cached && cached.expiresAt > now) return cached.promise;

  if (cached) publicCatalogCache.delete(storeId);

  const promise = loader();
  const entry: PublicCatalogCacheEntry = {
    expiresAt: now + PUBLIC_CATALOG_CACHE_TTL_MS,
    promise,
  };
  publicCatalogCache.set(storeId, entry);

  void promise.catch(() => {
    if (publicCatalogCache.get(storeId) === entry) {
      publicCatalogCache.delete(storeId);
    }
  });

  if (publicCatalogCache.size > PUBLIC_CATALOG_CACHE_MAX_STORES) {
    for (const [key, value] of publicCatalogCache) {
      if (value.expiresAt <= now || key !== storeId) {
        publicCatalogCache.delete(key);
        if (publicCatalogCache.size <= PUBLIC_CATALOG_CACHE_MAX_STORES) break;
      }
    }
  }

  return promise;
}

function validCardUuid(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

function mapPublicProductRow(product: any): UniversalInventoryItem {
  const title = String(product.title || "Untitled");
  const description = product.description ? String(product.description) : null;
  const classification = classifyStorefrontItem({
    title,
    description,
    rawSport: product.sport || null,
    primaryCategory: null,
    metadata: null,
  });

  return {
    inventoryItemId: null,
    legacyProductId: Number(product.id),
    cardUuid: validCardUuid(product.card_uuid),
    sellerAccountId: product.seller_account_id || null,
    sku: product.sku || null,
    title,
    description,
    player: product.player || null,
    sport: classification.section,
    category: null,
    storefrontSection: classification.section,
    league: classification.league,
    features: classification.features,
    price: safeNumber(product.price),
    quantity: safeNumber(product.quantity),
    imageUrl: product.image_url || null,
    ebayItemId: product.ebay_item_id || null,
    status: safeNumber(product.quantity) > 0 ? "active" : "sold",
    source: "products",
    authenticity: extractAuthenticityProfile(null),
  };
}

class PublicStorefrontInventoryEngine extends InventoryEngine {
  private publicProductsPromise: Promise<any[]> | null = null;
  private publicCatalogPromise: Promise<UniversalInventoryItem[]> | null = null;

  constructor(
    private readonly publicStoreId: string,
    repository: InventoryRepository,
    private readonly publicDatabase: SupabaseClient,
  ) {
    super(publicStoreId, repository, publicDatabase);
  }

  private async readPublicProductPage(page: number) {
    const from = page * PUBLIC_PRODUCT_PAGE_SIZE;
    const { data, error } = await this.publicDatabase
      .from("products")
      .select(PUBLIC_PRODUCT_COLUMNS)
      .eq("store_id", this.publicStoreId)
      .gt("price", 0)
      .gt("quantity", 0)
      .not("image_url", "is", null)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(from, from + PUBLIC_PRODUCT_PAGE_SIZE - 1);

    if (error) throw error;
    return data || [];
  }

  private readPublicProducts() {
    if (!this.publicProductsPromise) {
      this.publicProductsPromise = this.readPublicProductsUncached();
    }
    return this.publicProductsPromise;
  }

  private async readPublicProductsUncached() {
    const rows: any[] = [];
    const firstBatch = await this.readPublicProductPage(0);
    rows.push(...firstBatch);
    if (firstBatch.length < PUBLIC_PRODUCT_PAGE_SIZE) return rows;

    // Fetch the remaining pages in small parallel waves. This preserves the
    // exact page ordering and 20,000-row safety ceiling while avoiding a long
    // chain of sequential Supabase round trips on Cloudflare.
    for (
      let startPage = 1;
      startPage < PUBLIC_PRODUCT_MAX_PAGES;
      startPage += PUBLIC_PRODUCT_PAGE_CONCURRENCY
    ) {
      const pageNumbers = Array.from(
        {
          length: Math.min(
            PUBLIC_PRODUCT_PAGE_CONCURRENCY,
            PUBLIC_PRODUCT_MAX_PAGES - startPage,
          ),
        },
        (_, index) => startPage + index,
      );
      const batches = await Promise.all(
        pageNumbers.map((page) => this.readPublicProductPage(page)),
      );

      for (const batch of batches) {
        rows.push(...batch);
        if (batch.length < PUBLIC_PRODUCT_PAGE_SIZE) return rows;
      }
    }

    throw new Error(
      `Public product pagination exceeded ${PUBLIC_PRODUCT_MAX_PAGES * PUBLIC_PRODUCT_PAGE_SIZE} rows.`,
    );
  }

  private readPublicCatalog() {
    if (!this.publicCatalogPromise) {
      this.publicCatalogPromise = getCachedPublicCatalog(
        this.publicStoreId,
        async () => {
          const products = await this.readPublicProducts();
          return products
            .map(mapPublicProductRow)
            .map(enforceStrictStorefrontFeatures)
            .filter(
              (item) =>
                Boolean(item.imageUrl) &&
                item.quantity > 0 &&
                item.price > 0 &&
                item.status === "active",
            )
            .filter(isPublicStorefrontItem);
        },
      );
    }

    return this.publicCatalogPromise;
  }

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
    const section = params.section || params.sport;
    const catalog = await this.readPublicCatalog();

    const items = catalog
      .filter((item) =>
        matchesStorefrontFilters(item, {
          query: params.query,
          section,
          feature: undefined,
          category: params.category,
        }),
      )
      .filter((item) => !requestedFeature || item.features[requestedFeature]);

    return sortStorefrontItems(items, params.sort || "section");
  }

  async listAvailableSections(): Promise<string[]> {
    const catalog = await this.readPublicCatalog();
    return sortStorefrontSections(
      catalog.map((item) => item.storefrontSection),
    );
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
    // The public product row and its inventory-item identity are independent
    // lookups once the legacy id is known. Run them together so a slow
    // PostgREST round trip cannot make the product route pay the latency twice.
    const productRequest = this.publicDatabase
      .from("products")
      .select(PUBLIC_PRODUCT_COLUMNS)
      .eq("store_id", this.publicStoreId)
      .eq("id", legacyProductId)
      .gt("price", 0)
      .gt("quantity", 0)
      .not("image_url", "is", null)
      .is("archived_at", null)
      .maybeSingle();

    const inventoryRequest = this.publicDatabase
      .from("inventory_items")
      .select("id,sku")
      .eq("store_id", this.publicStoreId)
      .eq("legacy_product_id", legacyProductId)
      .order("created_at", { ascending: true })
      .limit(100);

    const [productResult, inventoryResult] = await Promise.all([
      productRequest,
      inventoryRequest,
    ]);

    const { data, error } = productResult;
    if (error) throw error;
    if (!data) return null;

    if (inventoryResult.error) throw inventoryResult.error;

    const productSku = String(data.sku || "").trim();
    const inventoryRows = inventoryResult.data || [];
    const inventoryMatch = productSku
      ? inventoryRows.find((row: any) => String(row.sku || "") === productSku)
      : inventoryRows[0];
    const inventoryItemId = inventoryMatch?.id
      ? String(inventoryMatch.id)
      : null;

    const item = {
      ...enforceStrictStorefrontFeatures(mapPublicProductRow(data)),
      inventoryItemId,
    };

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
