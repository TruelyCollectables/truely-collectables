import { isLaunchSportsCard } from "../../lib/sports-card-launch-scope";
import { getActiveStoreId } from "../../lib/stores";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import {
  InventoryEngine as BaseInventoryEngine,
  InventoryEngineError,
} from "./engine";
import type { UniversalInventoryItem } from "./types";

type CheckoutCartItem = {
  id?: unknown;
  product_id?: unknown;
  productId?: unknown;
  quantity?: unknown;
  qty?: unknown;
};

export class InventoryEngine extends BaseInventoryEngine {
  async requireAvailableCartItems(
    cart: CheckoutCartItem[],
  ): Promise<UniversalInventoryItem[]> {
    const items = await super.requireAvailableCartItems(cart);
    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("collx_only_inventory_boundary_violations")
      .select("legacy_product_id")
      .eq("store_id", getActiveStoreId())
      .in(
        "legacy_product_id",
        items.map((item) => item.legacyProductId),
      );

    if (error) {
      throw new InventoryEngineError(
        "Unable to verify marketplace inventory boundaries",
        503,
      );
    }

    const collxOnlyProductIds = new Set(
      (data || []).map((row: any) => Number(row.legacy_product_id)),
    );
    const blockedItem = items.find(
      (item) =>
        !isLaunchSportsCard(item) ||
        collxOnlyProductIds.has(item.legacyProductId),
    );

    if (blockedItem) {
      throw new InventoryEngineError(
        `Product ${blockedItem.legacyProductId} is not available for purchase`,
        400,
      );
    }

    return items;
  }
}
