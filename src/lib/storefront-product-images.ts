import type { SupabaseClient } from "@supabase/supabase-js";
import { selectFrontBackListingImages } from "./listing-image-utils";

type InventoryImageRow = {
  inventory_item_id: string;
  image_url: string;
  sort_order: number;
  is_primary: boolean;
};

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function prioritizeStorefrontProductImageRows(
  rows: InventoryImageRow[],
  preferredInventoryItemId: string | null,
) {
  return rows.slice().sort((left, right) => {
    const leftPreferred = left.inventory_item_id === preferredInventoryItemId ? 0 : 1;
    const rightPreferred = right.inventory_item_id === preferredInventoryItemId ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;

    const leftPrimary = left.is_primary ? 0 : 1;
    const rightPrimary = right.is_primary ? 0 : 1;
    if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;

    return left.sort_order - right.sort_order;
  });
}

export async function listStorefrontProductImages(params: {
  supabase: SupabaseClient;
  storeId: string;
  legacyProductId: number;
  sku?: string | null;
  preferredInventoryItemId?: string | null;
  primaryImageUrl?: string | null;
}) {
  const inventoryIds = new Set<string>();
  if (params.preferredInventoryItemId) {
    inventoryIds.add(params.preferredInventoryItemId);
  }

  const { data: legacyRows, error: legacyError } = await params.supabase
    .from("inventory_items")
    .select("id")
    .eq("store_id", params.storeId)
    .eq("legacy_product_id", params.legacyProductId)
    .limit(100);
  if (legacyError) throw legacyError;
  for (const row of legacyRows || []) inventoryIds.add(String(row.id));

  if (params.sku) {
    const { data: skuRows, error: skuError } = await params.supabase
      .from("inventory_items")
      .select("id")
      .eq("store_id", params.storeId)
      .eq("sku", params.sku)
      .limit(100);
    if (skuError) throw skuError;
    for (const row of skuRows || []) inventoryIds.add(String(row.id));
  }

  if (inventoryIds.size === 0) {
    return selectFrontBackListingImages([params.primaryImageUrl]);
  }

  const { data: imageRows, error: imageError } = await params.supabase
    .from("inventory_images")
    .select("inventory_item_id,image_url,sort_order,is_primary")
    .in("inventory_item_id", Array.from(inventoryIds))
    .order("inventory_item_id", { ascending: true })
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;

  const prioritized = prioritizeStorefrontProductImageRows(
    (imageRows || []) as InventoryImageRow[],
    params.preferredInventoryItemId || null,
  );

  return selectFrontBackListingImages(
    uniqueValues([
      params.primaryImageUrl,
      ...prioritized.map((row) => row.image_url),
    ]),
  );
}
