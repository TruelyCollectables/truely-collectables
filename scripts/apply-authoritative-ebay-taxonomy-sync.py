from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if new in text:
        print(f"Already applied: {label}")
        return
    if old not in text:
        raise SystemExit(f"Could not locate {label} in {path}")
    file_path.write_text(text.replace(old, new, 1))
    print(f"Applied: {label}")


SYNC = "src/lib/ebay-authoritative-store-sync.ts"
TEST = "scripts/run-storefront-taxonomy-regressions.ts"

replace_once(
    SYNC,
    'import { mapEbayInventoryCategory } from "./ebay-category-mapper";\n',
    'import { mapEbayInventoryCategory } from "./ebay-category-mapper";\nimport { classifyStorefrontItem } from "./storefront-taxonomy";\n',
    "taxonomy import",
)
replace_once(
    SYNC,
    'const APPLY_CONCURRENCY = 8;\n',
    'const APPLY_CONCURRENCY = 8;\nconst STOREFRONT_TAXONOMY_VERSION = 2;\n',
    "taxonomy version constant",
)
replace_once(
    SYNC,
    '''  reviewRequired: boolean;
};
''',
    '''  reviewRequired: boolean;
  storefrontAttributes: Record<string, string>;
  storefrontMetadata: Record<string, unknown>;
};
''',
    "remote taxonomy fields",
)
replace_once(
    SYNC,
    '''  ebay_item_id: string | null;
  last_seen_at: string | null;
};
''',
    '''  ebay_item_id: string | null;
  sport: string | null;
  last_seen_at: string | null;
};
''',
    "local product sport field",
)
replace_once(
    SYNC,
    '''  const mapping = mapEbayInventoryCategory({ title, aspects });

  if (
''',
    '''  const rawSport = firstAspect(aspects, ["Sport"]);
  const mapping = mapEbayInventoryCategory({ title, aspects });
  const storefront = classifyStorefrontItem({
    title,
    rawSport,
    primaryCategory: mapping.category,
    aspects,
  });

  if (
''',
    "parse storefront taxonomy",
)
replace_once(
    SYNC,
    '''    player: firstAspect(aspects, ["Player/Athlete", "Player", "Athlete"]),
    sport: firstAspect(aspects, ["Sport"]),
    mappedCategory: mapping.category,
    categoryConfidence: mapping.confidence,
    reviewRequired: mapping.reviewRequired,
''',
    '''    player: firstAspect(aspects, ["Player/Athlete", "Player", "Athlete"]),
    sport: storefront.section,
    mappedCategory: mapping.category,
    categoryConfidence: mapping.confidence,
    reviewRequired: mapping.reviewRequired,
    storefrontAttributes: storefront.attributes,
    storefrontMetadata: storefront.metadata,
''',
    "return normalized storefront taxonomy",
)
replace_once(
    SYNC,
    '''    local.image_url !== remote.imageUrl ||
    (!local.sku && Boolean(remote.sku))
''',
    '''    local.image_url !== remote.imageUrl ||
    local.sport !== remote.sport ||
    (!local.sku && Boolean(remote.sku))
''',
    "compare normalized sport",
)
replace_once(
    SYNC,
    '''      review_required: params.remote.reviewRequired,
      authoritative_store_sync_at: now,
''',
    '''      review_required: params.remote.reviewRequired,
      ...params.remote.storefrontMetadata,
      authoritative_store_sync_at: now,
''',
    "persist taxonomy metadata",
)
replace_once(
    SYNC,
    '''      ["ebay_category_id", params.remote.categoryId],
      ["ebay_category_name", params.remote.categoryName],
      ...Object.entries(params.remote.aspects).map(([name, values]) => [
''',
    '''      ["ebay_category_id", params.remote.categoryId],
      ["ebay_category_name", params.remote.categoryName],
      ...Object.entries(params.remote.storefrontAttributes).map(([name, value]) => [
        name,
        value,
      ]),
      ...Object.entries(params.remote.aspects).map(([name, values]) => [
''',
    "persist taxonomy attributes",
)
replace_once(
    SYNC,
    '''      "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,last_seen_at",
''',
    '''      "id,seller_account_id,sku,title,description,price,quantity,image_url,ebay_item_id,sport,last_seen_at",
''',
    "select local sport",
)
replace_once(
    SYNC,
    '''  const locals = (localRows || []) as LocalProduct[];
  const localByItemId = new Map(
''',
    '''  const locals = (localRows || []) as LocalProduct[];
  const taxonomyRefreshRequired =
    Number(
      recordValue(connection.import_cursor).storefront_taxonomy_version || 0,
    ) < STOREFRONT_TAXONOMY_VERSION;
  const localByItemId = new Map(
''',
    "connection taxonomy refresh flag",
)
replace_once(
    SYNC,
    ''': listingChanged(local, listing)
          ? "update"
''',
    ''': taxonomyRefreshRequired || listingChanged(local, listing)
          ? "update"
''',
    "force one taxonomy refresh cycle",
)
replace_once(
    SYNC,
    '''            : action === "update"
              ? "Local title, quantity, price, image, or SKU differs from eBay."
''',
    '''            : action === "update"
              ? taxonomyRefreshRequired
                ? "Storefront taxonomy version 2 refresh is required."
                : "Local title, quantity, price, image, sport, or SKU differs from eBay."
''',
    "taxonomy refresh action reason",
)
replace_once(
    SYNC,
    '''      return !local || listingChanged(local, listing);
''',
    '''      return !local || taxonomyRefreshRequired || listingChanged(local, listing);
''',
    "apply taxonomy refresh listings",
)
replace_once(
    SYNC,
    '''    const unchangedIds = remote.listings
''',
    '''    const unchangedIds = taxonomyRefreshRequired
      ? []
      : remote.listings
''',
    "exclude taxonomy refresh from unchanged list",
)
replace_once(
    SYNC,
    '''          ...recordValue(connection.import_cursor),
          authoritative_store_sync_last_completed_at: completedAt,
''',
    '''          ...recordValue(connection.import_cursor),
          ...(errors.length === 0 && remote.cycleComplete
            ? {
                storefront_taxonomy_version: STOREFRONT_TAXONOMY_VERSION,
              }
            : {}),
          authoritative_store_sync_last_completed_at: completedAt,
''',
    "record completed taxonomy version",
)

