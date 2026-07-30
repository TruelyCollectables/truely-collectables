import {
  InventoryEngine,
  InventoryRepository,
  type UniversalInventoryItem,
} from "../modules/inventory";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";
import type { StorefrontSort } from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

async function collxOnlyLegacyProductIds() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("collx_only_inventory_boundary_violations")
    .select("legacy_product_id")
    .eq("store_id", storeId);

  if (error) throw error;
  return new Set(
    (data || [])
      .map((row: any) => Number(row.legacy_product_id))
      .filter(Number.isFinite),
  );
}

function isPublicStorefrontItem(item: UniversalInventoryItem) {
  return (
    isLaunchCollectible(item) &&
    !isMergedEbayAliasItemId(item.ebayItemId)
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
    const [items, collxOnlyProductIds] = await Promise.all([
      super.listAvailable(params),
      collxOnlyLegacyProductIds(),
    ]);
    return items
      .filter(isPublicStorefrontItem)
      .filter((item) => !collxOnlyProductIds.has(item.legacyProductId));
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
    return item && isPublicStorefrontItem(item) ? item : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const [loadedItems, collxOnlyProductIds] = await Promise.all([
      super.getByLegacyProductIds(legacyProductIds),
      collxOnlyLegacyProductIds(),
    ]);
    const items = loadedItems.filter(
      (item) => !collxOnlyProductIds.has(item.legacyProductId),
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
