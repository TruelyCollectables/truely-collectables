import {
  InventoryEngine,
  InventoryRepository,
} from "../modules/inventory";
import { isLaunchSportsCard } from "./sports-card-launch-scope";
import {
  matchesStorefrontCategory,
  matchesStorefrontQuery,
  sortStorefrontCategories,
  storefrontCategoryForItem,
} from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

class PublicStorefrontInventoryEngine extends InventoryEngine {
  async listAvailable(
    params: {
      query?: string;
      sport?: string;
    } = {},
  ) {
    // Load the live inventory once, then apply the customer-facing taxonomy in
    // memory. This prevents raw imported labels such as "Basketball Cards",
    // "Men's Basketball", and "NBA" from creating duplicate shop categories.
    const items = (await super.listAvailable()).filter(isLaunchSportsCard);
    return items.filter(
      (item) =>
        matchesStorefrontQuery(item, params.query) &&
        matchesStorefrontCategory(item, params.sport),
    );
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();
    return sortStorefrontCategories(items.map(storefrontCategoryForItem));
  }

  async getByLegacyProductId(legacyProductId: number) {
    const item = await super.getByLegacyProductId(legacyProductId);
    return item && isLaunchSportsCard(item) ? item : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const items = await super.getByLegacyProductIds(legacyProductIds);
    return items.filter(isLaunchSportsCard);
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
