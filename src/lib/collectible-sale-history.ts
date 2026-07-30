import type { SupabaseClient } from "@supabase/supabase-js";
import { extractAuthenticityProfile } from "./authenticity";
import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import { deriveStrictStorefrontFeatures } from "./storefront-feature-evidence";
import {
  classifyStorefrontItem,
  matchesStorefrontFilters,
  normalizeStorefrontFeature,
  sortStorefrontItems,
  type StorefrontSort,
} from "./storefront-taxonomy";
import type { UniversalInventoryItem } from "../modules/inventory";

export const SOLD_STOREFRONT_RETENTION_DAYS = 7;

export type SaleEvidenceStatus = "verified" | "manual" | "unresolved";

export type CollectibleSaleRecord = {
  id: string;
  storeId: string;
  assetId: string;
  legacyProductId: number;
  inventoryItemId: string | null;
  sku: string | null;
  ebayItemId: string | null;
  eventKey: string;
  sourceMarketplace: string;
  sourceReference: string | null;
  soldQuantity: number;
  soldPrice: number | null;
  currency: string;
  soldAt: string;
  evidenceStatus: SaleEvidenceStatus;
  evidence: Record<string, unknown>;
};

export type AdminSaleHistory = {
  sales: CollectibleSaleRecord[];
  unresolved: Array<{
    legacyProductId: number;
    title: string;
    sku: string | null;
    ebayItemId: string | null;
    listingPrice: number;
    soldAt: string | null;
    soldSource: string | null;
    soldReference: string | null;
  }>;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeEvidenceStatus(value: unknown): SaleEvidenceStatus {
  return value === "verified" || value === "manual" ? value : "unresolved";
}

export async function recordCollectibleSale(params: {
  supabase: SupabaseClient;
  storeId: string;
  legacyProductId: number;
  eventKey: string;
  sourceMarketplace: string;
  sourceReference?: string | null;
  soldQuantity?: number;
  soldPrice?: number | null;
  currency?: string;
  soldAt?: string;
  evidenceStatus?: SaleEvidenceStatus;
  evidence?: Record<string, unknown>;
  forceZero?: boolean;
}) {
  const { data, error } = await params.supabase.rpc("record_collectible_sale", {
    p_store_id: params.storeId,
    p_legacy_product_id: params.legacyProductId,
    p_event_key: params.eventKey,
    p_source_marketplace: params.sourceMarketplace,
    p_source_reference: params.sourceReference ?? null,
    p_sold_quantity: Math.max(1, Math.floor(params.soldQuantity ?? 1)),
    p_sold_price: params.soldPrice ?? null,
    p_currency: params.currency || "USD",
    p_sold_at: params.soldAt || new Date().toISOString(),
    p_evidence_status: params.evidenceStatus || "unresolved",
    p_evidence: params.evidence || {},
    p_force_zero: Boolean(params.forceZero),
  });

  if (error) throw error;
  return String(data || "");
}

export async function archiveExpiredCollectibleSales(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const { data, error } = await params.supabase.rpc(
    "archive_expired_collectible_sales",
    { p_store_id: params.storeId },
  );
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    archivedProducts: safeNumber(row?.archived_products),
    archivedInventoryItems: safeNumber(row?.archived_inventory_items),
    archivedAssets: safeNumber(row?.archived_assets),
  };
}

