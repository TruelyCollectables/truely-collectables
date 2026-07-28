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
TAXONOMY = "src/lib/storefront-taxonomy.ts"
TEST = "scripts/run-storefront-taxonomy-regressions.ts"

replace_once(
    SYNC,
    "const STOREFRONT_TAXONOMY_VERSION = 3;",
    "const STOREFRONT_TAXONOMY_VERSION = 4;",
    "authoritative taxonomy version 4",
)

replace_once(
    SYNC,
    '''function normalizedText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

''',
    '''function normalizedText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function authoritativeMappedCategory(params: {
  title: string;
  categoryName: string | null;
  aspects: Record<string, string[]>;
  fallback: string;
}) {
  const categoryName = normalizedText(params.categoryName);
  const aspectText = normalizedText(Object.values(params.aspects).flat().join(" "));
  const searchable = normalizedText(`${params.title} ${categoryName} ${aspectText}`);
  const sealedSignal =
    /\\b(sealed|unopened|hobby box|blaster box|booster box|mega box|factory sealed|packs?)\\b/.test(
      categoryName,
    ) &&
    /\\b(trading cards?|sports cards?|collectible card games?|ccg)\\b/.test(
      categoryName,
    );

  if (sealedSignal) return "sealed_wax";
  if (/\\bsports trading cards?\\b|\\bsports card singles?\\b/.test(categoryName)) {
    return "sports_cards";
  }
  if (
    /\\b(collectible card games?|trading card games?|ccg|pokemon|magic the gathering|yu gi oh|yugioh|lorcana)\\b/.test(
      categoryName,
    )
  ) {
    return "trading_cards";
  }
  if (/\\btrading cards?\\b/.test(categoryName)) {
    const sportsSignal = Boolean(
      firstAspect(params.aspects, ["Sport", "League"]) ||
        /\\b(baseball|basketball|football|hockey|soccer|golf|tennis|wrestling|racing|nascar|formula 1|f1|ufc|mma|wnba|nba|nfl|nhl|mlb|mls|ncaa)\\b/.test(
          searchable,
        ),
    );
    return sportsSignal ? "sports_cards" : "trading_cards";
  }

  return params.fallback;
}

''',
    "authoritative eBay category helper",
)

replace_once(
    SYNC,
    '''  const rawSport = firstAspect(aspects, ["Sport"]);
  const mapping = mapEbayInventoryCategory({ title, aspects });
  const storefront = classifyStorefrontItem({
    title,
    rawSport,
    primaryCategory: mapping.category,
    aspects,
  });
''',
    '''  const rawSport = firstAspect(aspects, ["Sport"]);
  const mapping = mapEbayInventoryCategory({ title, aspects });
  const mappedCategory = authoritativeMappedCategory({
    title,
    categoryName,
    aspects,
    fallback: mapping.category,
  });
  const categoryWasOverridden = mappedCategory !== mapping.category;
  const storefront = classifyStorefrontItem({
    title,
    rawSport,
    primaryCategory: mappedCategory,
    aspects,
  });
''',
    "use authoritative eBay category",
)

replace_once(
    SYNC,
    '''      mappedCategory: mapping.category,
      aspects,
''',
    '''      mappedCategory,
      aspects,
''',
    "use authoritative category for eligibility",
)

replace_once(
    SYNC,
    '''    mappedCategory: mapping.category,
    categoryConfidence: mapping.confidence,
    reviewRequired: mapping.reviewRequired,
''',
    '''    mappedCategory,
    categoryConfidence: categoryWasOverridden ? "high" : mapping.confidence,
    reviewRequired: categoryWasOverridden ? false : mapping.reviewRequired,
''',
    "return authoritative category metadata",
)

replace_once(
    SYNC,
    '               ? "Storefront taxonomy version 3 collectibles refresh is required."',
    '               ? "Storefront taxonomy version 4 eBay-category refresh is required."',
    "taxonomy refresh reason version 4",
)

replace_once(
    SYNC,
    '''export const ebayAuthoritativeStoreSyncTestHelpers = {
  parseRemoteListing,
  isCollectibleListing,
  // Compatibility alias for existing diagnostics.
  isSportsCardListing: isCollectibleListing,
  normalizedText,
};
''',
    '''export const ebayAuthoritativeStoreSyncTestHelpers = {
  parseRemoteListing,
  authoritativeMappedCategory,
  isCollectibleListing,
  // Compatibility alias for existing diagnostics.
  isSportsCardListing: isCollectibleListing,
  normalizedText,
};
''',
    "export authoritative category test helper",
)

replace_once(
    TAXONOMY,
    '      tcos_taxonomy_version: "3",',
    '      tcos_taxonomy_version: "4",',
    "storefront attribute taxonomy version 4",
)
replace_once(
    TAXONOMY,
    "      tcos_taxonomy_version: 3,",
    "      tcos_taxonomy_version: 4,",
    "storefront metadata taxonomy version 4",
)

regressions = r'''
const hockeyJerseyRelicCard = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>3000000001</ItemID><ListingType>FixedPriceItem</ListingType>
  <Title>2025-26 SP Game Used #100 Peter Forsberg Red Jersey</Title>
  <StartPrice>19.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/relic/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>261328</CategoryID><CategoryName>Sports Trading Cards</CategoryName></PrimaryCategory>
  <ItemSpecifics>
    <NameValueList><Name>Sport</Name><Value>Ice Hockey</Value></NameValueList>
    <NameValueList><Name>Features</Name><Value>Memorabilia</Value></NameValueList>
  </ItemSpecifics>
</Item>`);
assert.ok(hockeyJerseyRelicCard);
assert.equal(hockeyJerseyRelicCard.mappedCategory, "sports_cards");
assert.equal(hockeyJerseyRelicCard.sport, "Hockey");
assert.notEqual(hockeyJerseyRelicCard.sport, "Jerseys");

const authoritativeHockeyCard = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>3000000002</ItemID><ListingType>FixedPriceItem</ListingType>
  <Title>2022-23 Upper Deck Black Diamond Gordie Howe Exquisite Collection Moments /299</Title>
  <StartPrice>29.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/hockey/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>261328</CategoryID><CategoryName>Sports Trading Cards</CategoryName></PrimaryCategory>
  <ItemSpecifics><NameValueList><Name>Sport</Name><Value>Ice Hockey</Value></NameValueList></ItemSpecifics>
</Item>`);
assert.ok(authoritativeHockeyCard);
assert.equal(authoritativeHockeyCard.mappedCategory, "sports_cards");
assert.equal(authoritativeHockeyCard.sport, "Hockey");

const authoritativePokemonCard = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>3000000003</ItemID><ListingType>FixedPriceItem</ListingType>
  <Title>Wailord ex 016/084 Double Rare Pokemon Pitch Black 2026 NM</Title>
  <StartPrice>9.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/pokemon/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>183454</CategoryID><CategoryName>Collectible Card Games</CategoryName></PrimaryCategory>
</Item>`);
assert.ok(authoritativePokemonCard);
assert.equal(authoritativePokemonCard.mappedCategory, "trading_cards");
assert.equal(authoritativePokemonCard.sport, "Trading Card Games");

'''
replace_once(
    TEST,
    'console.log("Storefront taxonomy regressions passed.");',
    regressions + 'console.log("Storefront taxonomy regressions passed.");',
    "authoritative category regressions",
)

print("Authoritative eBay category v4 patch complete.")
