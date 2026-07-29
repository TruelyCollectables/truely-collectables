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

const MAX_MONOTONIC_CORRECTIONS = 10;

function cleanError(error: unknown) {
  return (
    error instanceof Error
      ? error.message
      : String(error || "Unknown eBay quantity sync failure")
  )
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
    .eq("status", "pending")
    .in("id", params.ids);
  if (error) throw error;
}

async function loadPendingProductRows(params: {
  supabase: SupabaseClient;
  storeId: string;
  legacyProductId: number;
}) {
  const { data, error } = await params.supabase
    .from("ebay_quantity_sync_outbox")
    .select(
      "id,legacy_product_id,desired_quantity,sku,ebay_item_id,attempt_count",
    )
    .eq("store_id", params.storeId)
    .eq("legacy_product_id", params.legacyProductId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as EbayQuantitySyncOutboxRow[];
}

async function loadLocalProductState(params: {
  supabase: SupabaseClient;
  storeId: string;
  legacyProductId: number;
}) {
  const [productResult, inventoryResult] = await Promise.all([
    params.supabase
      .from("products")
      .select("id,sku,ebay_item_id,quantity")
      .eq("store_id", params.storeId)
      .eq("id", params.legacyProductId)
      .maybeSingle(),
    params.supabase
      .from("inventory_items")
      .select("legacy_product_id,quantity")
      .eq("store_id", params.storeId)
      .eq("legacy_product_id", params.legacyProductId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (productResult.error) throw productResult.error;
  if (inventoryResult.error) throw inventoryResult.error;
  return {
    product: productResult.data as ProductRow | null,
    inventory: inventoryResult.data as InventoryRow | null,
  };
}

function localTarget(params: {
  rows: EbayQuantitySyncOutboxRow[];
  product: ProductRow;
  inventory: InventoryRow | null;
}) {
  return selectLowestSafeEbayQuantity([
    ...params.rows.map((row) => row.desired_quantity),
    params.product.quantity,
    params.inventory?.quantity,
  ]);
}

function durableJournalTarget(rows: EbayQuantitySyncOutboxRow[]) {
  return selectLowestSafeEbayQuantity(rows.map((row) => row.desired_quantity));
}

function identifiers(params: {
  rows: EbayQuantitySyncOutboxRow[];
  product: ProductRow | null;
}) {
  return {
    sku: params.product?.sku || params.rows.find((row) => row.sku)?.sku || null,
    ebayItemId:
      params.product?.ebay_item_id ||
      params.rows.find((row) => row.ebay_item_id)?.ebay_item_id ||
      null,
  };
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
    .select(
      "id,legacy_product_id,desired_quantity,sku,ebay_item_id,attempt_count",
    )
    .eq("store_id", params.storeId)
    .eq("status", "pending")
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const dueRows = (data || []) as EbayQuantitySyncOutboxRow[];
  const groups = groupByProduct(dueRows);
  const result: EbayQuantitySyncRetryResult = {
    scannedRows: dueRows.length,
    scannedProducts: groups.size,
    syncedProducts: 0,
    deferredProducts: 0,
    skippedProducts: 0,
    errors: [],
  };

  for (const [legacyProductId] of groups) {
    let lastPushedQuantity: number | null = null;
    let productSynced = false;
    let productSkipped = false;

    for (
      let correction = 0;
      correction < MAX_MONOTONIC_CORRECTIONS;
      correction += 1
    ) {
      let pendingRows: EbayQuantitySyncOutboxRow[] = [];
      try {
        pendingRows = await loadPendingProductRows({
          supabase: params.supabase,
          storeId: params.storeId,
          legacyProductId,
        });
        if (pendingRows.length === 0) {
          productSynced = true;
          break;
        }

        const { product, inventory } = await loadLocalProductState({
          supabase: params.supabase,
          storeId: params.storeId,
          legacyProductId,
        });
        const targetQuantity = product
          ? localTarget({ rows: pendingRows, product, inventory })
          : durableJournalTarget(pendingRows);
        const linked = identifiers({ rows: pendingRows, product });

        if (!linked.sku && !linked.ebayItemId) {
          await markRows({
            supabase: params.supabase,
            storeId: params.storeId,
            ids: pendingRows.map((row) => row.id),
            values: {
              status: "skipped",
              last_attempt_at: now,
              last_error: product
                ? "No eBay SKU or listing ID is linked to this product."
                : "Local product was removed and the durable journal has no eBay identifier.",
            },
          });
          productSkipped = true;
          break;
        }

        if (
          lastPushedQuantity === null ||
          targetQuantity < lastPushedQuantity
        ) {
          const syncResult = await syncEbayQuantityAfterSale({
            sku: linked.sku,
            ebayItemId: linked.ebayItemId,
            newQuantity: targetQuantity,
          });
          if (!syncResult.success) {
            throw new Error(
              syncResult.reason || "eBay quantity update was skipped.",
            );
          }
          lastPushedQuantity = targetQuantity;
        }

        const attemptCount = Math.max(
          0,
          ...pendingRows.map((row) => Number(row.attempt_count || 0)),
        );
        await markRows({
          supabase: params.supabase,
          storeId: params.storeId,
          ids: pendingRows.map((row) => row.id),
          values: {
            status: "synced",
            attempt_count: attemptCount + 1,
            last_attempt_at: now,
            last_error: null,
            synced_at: now,
            next_attempt_at: now,
          },
        });

        // Re-read after the remote write. A sale or administrative removal may
        // commit while the eBay request is in flight. Newly journaled lower
        // quantity must win immediately instead of waiting for the next cron.
        const nextRows = await loadPendingProductRows({
          supabase: params.supabase,
          storeId: params.storeId,
          legacyProductId,
        });
        if (nextRows.length === 0) {
          productSynced = true;
          break;
        }

        const nextState = await loadLocalProductState({
          supabase: params.supabase,
          storeId: params.storeId,
          legacyProductId,
        });
        const nextTarget = nextState.product
          ? localTarget({
              rows: nextRows,
              product: nextState.product,
              inventory: nextState.inventory,
            })
          : durableJournalTarget(nextRows);
        if (lastPushedQuantity !== null && nextTarget < lastPushedQuantity) {
          continue;
        }

        productSynced = true;
        break;
      } catch (syncError) {
        const message = cleanError(syncError);
        const maximumAttemptCount = Math.max(
          0,
          ...pendingRows.map((row) => Number(row.attempt_count || 0)),
        );
        const nextAttemptAt = new Date(
          Date.now() +
            ebayQuantityRetryDelaySeconds(maximumAttemptCount) * 1000,
        ).toISOString();
        try {
          await markRows({
            supabase: params.supabase,
            storeId: params.storeId,
            ids: pendingRows.map((row) => row.id),
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
          break;
        }
        result.errors.push({ legacyProductId, error: message });
        result.deferredProducts += 1;
        break;
      }
    }

    if (productSkipped) {
      result.skippedProducts += 1;
    } else if (productSynced) {
      result.syncedProducts += 1;
    } else if (
      !result.errors.some((item) => item.legacyProductId === legacyProductId)
    ) {
      result.errors.push({
        legacyProductId,
        error:
          "Post-sale eBay quantity kept changing during the correction window; the pending outbox row remains protected for retry.",
      });
      result.deferredProducts += 1;
    }
  }

  return result;
}