export async function listRecentSoldStorefrontItems(params: {
  supabase: SupabaseClient;
  storeId: string;
  query?: string;
  section?: string;
  feature?: string;
  category?: string;
  sort?: StorefrontSort;
}): Promise<UniversalInventoryItem[]> {
  const cutoff = new Date(
    Date.now() - SOLD_STOREFRONT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: collxOnlyRows, error: collxOnlyError } = await params.supabase
    .from("collx_only_inventory_boundary_violations")
    .select("legacy_product_id")
    .eq("store_id", params.storeId);
  if (collxOnlyError) throw collxOnlyError;
  const collxOnlyProductIds = new Set(
    (collxOnlyRows || []).map((row: any) => Number(row.legacy_product_id)),
  );

  const { data: products, error: productError } = await params.supabase
    .from("products")
    .select(
      "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,player,sport,sold_at,sold_price,sold_source,sold_reference,sold_price_status,archive_after,archived_at",
    )
    .eq("store_id", params.storeId)
    .lte("quantity", 0)
    .not("sold_at", "is", null)
    .gte("sold_at", cutoff)
    .is("archived_at", null)
    .order("sold_at", { ascending: false })
    .limit(500);

  if (productError) throw productError;
  if (!products?.length) return [];

  const productIds = products.map((product: any) => Number(product.id));
  const { data: inventoryRows, error: inventoryError } = await params.supabase
    .from("inventory_items")
    .select(
      "id,legacy_product_id,sku,category,status,quantity,price,metadata,sold_at,sold_price,sold_source,sold_reference,sold_price_status,archive_after,archived_at",
    )
    .eq("store_id", params.storeId)
    .in("legacy_product_id", productIds);

  if (inventoryError) throw inventoryError;

  const inventoryByProduct = new Map<number, any>();
  for (const row of inventoryRows || []) {
    if (row.legacy_product_id) {
      inventoryByProduct.set(Number(row.legacy_product_id), row);
    }
  }

  const requestedFeature = normalizeStorefrontFeature(params.feature);
  const soldItems = products
    .map((product: any) => {
      const inventory = inventoryByProduct.get(Number(product.id)) || null;
      const title = String(product.title || "Untitled");
      const classification = classifyStorefrontItem({
        title,
        description: product.description || null,
        rawSport: product.sport || null,
        primaryCategory: inventory?.category || null,
        metadata: inventory?.metadata || null,
      });
      const soldAt = String(inventory?.sold_at || product.sold_at || "");
      const soldPrice = nullableMoney(inventory?.sold_price ?? product.sold_price);
      const soldPriceStatus = normalizeEvidenceStatus(
        inventory?.sold_price_status || product.sold_price_status,
      );

      return {
        inventoryItemId: inventory?.id || null,
        legacyProductId: Number(product.id),
        sellerAccountId: product.seller_account_id || null,
        sku: product.sku || inventory?.sku || null,
        title,
        description: product.description || null,
        player: product.player || null,
        sport: classification.section,
        category: inventory?.category || null,
        storefrontSection: classification.section,
        league: classification.league,
        features: deriveStrictStorefrontFeatures({
          title,
          section: classification.section,
        }),
        price: soldPrice ?? safeNumber(product.price),
        quantity: 0,
        imageUrl: product.image_url || null,
        ebayItemId: product.ebay_item_id || null,
        status: "sold" as const,
        source: inventory ? ("inventory_items" as const) : ("products" as const),
        authenticity: extractAuthenticityProfile(inventory?.metadata),
        soldAt,
        soldPrice,
        soldSource: inventory?.sold_source || product.sold_source || null,
        soldReference:
          inventory?.sold_reference || product.sold_reference || null,
        soldPriceStatus,
        archiveAfter:
          inventory?.archive_after || product.archive_after || null,
        archivedAt: inventory?.archived_at || product.archived_at || null,
        isSoldRetention: true,
      } satisfies UniversalInventoryItem;
    })
    .filter((item) => item.imageUrl && item.soldAt)
    .filter((item) => isLaunchCollectible(item))
    .filter((item) => !collxOnlyProductIds.has(item.legacyProductId))
    .filter((item) => !isMergedEbayAliasItemId(item.ebayItemId))
    .filter((item) =>
      matchesStorefrontFilters(item, {
        query: params.query,
        section: params.section,
        feature: undefined,
        category: params.category,
      }),
    )
    .filter((item) => !requestedFeature || item.features[requestedFeature]);

  if (
    params.sort === "price_low" ||
    params.sort === "price_high" ||
    params.sort === "title"
  ) {
    return sortStorefrontItems(soldItems, params.sort);
  }

  return soldItems.sort(
    (left, right) =>
      new Date(right.soldAt || 0).getTime() -
      new Date(left.soldAt || 0).getTime(),
  );
}

