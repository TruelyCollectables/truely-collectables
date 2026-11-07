import { isLaunchSportsCard } from "../../lib/sports-card-launch-scope";
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
    const blockedItem = items.find((item) => !isLaunchSportsCard(item));

    if (blockedItem) {
      throw new InventoryEngineError(
        `Product ${blockedItem.legacyProductId} is not available for purchase`,
        400,
      );
    }

    return items;
  }
}
