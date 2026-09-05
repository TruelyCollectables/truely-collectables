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
import { listingPromotionFromMetadata } from "./listing-promotions";
import { sanitizePublicListingDescription, sanitizePublicListingTitle } from "./public-listing-copy";
import {
  loadLiveStoreSales,
  resolveStoreSale,
  type StoreSaleCampaign,
} from "./store-sales";

const PUBLIC_PRODUCT_PAGE_SIZE = 1000;
const PUBLIC_PRODUCT_MAX_PAGES = 20;
// The storefront used to fan out five 1,000-row PostgREST reads at once on a
// cold catalog load. Keep this serial so a public page can never create a burst
// large enough to compete with checkout or other commerce traffic.
const PUBLIC_PRODUCT_PAGE_CONCURRENCY = 1;
const PUBLIC_PRODUCT_QUERY_TIMEOUT_MS = 3_000;
const PUBLIC_CATALOG_MEMORY_TTL_MS = 30_000;
const PUBLIC_CATALOG_EDGE_FRESH_TTL_MS = 5 * 60_000;
const PUBLIC_CATALOG_EDGE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const PUBLIC_CATALOG_CACHE_MAX_STORES = 16;
// v4 keeps physical-stock deduplication and invalidates older snapshots that
// may contain internal import/debug copy. Public listing copy is sanitized before
// it can reach customer pages or the Google Merchant feed.
const PUBLIC_CATALOG_EDGE_CACHE_VERSION = "v4";
const PUBLIC_PRODUCT_COLUMNS =
  "id,seller_account_id,card_uuid,sku,title,description,price,quantity,image_url,ebay_item_id,player,sport,archived_at";

type PublicCatalogCacheEntry = {
  expiresAt: number;
  promise: Promise<UniversalInventoryItem[]>;
};

type PublicCatalogEdgeSnapshot = {
  generatedAt: number;
  items: UniversalInventoryItem[];
};

type WorkerCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

// Cloudflare reuses Worker isolates across nearby requests. Keep a short
// in-memory cache so one isolate cannot repeatedly refresh the same catalog.
const publicCatalogCache = new Map<string, PublicCatalogCacheEntry>();

function getWorkerDefaultCache(): WorkerCache | null {
  try {
    const cacheStorage = (globalThis as any).caches as
      | { default?: WorkerCache }
      | undefined;
    return cacheStorage?.default || null;
  } catch {
    return null;
  }
}

function publicCatalogEdgeCacheRequest(storeId: string) {
  return new Request(
    `https://truelycollectables.com/__internal-cache/public-catalog/${encodeURIComponent(storeId)}?version=${PUBLIC_CATALOG_EDGE_CACHE_VERSION}`,
    { method: "GET" },
  );
}