export async function getProductSalePresentation(params: {
  supabase: SupabaseClient;
  storeId: string;
  legacyProductId: number;
}) {
  const { data: collxBoundary, error: collxBoundaryError } = await params.supabase
    .from("collx_only_inventory_boundary_violations")
    .select("legacy_product_id")
    .eq("store_id", params.storeId)
    .eq("legacy_product_id", params.legacyProductId)
    .maybeSingle();
  if (collxBoundaryError) throw collxBoundaryError;
  if (collxBoundary) return null;

  const { data, error } = await params.supabase
    .from("products")
    .select(
      "sold_at,sold_price,sold_source,sold_reference,sold_price_status,archive_after,archived_at",
    )
    .eq("store_id", params.storeId)
    .eq("id", params.legacyProductId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.sold_at || data.archived_at) return null;

  const archiveAt = data.archive_after
    ? new Date(data.archive_after).getTime()
    : new Date(data.sold_at).getTime() +
      SOLD_STOREFRONT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(archiveAt) || archiveAt <= Date.now()) return null;

  return {
    soldAt: String(data.sold_at),
    soldPrice: nullableMoney(data.sold_price),
    soldSource: data.sold_source ? String(data.sold_source) : null,
    soldReference: data.sold_reference ? String(data.sold_reference) : null,
    soldPriceStatus: normalizeEvidenceStatus(data.sold_price_status),
    archiveAfter: data.archive_after ? String(data.archive_after) : null,
  };
}

export async function listAdminSaleHistory(params: {
  supabase: SupabaseClient;
  storeId: string;
  limit?: number;
}): Promise<AdminSaleHistory> {
  const limit = Math.min(Math.max(params.limit || 250, 1), 1000);
  const [
    { data: sales, error: salesError },
    { data: unresolved, error: unresolvedError },
  ] = await Promise.all([
    params.supabase
      .from("collectible_sales")
      .select(
        "id,store_id,asset_id,legacy_product_id,inventory_item_id,sku,ebay_item_id,event_key,source_marketplace,source_reference,sold_quantity,sold_price,currency,sold_at,evidence_status,evidence",
      )
      .eq("store_id", params.storeId)
      .order("sold_at", { ascending: false })
      .limit(limit),
    params.supabase
      .from("products")
      .select(
        "id,title,sku,ebay_item_id,price,sold_at,sold_source,sold_reference",
      )
      .eq("store_id", params.storeId)
      .lte("quantity", 0)
      .is("sold_price", null)
      .order("id", { ascending: false })
      .limit(limit),
  ]);

  if (salesError) throw salesError;
  if (unresolvedError) throw unresolvedError;

  return {
    sales: (sales || []).map((row: any) => ({
      id: String(row.id),
      storeId: String(row.store_id),
      assetId: String(row.asset_id),
      legacyProductId: Number(row.legacy_product_id),
      inventoryItemId: row.inventory_item_id
        ? String(row.inventory_item_id)
        : null,
      sku: row.sku ? String(row.sku) : null,
      ebayItemId: row.ebay_item_id ? String(row.ebay_item_id) : null,
      eventKey: String(row.event_key),
      sourceMarketplace: String(row.source_marketplace),
      sourceReference: row.source_reference
        ? String(row.source_reference)
        : null,
      soldQuantity: safeNumber(row.sold_quantity),
      soldPrice: nullableMoney(row.sold_price),
      currency: String(row.currency || "USD"),
      soldAt: String(row.sold_at),
      evidenceStatus: normalizeEvidenceStatus(row.evidence_status),
      evidence: recordValue(row.evidence),
    })),
    unresolved: (unresolved || []).map((row: any) => ({
      legacyProductId: Number(row.id),
      title: String(row.title || "Untitled"),
      sku: row.sku ? String(row.sku) : null,
      ebayItemId: row.ebay_item_id ? String(row.ebay_item_id) : null,
      listingPrice: safeNumber(row.price),
      soldAt: row.sold_at ? String(row.sold_at) : null,
      soldSource: row.sold_source ? String(row.sold_source) : null,
      soldReference: row.sold_reference ? String(row.sold_reference) : null,
    })),
  };
}