replace_once(
    TEST,
    '''import { mapEbayInventoryCategory } from "../src/lib/ebay-category-mapper";
''',
    '''import { mapEbayInventoryCategory } from "../src/lib/ebay-category-mapper";
import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";
''',
    "authoritative sync test helper import",
)
replace_once(
    TEST,
    '''const inventory = [
''',
    '''const authoritativeWnba = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>1234567890</ItemID>
  <ListingType>FixedPriceItem</ListingType>
  <Title>2024 Panini Prizm WNBA Caitlin Clark Rookie Autograph /25</Title>
  <StartPrice>199.99</StartPrice>
  <Quantity>1</Quantity>
  <PictureDetails>
    <GalleryURL>https://i.ebayimg.com/images/g/example/s-l1600.jpg</GalleryURL>
  </PictureDetails>
  <PrimaryCategory>
    <CategoryID>261328</CategoryID>
    <CategoryName>Sports Trading Cards</CategoryName>
  </PrimaryCategory>
  <ItemSpecifics>
    <NameValueList><Name>Sport</Name><Value>Basketball</Value></NameValueList>
    <NameValueList><Name>League</Name><Value>Women's National Basketball Association (WNBA)</Value></NameValueList>
    <NameValueList><Name>Autographed</Name><Value>Yes</Value></NameValueList>
    <NameValueList><Name>Features</Name><Value>Rookie, Serial Numbered</Value></NameValueList>
  </ItemSpecifics>
</Item>`);
assert.ok(authoritativeWnba);
assert.equal(authoritativeWnba.sport, "WNBA");
assert.equal(authoritativeWnba.mappedCategory, "sports_cards");
assert.equal(authoritativeWnba.storefrontMetadata.tcos_is_autograph, true);
assert.equal(authoritativeWnba.storefrontMetadata.tcos_is_rookie, true);
assert.equal(authoritativeWnba.storefrontMetadata.tcos_is_numbered, true);
assert.equal(authoritativeWnba.storefrontAttributes.tcos_storefront_section, "WNBA");

const inventory = [
''',
    "authoritative WNBA taxonomy regression",
)

print("Authoritative eBay taxonomy sync patch complete.")
