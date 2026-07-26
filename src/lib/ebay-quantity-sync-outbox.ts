import type { SupabaseClient } from "@supabase/supabase-js";
import { syncEbayQuantityAfterSale } from "./ebay";
import {
  ebayQuantityRetryDelaySeconds,
  selectLowestSafeEbayQuantity,
} from "./ebay-quantity-sync-safety";

type EbayQuantitySyncOutboxRow = {
  id: string;
  legacy_product_id: number;
  desired_quantity: number;
  sku: string | null;
  ebay_item_id: string | null;
  attempt_count: number;
};

type ProductRow = {
  id: number;
  sku: string | null;
  ebay_item_id: string | null;
  quantity: number;
};

type InventoryRow = {
  legacy_product_id: number;
  quantity: number;
};

export type EbayQuantitySyncRetryResult = {
  scannedRows: number;
  scannedProducts: number;
  syncedProducts: number;
  deferredProducts: number;
  skippedProducts: number;
  errors: Array<{
    legacyProductId: number;
    error: string;
  }>;
};

function cleanError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Unknown eBay quantity sync failure"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

function groupByProduct(rows: EbayQuantitySyncOutboxRow[]) {
  const grouped = new Map<number, EbayQuantitySyncOutboxRow[]>();
  for (const row of rows) {
    const productId = Number(row.legacy_product_id);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const current = grouped.get(productId) || [];
    current.push(row);
    grouped.set(productId, current);
  }
  return grouped;
}

async function markRows(params: {
  supabase: SupabaseClient;
  storeId: string;
  ids: string[];
  values: Record<string, unknown>;
}) {
  if (!params.ids.length) return;
  const { error } = await params.supabase
    .from("ebay_quantity_sync_outbox")
    .update({ ...params.values, updated_at: new Date().toISOString() })
    .eq("store_id", params.storeId)
    .in("id", params.ids);
  if (error) throw error;
}

export async function retryPendingEbayQuantitySyncs(params: {
  supabase: SupabaseClient;
  storeId: string;
  limit?: number;
}): Promise<EbayQuantitySyncRetryResult> {
  const limit = Math.min(Math.max(Math.floor(params.limit || 100), 1), 500);
  const now = new Date().toISOString();
  const { data, error } = await params.supabase
    .from("ebay_quantity_sync_outbox")
    .select("id,legacy_product_id,desired_quantity,sku,ebay_item_id,attempt_count")
    .eq("store_id", params.storeId)
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const rows = (data || []) as EbayQuantitySyncOutboxRow[];
  const groups = groupByProduct(rows);
  const result: EbayQuantitySyncRetryResult = {
    scannedRows: rows.length,
    scannedProducts: groups.size,
    syncedProducts: 0,
    deferredProducts: 0,
    skippedProducts: 0,
    errors: [],
  };

  for (const [legacyProductId, productRows] of groups) {
    const ids = productRows.map((row) => row.id);
    const maximumAttemptCount = Math.max(
      0,
      ...productRows.map((row) => Number(row.attempt_count || 0)),
    );

    try {
      const [productResult, inventoryResult] = await Promise.all([
        params.supabase
          .from("products")
          .select("id,sku,ebay_item_id,quantity")
          .eq("store_id", params.storeId)
          .eq("id", legacyProductId)
          .maybeSingle(),
        params.supabase
          .from("inventory_items")
          .select("legacy_product_id,quantity")
          .eq("store_id", params.storeId)
          .eq("legacy_product_id", legacyProductId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (productResult.error) throw productResult.error;
      if (inventoryResult.error) throw inventoryResult.error;

      const product = productResult.data as ProductRow | null;
      const inventory = inventoryResult.data as InventoryRow | null;
      if (!product) {
        await markRows({
          supabase: params.supabase,
          storeId: params.storeId,
          ids,
          values: {
            status: "skipped",
            last_attempt_at: now,
            last_error: "Local product no longer exists.",
          },
        });
        result.skippedProducts += 1;
        continue;
      }

      const targetQuantity = selectLowestSafeEbayQuantity([
        ...productRows.map((row) => row.desired_quantity),
        product.quantity,
        inventory?.quantity,
      ]);
      const sku = product.sku || productRows.find((row) => row.sku)?.sku || null;
      const ebayItemId =
        product.ebay_item_id ||
        productRows.find((row) => row.ebay_item_id)?.ebay_item_id ||
        null;

      if (!sku && !ebayItemId) {
        await markRows({
          supabase: params.supabase,
          storeId: params.storeId,
          ids,
          values: {
            status: "skipped",
            last_attempt_at: now,
            last_error: "No eBay SKU or listing ID is linked to this product.",
          },
        });
        result.skippedProducts += 1;
        continue;
      }

      const syncResult = await syncEbayQuantityAfterSale({
        sku,
        ebayItemId,
        newQuantity: targetQuantity,
      });
      if (!syncResult.success) {
        throw new Error(syncResult.reason || "eBay quantity update was skipped.");
      }

      await markRows({
        supabase: params.supabase,
        storeId: params.storeId,
        ids,
        values: {
          status: "synced",
          attempt_count: maximumAttemptCount + 1,
          last_attempt_at: now,
          last_error: null,
          synced_at: now,
          next_attempt_at: now,
        },
      });
      result.syncedProducts += 1;
    } catch (syncError) {
      const message = cleanError(syncError);
      const nextAttemptAt = new Date(
        Date.now() + ebayQuantityRetryDelaySeconds(maximumAttemptCount) * 1000,
      ).toISOString();
      try {
        await markRows({
          supabase: params.supabase,
          storeId: params.storeId,
          ids,
          values: {
            status: "pending",
            attempt_count: maximumAttemptCount + 1,
            last_attempt_at: now,
            last_error: message,
            next_attempt_at: nextAttemptAt,
          },
        });
      } catch (journalError) {
        result.errors.push({
          legacyProductId,
          error: `${message}; retry journal failed: ${cleanError(journalError)}`,
        });
        result.deferredProducts += 1;
        continue;
      }
      result.errors.push({ legacyProductId, error: message });
      result.deferredProducts += 1;
    }
  }

  return result;
}
