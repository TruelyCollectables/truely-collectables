import {
  InventoryEngine,
  InventoryRepository,
  type UniversalInventoryItem,
} from "../modules/inventory";
import { deriveCardIdentity } from "./card-identity";
import { isLaunchCollectible } from "./sports-card-launch-scope";
import { isMergedEbayAliasItemId } from "./ebay-merged-listing-groups";
import { deriveStrictStorefrontFeatures } from "./storefront-feature-evidence";
import {
  normalizeStorefrontFeature,
  type StorefrontSort,
} from "./storefront-taxonomy";
import { getActiveStoreId } from "./stores";
import { createSupabaseServerClient } from "./supabase-server";

function enforceStrictStorefrontFeatures(item: UniversalInventoryItem) {
  const identity = deriveCardIdentity({
    title: item.title,
    aspectPlayer: item.player,
  });

  return {
    ...item,
    player: identity.player,
    features: deriveStrictStorefrontFeatures({
      title: item.title,
      section: item.storefrontSection || item.sport,
    }),
  };
}

function isPublicStorefrontItem(item: UniversalInventoryItem) {
  return (
    isLaunchCollectible(item) && !isMergedEbayAliasItemId(item.ebayItemId)
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
    const requestedFeature = normalizeStorefrontFeature(params.feature);
    const baseParams = requestedFeature ? { ...params, feature: undefined } : params;
    const items = await super.listAvailable(baseParams);

    return items
      .map(enforceStrictStorefrontFeatures)
      .filter(isPublicStorefrontItem)
      .filter((item) => !requestedFeature || item.features[requestedFeature]);
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
    const item = await super.getByLegacyProductId(legacyProductId);
    const publicItem = item && isPublicStorefrontItem(item) ? item : null;
    return publicItem ? enforceStrictStorefrontFeatures(publicItem) : null;
  }

  async getByLegacyProductIds(legacyProductIds: number[]) {
    const items = await super.getByLegacyProductIds(legacyProductIds);
    return items
      .filter(isPublicStorefrontItem)
      .map(enforceStrictStorefrontFeatures);
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
