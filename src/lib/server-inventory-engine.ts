import {
  InventoryEngine,
  InventoryRepository,
} from "../modules/inventory";
import { isLaunchSportsCard } from "./sports-card-launch-scope";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

class PublicStorefrontInventoryEngine extends InventoryEngine {
  async listAvailable(
    params: {
      query?: string;
      sport?: string;
    } = {},
  ) {
    const items = await super.listAvailable(params);
    return items.filter(isLaunchSportsCard);
  }

  async listAvailableSports(): Promise<string[]> {
    const items = await this.listAvailable();

    return Array.from(
      new Set(items.map((item) => item.sport?.trim()).filter(Boolean) as string[]),
    ).sort();
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
