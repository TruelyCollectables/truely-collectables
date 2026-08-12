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
  type StorefrontSort,
} from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

const PUBLIC_PRODUCT_PAGE_SIZE = 1000;
const PUBLIC_PRODUCT_MAX_PAGES = 20;
const PUBLIC_PRODUCT_COLUMNS =
  "id,seller_account_id,card_uuid,sku,title,description,price,quantity,image_url,ebay_item_id,player,sport,archived_at";

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
  constructor(
    private readonly publicStoreId: string,
    repository: InventoryRepository,
    private readonly publicDatabase: SupabaseClient,
  ) {
    super(publicStoreId, repository, publicDatabase);
  }

  private async readPublicProducts() {
    const rows: any[] = [];

    for (let page = 0; page < PUBLIC_PRODUCT_MAX_PAGES; page += 1) {
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
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < PUBLIC_PRODUCT_PAGE_SIZE) return rows;
    }

    throw new Error(
      `Public product pagination exceeded ${PUBLIC_PRODUCT_MAX_PAGES * PUBLIC_PRODUCT_PAGE_SIZE} rows.`,
    );
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
    const products = await this.readPublicProducts();

    const items = products
      .map(mapPublicProductRow)
      .map(enforceStrictStorefrontFeatures)
      .filter(
        (item) =>
          Boolean(item.imageUrl) &&
          item.quantity > 0 &&
          item.price > 0 &&
          item.status === "active",
      )
      .filter(isPublicStorefrontItem)
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

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(
        items.map((item) => item.sport?.trim()).filter(Boolean) as string[],
      ),
    ).sort();
  }

  async getByLegacyProductId(legacyProductId: number) {
    const { data, error } = await this.publicDatabase
      .from("products")
      .select(PUBLIC_PRODUCT_COLUMNS)
      .eq("store_id", this.publicStoreId)
      .eq("id", legacyProductId)
      .gt("price", 0)
      .gt("quantity", 0)
      .not("image_url", "is", null)
      .is("archived_at", null)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const item = enforceStrictStorefrontFeatures(mapPublicProductRow(data));
    return isPublicStorefrontItem(item) ? item : null;
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
