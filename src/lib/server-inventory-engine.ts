import {
  InventoryEngine,
  InventoryRepository,
} from "../modules/inventory";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import type { StorefrontSort } from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

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
    const items = await super.listAvailable(params);
    return items.filter(isLaunchCollectible);
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(items.map((item) => item.sport?.trim()).filter(Boolean) as string[]),
    ).sort();
  }

  async getByLegacyProductId(legacyProductId: number) {
    const item = await super.getByLegacyProductId(legacyProductId);
    return item && isLaunchCollectible(item) ? item : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const items = await super.getByLegacyProductIds(legacyProductIds);
    return items.filter(isLaunchCollectible);
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
