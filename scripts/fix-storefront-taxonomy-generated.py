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

print("Generated storefront taxonomy fixes complete.")
