from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        print(f"Already fixed: {label}")
        return
    if old not in text:
        raise SystemExit(f"Could not locate {label} in {path}")
    file_path.write_text(text.replace(old, new, 1))
    print(f"Fixed: {label}")


def remove_once(path: str, block: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if block not in text:
        print(f"Already removed: {label}")
        return
    file_path.write_text(text.replace(block, "", 1))
    print(f"Removed: {label}")


# The first patch's broad type anchor landed storefront fields in the legacy
# database snapshot. Keep that snapshot faithful to the products table and put
# the derived storefront fields on UniversalInventoryItem instead.
replace_once(
    "src/modules/inventory/types.ts",
    '''  player: string | null;
  sport: string | null;
  category: string | null;
  storefrontSection: string;
  league: string | null;
  features: StorefrontFeatureFlags;
  price: number;
  quantity: number;
  image_url: string | null;
''',
    '''  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
''',
    "remove storefront fields from legacy product snapshot",
)
replace_once(
    "src/modules/inventory/types.ts",
    '''export type UniversalInventoryItem = {
  inventoryItemId: string | null;
  legacyProductId: number;
  sellerAccountId: string | null;
  sku: string | null;
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  price: number;
''',
    '''export type UniversalInventoryItem = {
  inventoryItemId: string | null;
  legacyProductId: number;
  sellerAccountId: string | null;
  sku: string | null;
  title: string;
  description: string | null;
  player: string | null;
  sport: string | null;
  category: string | null;
  storefrontSection: string;
  league: string | null;
  features: StorefrontFeatureFlags;
  price: number;
''',
    "add storefront fields to universal inventory item",
)

# Ensure a signed sports trading card keeps sports_cards as its primary catalog
# category. Autograph remains an independent storefront feature. Standalone
# signed photos, jerseys, balls, etc. still remain in Autographs/Memorabilia.
replace_once(
    "src/lib/ebay-category-mapper.ts",
    '''  let best = focusedResults[0]?.score > 0 ? focusedResults[0] : fallbackResults[0];

  if (
''',
    '''  let best = focusedResults[0]?.score > 0 ? focusedResults[0] : fallbackResults[0];
  const sportsCardResult = focusedResults.find(
    (result) => result.category === "sports_cards",
  );

  if (
    best?.category === "autographs" &&
    sportsCardResult &&
    sportsCardResult.score >= 3
  ) {
    best = sportsCardResult;
  }

  if (
''',
    "force signed sports cards to retain sports primary category",
)
remove_once(
    "src/lib/ebay-category-mapper.ts",
    '''  if (
    best?.category === "sports_cards" &&
    hasStrongAutographEvidence(input.title, aspects)
  ) {
    const autographResult = focusedResults.find(
      (result) => result.category === "autographs" && result.score > 0,
    );

    if (autographResult) {
      best = autographResult;
    }
  }

''',
    "stale sports-card-to-autograph category override",
)

# Keep uncategorized sports cards ahead of TCG/non-sport sections.
replace_once(
    "src/lib/storefront-taxonomy.ts",
    '''  "Multi-Sport",
  "Trading Card Games",
''',
    '''  "Multi-Sport",
  "Other Sports",
  "Trading Card Games",
''',
    "add Other Sports section order",
)

# The public storefront wrapper overrides listAvailable, so its parameter
# contract must expose the expanded section/feature/sort filters too.
replace_once(
    "src/lib/server-inventory-engine.ts",
    '''import { isLaunchSportsCard } from "./sports-card-launch-scope";
''',
    '''import { isLaunchSportsCard } from "./sports-card-launch-scope";
import type { StorefrontSort } from "./storefront-taxonomy";
''',
    "public storefront sort type import",
)
replace_once(
    "src/lib/server-inventory-engine.ts",
    '''  async listAvailable(
    params: {
      query?: string;
      sport?: string;
    } = {},
  ) {
''',
    '''  async listAvailable(
    params: {
      query?: string;
      sport?: string;
      section?: string;
      feature?: string;
      category?: string;
      sort?: StorefrontSort;
    } = {},
  ) {
''',
    "public storefront expanded filter contract",
)

# Keep the permanent taxonomy gate watching/linting the public wrapper.
replace_once(
    ".github/workflows/storefront-taxonomy.yml",
    '''      - "src/modules/inventory/**"
      - "src/app/shop/**"
''',
    '''      - "src/modules/inventory/**"
      - "src/lib/server-inventory-engine.ts"
      - "src/app/shop/**"
''',
    "permanent gate public wrapper path",
)
replace_once(
    ".github/workflows/storefront-taxonomy.yml",
    '''          src/modules/inventory/engine.ts
          src/app/shop/page.tsx
''',
    '''          src/modules/inventory/engine.ts
          src/lib/server-inventory-engine.ts
          src/app/shop/page.tsx
''',
    "permanent gate public wrapper lint",
)

print("Generated storefront taxonomy fixes complete.")