async function readPublicCatalogFromEdgeCache(
  storeId: string,
): Promise<PublicCatalogEdgeSnapshot | null> {
  const cache = getWorkerDefaultCache();
  if (!cache) return null;

  try {
    const response = await cache.match(publicCatalogEdgeCacheRequest(storeId));
    if (!response) return null;
    const payload = (await response.json()) as
      | PublicCatalogEdgeSnapshot
      | UniversalInventoryItem[];

    // Backward compatibility with the original short-lived cache payload.
    if (Array.isArray(payload)) {
      return { generatedAt: Date.now(), items: payload };
    }

    if (
      payload &&
      Number.isFinite(Number(payload.generatedAt)) &&
      Array.isArray(payload.items)
    ) {
      return {
        generatedAt: Number(payload.generatedAt),
        items: payload.items,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function writePublicCatalogToEdgeCache(
  storeId: string,
  items: UniversalInventoryItem[],
) {
  const cache = getWorkerDefaultCache();
  if (!cache) return;

  try {
    const snapshot: PublicCatalogEdgeSnapshot = {
      generatedAt: Date.now(),
      items,
    };

    await cache.put(
      publicCatalogEdgeCacheRequest(storeId),
      new Response(JSON.stringify(snapshot), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          // Keep a last-known-good catalog for a full week. The timestamp in the
          // payload controls normal refresh cadence; this retention is solely the
          // outage fallback and does not make checkout trust stale quantity.
          "cache-control": `public, s-maxage=${PUBLIC_CATALOG_EDGE_RETENTION_SECONDS}`,
        },
      }),
    );
  } catch {
    // Cache API is a resilience optimization only. Never make storefront
    // availability depend on an edge-cache write succeeding.
  }
}

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
    expiresAt: now + PUBLIC_CATALOG_MEMORY_TTL_MS,
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

function dedupeSharedPhysicalInventory(items: UniversalInventoryItem[]) {
  const ungrouped: UniversalInventoryItem[] = [];
  const byCardUuid = new Map<string, UniversalInventoryItem>();

  for (const item of items) {
    const cardUuid = validCardUuid(item.cardUuid);
    if (!cardUuid) {
      ungrouped.push(item);
      continue;
    }

    const existing = byCardUuid.get(cardUuid);
    if (!existing) {
      byCardUuid.set(cardUuid, item);
      continue;
    }

    // A linked card is one physical stock pool even when it has multiple source
    // representations. Prefer the eBay-linked row because it normally carries
    // the current listing photos/metadata; otherwise keep the lower product id
    // so the chosen storefront URL is deterministic.
    const itemHasEbay = Boolean(item.ebayItemId);
    const existingHasEbay = Boolean(existing.ebayItemId);
    if (
      (itemHasEbay && !existingHasEbay) ||
      (itemHasEbay === existingHasEbay &&
        item.legacyProductId < existing.legacyProductId)
    ) {
      byCardUuid.set(cardUuid, item);
    }
  }

  return [...ungrouped, ...byCardUuid.values()];
}

function applyDynamicStoreSale(
  item: UniversalInventoryItem,
  campaigns: StoreSaleCampaign[],
): UniversalInventoryItem {
  const listingOriginalPrice =
    item.promotion?.onSale && item.promotion.originalPrice
      ? Number(item.promotion.originalPrice)
      : Number(item.price);
  const listingDiscountPercent = item.promotion?.onSale
    ? Number(item.promotion.discountPercent || 0)
    : 0;
  const resolved = resolveStoreSale({
    campaigns,
    candidate: {
      productId: item.legacyProductId,
      title: item.title,
      player: item.player,
      section: item.storefrontSection,
      price: listingOriginalPrice,
    },
  });

  if (!resolved.campaign || resolved.discountPercent <= listingDiscountPercent) {
    return item;
  }

  return {
    ...item,
    price: resolved.price,
    promotion: {
      onSale: true,
      originalPrice: resolved.originalPrice,
      discountPercent: resolved.discountPercent,
    },
  };
}

function mapPublicProductRow(
  product: any,
  promotionMetadata?: Record<string, unknown> | null,
): UniversalInventoryItem {
  const title = sanitizePublicListingTitle(product.title);
  const description = sanitizePublicListingDescription(product.description);
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
    promotion: (() => {
      const promotion = listingPromotionFromMetadata(promotionMetadata);
      return {
        onSale: promotion.onSale,
        originalPrice: promotion.originalPrice,
        discountPercent: promotion.discountPercent,
      };
    })(),
  };
}

class PublicStorefrontInventoryEngine extends InventoryEngine {
  private publicProductsPromise: Promise<any[]> | null = null;
  private publicCatalogPromise: Promise<UniversalInventoryItem[]> | null = null;
  private publicSalesPromise: Promise<StoreSaleCampaign[]> | null = null;

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
      .range(from, from + PUBLIC_PRODUCT_PAGE_SIZE - 1)
      .abortSignal(AbortSignal.timeout(PUBLIC_PRODUCT_QUERY_TIMEOUT_MS));

    if (error) throw error;
    return data || [];
  }

  private readPublicProducts() {
    if (!this.publicProductsPromise) {
      this.publicProductsPromise = this.readPublicProductsUncached();
    }
    return this.publicProductsPromise;
  }

  private async readPublicPromotionMetadata(productIds: number[]) {
    const metadataByProductId = new Map<number, Record<string, unknown>>();
    for (let index = 0; index < productIds.length; index += 500) {
      const batch = productIds.slice(index, index + 500);
      if (!batch.length) continue;
      const { data, error } = await this.publicDatabase
        .from("inventory_items")
        .select("legacy_product_id,metadata")
        .eq("store_id", this.publicStoreId)
        .in("legacy_product_id", batch)
        .range(0, 4999)
        .abortSignal(AbortSignal.timeout(PUBLIC_PRODUCT_QUERY_TIMEOUT_MS));
      if (error) throw error;
      for (const row of data || []) {
        const id = Number(row.legacy_product_id);
        if (!Number.isInteger(id) || id <= 0) continue;
        metadataByProductId.set(
          id,
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : {},
        );
      }
    }
    return metadataByProductId;
  }

  private async readPublicProductsUncached() {
    const rows: any[] = [];
    const firstBatch = await this.readPublicProductPage(0);
    rows.push(...firstBatch);
    if (firstBatch.length < PUBLIC_PRODUCT_PAGE_SIZE) return rows;

    // Deliberately keep the refresh serial. A cold storefront cache is never
    // allowed to fan out enough reads to starve commerce traffic again.
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

  private readLiveSales() {
    if (!this.publicSalesPromise) {
      this.publicSalesPromise = loadLiveStoreSales({
        supabase: this.publicDatabase,
        storeId: this.publicStoreId,
      });
    }
    return this.publicSalesPromise;
  }

  private readPublicCatalog() {
    if (!this.publicCatalogPromise) {
      this.publicCatalogPromise = getCachedPublicCatalog(
        this.publicStoreId,
        async () => {
          const edgeSnapshot = await readPublicCatalogFromEdgeCache(
            this.publicStoreId,
          );
          const edgeAge = edgeSnapshot
            ? Math.max(0, Date.now() - edgeSnapshot.generatedAt)
            : Number.POSITIVE_INFINITY;

          if (
            edgeSnapshot &&
            edgeAge <= PUBLIC_CATALOG_EDGE_FRESH_TTL_MS
          ) {
            return edgeSnapshot.items;
          }

          try {
            const products = await this.readPublicProducts();
            const promotionMetadata = await this.readPublicPromotionMetadata(
              products.map((product) => Number(product.id)),
            );
            const catalog = dedupeSharedPhysicalInventory(
              products
                .map((product) =>
                  mapPublicProductRow(
                    product,
                    promotionMetadata.get(Number(product.id)) || null,
                  ),
                )
                .map(enforceStrictStorefrontFeatures)
                .filter(
                  (item) =>
                    Boolean(item.imageUrl) &&
                    item.quantity > 0 &&
                    item.price > 0 &&
                    item.status === "active",
                )
                .filter(isPublicStorefrontItem),
            );

            await writePublicCatalogToEdgeCache(this.publicStoreId, catalog);
            return catalog;
          } catch (error) {
            if (edgeSnapshot?.items.length) {
              console.warn(
                "Public catalog refresh failed; serving last-known-good edge snapshot.",
                error,
              );
              return edgeSnapshot.items;
            }
            throw error;
          }
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
    const [catalog, campaigns] = await Promise.all([
      this.readPublicCatalog(),
      this.readLiveSales(),
    ]);

    const items = catalog
      .map((item) => applyDynamicStoreSale(item, campaigns))
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
    // Product pages use the same resilient public snapshot as /shop. Checkout
    // remains authoritative and validates live inventory before money moves.
    const [catalog, campaigns] = await Promise.all([
      this.readPublicCatalog(),
      this.readLiveSales(),
    ]);
    const item =
      catalog
        .map((candidate) => applyDynamicStoreSale(candidate, campaigns))
        .find((candidate) => candidate.legacyProductId === legacyProductId) ||
      null;
    return item && isPublicStorefrontItem(item) ? item : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const requested = new Set(legacyProductIds);
    const [catalog, campaigns] = await Promise.all([
      this.readPublicCatalog(),
      this.readLiveSales(),
    ]);
    const items = catalog
      .map((item) => applyDynamicStoreSale(item, campaigns))
      .filter((item) => requested.has(item.legacyProductId));
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
