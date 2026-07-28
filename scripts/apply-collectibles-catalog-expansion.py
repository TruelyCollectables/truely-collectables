from pathlib import Path
import re


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


def replace_regex(path: str, pattern: str, replacement: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected one {label} replacement in {path}; found {count}")
    file_path.write_text(updated)
    print(f"Applied: {label}")


Path("src/lib/sports-card-launch-scope.ts").write_text(r'''import type { UniversalInventoryItem } from "../modules/inventory/types";

export type CollectibleLaunchCandidate = Pick<
  UniversalInventoryItem,
  "title" | "sport" | "category" | "storefrontSection" | "features"
>;

const PARTS_PATTERN =
  /\b(?:auto parts?|automotive parts?|car parts?|truck parts?|air intake|fuel sensor|oxygen sensor|mass air flow|alternator|starter motor|spark plugs?|brake pads?|brake rotors?|wheel hubs?|ball bearings?|radiator|transmission|exhaust|muffler|bumper|headlights?|taillights?|engine parts?)\b/i;
const FOOTWEAR_PATTERN =
  /\b(?:athletic shoes?|sneakers?|shoes?|boots?|cleats?|sandals?|slippers?|footwear)\b/i;
const APPAREL_PATTERN =
  /\b(?:clothing|apparel|pants|shorts|shirts?|t-?shirts?|hoodies?|jackets?|coats?|sweaters?|sweatshirts?|socks?|hats?|caps?)\b/i;
const JERSEY_PATTERN = /\bjerseys?\b/i;
const JERSEY_COLLECTIBLE_PATTERN =
  /\b(?:signed|autographed|inscribed|authenticated|authentication|coa|jsa|beckett|psa\/?dna|game[- ]used|game[- ]worn|game[- ]issued|player[- ]worn|framed|memorabilia)\b/i;
const COLLECTIBLE_EVIDENCE_PATTERN =
  /\b(?:trading cards?|sports cards?|rookie cards?|sealed wax|hobby box|blaster box|booster box|autographs?|signed|memorabilia|pucks?|baseballs?|footballs?|basketballs?|soccer balls?|softballs?|golf balls?|bats?|baseball gloves?|helmets?|photos?|photographs?|prints?|posters?|tickets?|programs?|media guides?|comics?|coins?|bullion|funko|action figures?|diecast|toys?|collectibles?)\b/i;

const ALLOWED_CATEGORIES = new Set([
  "sports_cards",
  "trading_cards",
  "sealed_wax",
  "autographs",
  "memorabilia",
  "comics",
  "coins",
  "toys",
]);

const ALLOWED_SECTIONS = new Set([
  "Baseball",
  "WNBA",
  "Basketball",
  "Football",
  "Hockey",
  "Soccer",
  "Wrestling",
  "MMA / UFC",
  "Boxing",
  "Golf",
  "Tennis",
  "Racing / NASCAR",
  "Multi-Sport",
  "Other Sports",
  "Sealed Wax",
  "Pucks",
  "Balls",
  "Jerseys",
  "Helmets",
  "Bats & Gloves",
  "Photos & Prints",
  "Tickets & Programs",
  "Trading Card Games",
  "Autographs",
  "Memorabilia",
  "Comics",
  "Coins",
  "Toys & Figures",
]);

function normalized(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isLaunchCollectible(candidate: CollectibleLaunchCandidate) {
  const title = normalized(candidate.title);
  const category = normalized(candidate.category).toLowerCase();
  const section = normalized(candidate.storefrontSection || candidate.sport);
  const searchable = `${title} ${category} ${section}`;
  const isCardCategory = ["sports_cards", "trading_cards", "sealed_wax"].includes(
    category,
  );
  const collectibleJersey =
    JERSEY_PATTERN.test(searchable) && JERSEY_COLLECTIBLE_PATTERN.test(searchable);

  if (!title || PARTS_PATTERN.test(searchable)) return false;
  if (!isCardCategory && FOOTWEAR_PATTERN.test(searchable)) return false;
  if (!isCardCategory && APPAREL_PATTERN.test(searchable)) return false;
  if (!isCardCategory && JERSEY_PATTERN.test(searchable) && !collectibleJersey) {
    return false;
  }

  if (ALLOWED_CATEGORIES.has(category)) return true;
  if (ALLOWED_SECTIONS.has(section)) return true;

  return COLLECTIBLE_EVIDENCE_PATTERN.test(searchable);
}

// Compatibility export for older callers while the public launch expands from
// cards-only inventory to the full collectibles catalog.
export const isLaunchSportsCard = isLaunchCollectible;
''')
print("Replaced public launch scope with collectibles policy")

replace_once(
    "src/lib/server-inventory-engine.ts",
    'import { isLaunchSportsCard } from "./sports-card-launch-scope";',
    'import { isLaunchCollectible } from "./sports-card-launch-scope";',
    "public collectibles scope import",
)
replace_once(
    "src/lib/server-inventory-engine.ts",
    "return items.filter(isLaunchSportsCard);",
    "return items.filter(isLaunchCollectible);",
    "public collectibles list filter",
)
replace_once(
    "src/lib/server-inventory-engine.ts",
    "return item && isLaunchSportsCard(item) ? item : null;",
    "return item && isLaunchCollectible(item) ? item : null;",
    "public collectible detail filter",
)
replace_once(
    "src/lib/server-inventory-engine.ts",
    "return items.filter(isLaunchSportsCard);",
    "return items.filter(isLaunchCollectible);",
    "public collectible cart filter",
)

replace_once(
    "src/lib/storefront-taxonomy.ts",
    '''  "Multi-Sport",
  "Other Sports",
  "Trading Card Games",
  "Autographs",
  "Memorabilia",
  "Other Collectables",
''',
    '''  "Multi-Sport",
  "Other Sports",
  "Sealed Wax",
  "Pucks",
  "Balls",
  "Jerseys",
  "Helmets",
  "Bats & Gloves",
  "Photos & Prints",
  "Tickets & Programs",
  "Trading Card Games",
  "Autographs",
  "Memorabilia",
  "Comics",
  "Coins",
  "Toys & Figures",
  "Other Collectables",
''',
    "collectibles storefront section order",
)
replace_once(
    "src/lib/storefront-taxonomy.ts",
    '''  const title = normalized(params.title);
  const focused = `${sport} ${league} ${title}`;

  if (/\\bwnba\\b|women'?s national basketball association/.test(focused)) {
''',
    '''  const title = normalized(params.title);
  const primaryCategory = normalized(params.primaryCategory);
  const objectType = normalized(
    [
      aspectValue(params.aspects, "Type"),
      aspectValue(params.aspects, "Product"),
      aspectValue(params.aspects, "Item Type"),
      aspectValue(params.aspects, "Autograph Format"),
    ].join(" "),
  );
  const focused = `${sport} ${league} ${title}`;
  const objectFocused = `${title} ${objectType}`;
  const isCardPrimary = ["sports_cards", "trading_cards", "sealed_wax"].includes(
    primaryCategory,
  );

  if (!isCardPrimary) {
    if (/\\bpucks?\\b/.test(objectFocused)) return "Pucks";
    if (/\\bjerseys?\\b/.test(objectFocused)) return "Jerseys";
    if (/\\bhelmets?\\b/.test(objectFocused)) return "Helmets";
    if (/\\b(?:bats?|baseball gloves?|fielding gloves?|catcher'?s mitts?)\\b/.test(objectFocused)) {
      return "Bats & Gloves";
    }
    if (/\\b(?:photos?|photographs?|prints?|posters?|lithographs?)\\b/.test(objectFocused)) {
      return "Photos & Prints";
    }
    if (/\\b(?:tickets?|programs?|media guides?)\\b/.test(objectFocused)) {
      return "Tickets & Programs";
    }
    if (
      /\\b(?:baseballs?|footballs?|basketballs?|soccer balls?|softballs?|volleyballs?|golf balls?|game balls?)\\b/.test(
        objectFocused,
      )
    ) {
      return "Balls";
    }
  }

  if (/\\bwnba\\b|women'?s national basketball association/.test(focused)) {
''',
    "collectible object sections",
)
replace_once(
    "src/lib/storefront-taxonomy.ts",
    '''    case "trading_cards":
    case "sealed_wax":
      return "Trading Card Games";
    case "autographs":
      return "Autographs";
    case "memorabilia":
      return "Memorabilia";
    default:
''',
    '''    case "trading_cards":
      return "Trading Card Games";
    case "sealed_wax":
      return "Sealed Wax";
    case "autographs":
      return "Autographs";
    case "memorabilia":
      return "Memorabilia";
    case "comics":
      return "Comics";
    case "coins":
      return "Coins";
    case "toys":
      return "Toys & Figures";
    default:
''',
    "collectible category sections",
)
replace_once(
    "src/lib/storefront-taxonomy.ts",
    '      tcos_taxonomy_version: "2",',
    '      tcos_taxonomy_version: "3",',
    "taxonomy attribute version 3",
)
replace_once(
    "src/lib/storefront-taxonomy.ts",
    "      tcos_taxonomy_version: 2,",
    "      tcos_taxonomy_version: 3,",
    "taxonomy metadata version 3",
)

replace_once(
    "src/lib/ebay-category-mapper.ts",
    '''  {
    category: "memorabilia",
    highTerms: ["memorabilia", "jersey", "helmet", "bat", "game used", "relic"],
    mediumTerms: ["patch", "framed", "display"],
  },
''',
    '''  {
    category: "memorabilia",
    highTerms: [
      "sports memorabilia",
      "memorabilia",
      "hockey puck",
      "signed puck",
      "autographed puck",
      "signed baseball",
      "autographed baseball",
      "signed football",
      "autographed football",
      "signed basketball",
      "autographed basketball",
      "signed jersey",
      "autographed jersey",
      "game used",
      "game worn",
      "player worn",
      "helmet",
      "baseball bat",
      "signed photo",
      "autographed photo",
    ],
    mediumTerms: [
      "puck",
      "ball",
      "jersey",
      "bat",
      "glove",
      "photo",
      "photograph",
      "ticket",
      "program",
      "patch",
      "framed",
      "display",
      "coa",
    ],
  },
''',
    "expanded memorabilia mapping",
)

replace_once(
    "src/lib/ebay-authoritative-store-sync.ts",
    "const STOREFRONT_TAXONOMY_VERSION = 2;",
    "const STOREFRONT_TAXONOMY_VERSION = 3;",
    "authoritative taxonomy version 3",
)
replace_regex(
    "src/lib/ebay-authoritative-store-sync.ts",
    r'''function isSportsCardListing\(input: \{.*?\n\}\n\nfunction parseRemoteListing''',
    r'''function isCollectibleListing(input: {
  title: string;
  categoryName: string | null;
  mappedCategory: string;
  aspects: Record<string, string[]>;
}) {
  const categoryName = normalizedText(input.categoryName);
  const aspectText = Object.values(input.aspects).flat().join(" ");
  const searchable = normalizedText(
    [input.title, input.categoryName, aspectText].filter(Boolean).join(" "),
  );
  const cardCategory = ["sports_cards", "trading_cards", "sealed_wax"].includes(
    input.mappedCategory,
  );
  const partSignal =
    /\b(auto parts?|automotive parts?|car parts?|truck parts?|air intake|fuel sensor|oxygen sensor|mass air flow|alternator|starter motor|spark plugs?|brake pads?|brake rotors?|wheel hubs?|ball bearings?|radiator|transmission|exhaust|muffler|bumper|headlights?|taillights?|engine parts?)\b/.test(
      searchable,
    );
  if (partSignal) return false;

  if (
    cardCategory &&
    /\b(?:sports )?trading card(s| singles| lots| boxes)?\b/.test(categoryName)
  ) {
    return true;
  }

  const footwearSignal =
    input.mappedCategory === "shoes" ||
    /\b(athletic shoes?|sneakers?|shoes?|boots?|cleats?|sandals?|slippers?|footwear)\b/.test(
      searchable,
    );
  if (!cardCategory && footwearSignal) return false;

  const jerseySignal = /\bjerseys?\b/.test(searchable);
  const collectibleJersey =
    jerseySignal &&
    (/\bmemorabilia\b/.test(categoryName) ||
      /\b(signed|autographed|inscribed|authenticated|authentication|coa|jsa|beckett|psa dna|game used|game worn|game issued|player worn|framed)\b/.test(
        searchable,
      ));
  if (!cardCategory && jerseySignal && !collectibleJersey) return false;

  const apparelSignal =
    /\b(clothing|apparel|pants|shorts|shirts?|t shirts?|hoodies?|jackets?|coats?|sweaters?|sweatshirts?|socks?|hats?|caps?)\b/.test(
      searchable,
    );
  if (!cardCategory && apparelSignal) return false;

  if (
    [
      "sports_cards",
      "trading_cards",
      "sealed_wax",
      "autographs",
      "memorabilia",
      "comics",
      "coins",
      "toys",
    ].includes(input.mappedCategory)
  ) {
    return true;
  }

  if (
    /\b(collectibles?|sports memorabilia|autographs?|photographs?|photos?|comics?|coins?|toys?|action figures?|diecast|trading cards?|pucks?|balls?|bats?|helmets?|tickets?|programs?)\b/.test(
      categoryName,
    )
  ) {
    return true;
  }

  const collectibleObject =
    /\b(pucks?|baseballs?|footballs?|basketballs?|soccer balls?|softballs?|golf balls?|bats?|baseball gloves?|helmets?|photos?|photographs?|prints?|posters?|tickets?|programs?|media guides?)\b/.test(
      searchable,
    );
  const collectibleEvidence =
    /\b(signed|autographed|authenticated|authentication|coa|jsa|beckett|psa dna|game used|game worn|game issued|player worn|memorabilia|collectible)\b/.test(
      searchable,
    );
  const sportSignal =
    /\b(baseball|basketball|football|hockey|soccer|golf|tennis|wrestling|racing|nascar|formula 1|f1|ufc|mma|wnba|nba|nfl|nhl|mlb|mls|ncaa)\b/.test(
      searchable,
    );

  return collectibleObject && (collectibleEvidence || sportSignal);
}

function parseRemoteListing''',
    "authoritative collectibles eligibility",
)
replace_once(
    "src/lib/ebay-authoritative-store-sync.ts",
    "    !isSportsCardListing({",
    "    !isCollectibleListing({",
    "authoritative collectibles eligibility call",
)
replace_once(
    "src/lib/ebay-authoritative-store-sync.ts",
    '''export const ebayAuthoritativeStoreSyncTestHelpers = {
  parseRemoteListing,
  isSportsCardListing,
  normalizedText,
};
''',
    '''export const ebayAuthoritativeStoreSyncTestHelpers = {
  parseRemoteListing,
  isCollectibleListing,
  // Compatibility alias for existing diagnostics.
  isSportsCardListing: isCollectibleListing,
  normalizedText,
};
''',
    "authoritative collectibles test helper",
)
replace_once(
    "src/lib/ebay-authoritative-store-sync.ts",
    '               ? "Storefront taxonomy version 2 refresh is required."',
    '               ? "Storefront taxonomy version 3 collectibles refresh is required."',
    "authoritative refresh reason version 3",
)
replace_once(
    "src/lib/ebay-authoritative-store-sync.ts",
    '''  eligibleSportsCards: number;
  skippedNonCards: number;
''',
    '''  eligibleCollectibles: number;
  skippedNonCollectibles: number;
  eligibleSportsCards: number;
  skippedNonCards: number;
''',
    "authoritative result collectible counters",
)
replace_once(
    "src/lib/ebay-authoritative-store-sync.ts",
    '''    eligibleSportsCards: remote.listings.length,
    skippedNonCards: Math.max(
      remote.remoteItemsRead - remote.listings.length,
      0,
    ),
''',
    '''    eligibleCollectibles: remote.listings.length,
    skippedNonCollectibles: Math.max(
      remote.remoteItemsRead - remote.listings.length,
      0,
    ),
    // Backward-compatible aliases for existing admin receipts.
    eligibleSportsCards: remote.listings.length,
    skippedNonCards: Math.max(
      remote.remoteItemsRead - remote.listings.length,
      0,
    ),
''',
    "authoritative return collectible counters",
)

replace_once(
    "src/app/shop/page.tsx",
    '  title: "Shop Sports Cards",',
    '  title: "Shop Sports Cards & Collectibles",',
    "shop metadata title",
)
replace_once(
    "src/app/shop/page.tsx",
    '    "Shop live sports-card inventory from Truely Collectables by player, sport, league, rookie, autograph, grade, parallel, or card number.",',
    '    "Shop live sports cards, autographs, memorabilia, pucks, balls, jerseys, comics, coins, toys, and other collectibles from Truely Collectables.",',
    "shop metadata description",
)
replace_once(
    "src/app/shop/page.tsx",
    'const QUICK_SECTIONS = ["Baseball", "WNBA", "Basketball", "Football", "Hockey"];',
    'const QUICK_SECTIONS = ["Baseball", "WNBA", "Basketball", "Football", "Hockey", "Pucks", "Balls", "Jerseys", "Photos & Prints", "Memorabilia"];',
    "shop collectible quick sections",
)
replace_once(
    "src/app/shop/page.tsx",
    '  return params.section || "Shop Sports Cards";',
    '  return params.section || "Shop Sports Cards & Collectibles";',
    "shop default heading",
)
replace_once(
    "src/app/shop/page.tsx",
    '''             Sports stay in their correct section. Autographs, rookies, graded cards,
             and numbered cards can be filtered across every sport.
''',
    '''             Cards and memorabilia stay in their correct section. Autographs can be
             filtered across sports cards, pucks, balls, jerseys, photos, and more.
''',
    "shop collectible intro",
)
replace_once(
    "src/app/shop/page.tsx",
    "          {products.length.toLocaleString()} active cards",
    "          {products.length.toLocaleString()} active cards & collectibles",
    "shop collectible count",
)
replace_once(
    "src/app/shop/page.tsx",
    '      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Popular card sections">',
    '      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Popular collectible sections">',
    "shop collectible nav label",
)
replace_once(
    "src/app/shop/page.tsx",
    "          All Cards",
    "          All Cards & Collectibles",
    "shop all label",
)
replace_once(
    "src/app/shop/page.tsx",
    '          placeholder="Player, set, team, card number..."',
    '          placeholder="Player, team, set, item, card number..."',
    "shop collectible search placeholder",
)
replace_once(
    "src/app/shop/page.tsx",
    '          <option value="">All Card Types</option>',
    '          <option value="">All Features</option>',
    "shop feature label",
)
replace_once(
    "src/app/shop/page.tsx",
    '{products.length === 0 ? <p className="text-gray-600">No cards found.</p> : null}',
    '{products.length === 0 ? <p className="text-gray-600">No cards or collectibles found.</p> : null}',
    "shop empty state",
)
replace_once(
    "src/app/shop/page.tsx",
    '{product.player || product.league || "Sports Card"}',
    '{product.player || product.league || product.category?.replaceAll("_", " ") || "Collectible"}',
    "shop collectible fallback label",
)
replace_once(
    "src/app/shop/page.tsx",
    "                  View Card",
    "                  View Item",
    "shop item CTA",
)

home_replacements = [
    ("Real cards · live inventory · ready to ship", "Real cards & collectibles · live inventory · ready to ship", "home live catalog eyebrow"),
    ("Find the card your collection is missing.", "Find the collectible your collection is missing.", "home collectible headline"),
    ("active sports cards from", "active cards & collectibles from", "home collectible count copy"),
    ("Search sports cards", "Search cards and collectibles", "home search label"),
    ("Search player, set, team, card number...", "Search player, team, card, puck, jersey, autograph...", "home search placeholder"),
    ("Search Cards", "Search Inventory", "home search CTA"),
    ("New cards on the wall", "New collectibles on the wall", "home fresh inventory title"),
    ("Shop every card →", "Shop every collectible →", "home shop all CTA"),
    ('{card.storefrontSection || "Sports Card"}', '{card.storefrontSection || "Collectible"}', "home collectible fallback"),
    ("Shop by sport", "Shop by section", "home section heading"),
    ("active cards</p>", "active items</p>", "home section count"),
    ("Built to sell cards", "Built to sell collectibles", "home closing eyebrow"),
]
for old, new, label in home_replacements:
    replace_once("src/app/page.tsx", old, new, label)

replace_once(
    "scripts/run-storefront-taxonomy-regressions.ts",
    'import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";\n',
    'import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";\nimport { isLaunchCollectible } from "../src/lib/sports-card-launch-scope";\n',
    "collectibles scope regression import",
)
replace_once(
    "scripts/run-storefront-taxonomy-regressions.ts",
    '''console.log("Storefront taxonomy regressions passed.");
''',
    r'''const signedPuck = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>2000000001</ItemID>
  <ListingType>FixedPriceItem</ListingType>
  <Title>Wayne Gretzky Signed NHL Hockey Puck JSA COA</Title>
  <StartPrice>149.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/puck/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>108911</CategoryID><CategoryName>Sports Memorabilia</CategoryName></PrimaryCategory>
  <ItemSpecifics>
    <NameValueList><Name>Sport</Name><Value>Ice Hockey</Value></NameValueList>
    <NameValueList><Name>Autographed</Name><Value>Yes</Value></NameValueList>
    <NameValueList><Name>Autograph Authentication</Name><Value>James Spence (JSA)</Value></NameValueList>
  </ItemSpecifics>
</Item>`);
assert.ok(signedPuck);
assert.equal(signedPuck.sport, "Pucks");
assert.equal(signedPuck.storefrontMetadata.tcos_is_autograph, true);

const signedJersey = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>2000000002</ItemID>
  <ListingType>FixedPriceItem</ListingType>
  <Title>Peyton Manning Autographed Denver Broncos Jersey Beckett COA</Title>
  <StartPrice>249.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/jersey/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>27277</CategoryID><CategoryName>Football-NFL Autographed Items</CategoryName></PrimaryCategory>
  <ItemSpecifics>
    <NameValueList><Name>Sport</Name><Value>Football</Value></NameValueList>
    <NameValueList><Name>Autographed</Name><Value>Yes</Value></NameValueList>
  </ItemSpecifics>
</Item>`);
assert.ok(signedJersey);
assert.equal(signedJersey.sport, "Jerseys");
assert.equal(signedJersey.storefrontMetadata.tcos_is_autograph, true);

const ordinaryJersey = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>2000000003</ItemID>
  <ListingType>FixedPriceItem</ListingType>
  <Title>Denver Broncos Nike Jersey Men's Size XL</Title>
  <StartPrice>39.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/apparel/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>24409</CategoryID><CategoryName>Clothing, Shoes & Accessories</CategoryName></PrimaryCategory>
  <ItemSpecifics><NameValueList><Name>Sport</Name><Value>Football</Value></NameValueList></ItemSpecifics>
</Item>`);
assert.equal(ordinaryJersey, null);

const shoes = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>2000000004</ItemID><ListingType>FixedPriceItem</ListingType>
  <Title>Adidas Running Shoes Men's Size 11</Title><StartPrice>49.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/shoes/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>15709</CategoryID><CategoryName>Athletic Shoes</CategoryName></PrimaryCategory>
</Item>`);
assert.equal(shoes, null);

const autoPart = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>2000000005</ItemID><ListingType>FixedPriceItem</ListingType>
  <Title>Mass Air Flow Fuel Sensor Replacement Auto Part</Title><StartPrice>24.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/part/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>33557</CategoryID><CategoryName>Auto Parts & Accessories</CategoryName></PrimaryCategory>
</Item>`);
assert.equal(autoPart, null);

const comic = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
<Item>
  <ItemID>2000000006</ItemID><ListingType>FixedPriceItem</ListingType>
  <Title>Amazing Spider-Man #300 First Venom Comic Book</Title><StartPrice>299.99</StartPrice><Quantity>1</Quantity>
  <PictureDetails><GalleryURL>https://i.ebayimg.com/images/g/comic/s-l1600.jpg</GalleryURL></PictureDetails>
  <PrimaryCategory><CategoryID>63</CategoryID><CategoryName>Comic Books & Memorabilia</CategoryName></PrimaryCategory>
</Item>`);
assert.ok(comic);
assert.equal(comic.sport, "Comics");

assert.equal(
  isLaunchCollectible({
    title: "Wayne Gretzky Signed Hockey Puck JSA",
    sport: "Pucks",
    storefrontSection: "Pucks",
    category: "memorabilia",
    features: { autograph: true, rookie: false, graded: false, numbered: false },
  }),
  true,
);
assert.equal(
  isLaunchCollectible({
    title: "Denver Broncos Nike T-Shirt Size XL",
    sport: "Football",
    storefrontSection: "Football",
    category: "memorabilia",
    features: { autograph: false, rookie: false, graded: false, numbered: false },
  }),
  false,
);
assert.equal(
  isLaunchCollectible({
    title: "Fuel Sensor Auto Part",
    sport: "Other Collectables",
    storefrontSection: "Other Collectables",
    category: "other_collectable",
    features: { autograph: false, rookie: false, graded: false, numbered: false },
  }),
  false,
);

console.log("Storefront taxonomy regressions passed.");
''',
    "collectibles catalog regressions",
)

replace_once(
    ".github/workflows/storefront-taxonomy.yml",
    '      - "src/lib/ebay-authoritative-store-sync.ts"\n      - "src/lib/server-inventory-engine.ts"',
    '      - "src/lib/ebay-authoritative-store-sync.ts"\n      - "src/lib/sports-card-launch-scope.ts"\n      - "src/lib/server-inventory-engine.ts"',
    "taxonomy push path for launch scope",
)
replace_once(
    ".github/workflows/storefront-taxonomy.yml",
    '      - "src/lib/ebay-authoritative-store-sync.ts"\n      - "src/lib/server-inventory-engine.ts"',
    '      - "src/lib/ebay-authoritative-store-sync.ts"\n      - "src/lib/sports-card-launch-scope.ts"\n      - "src/lib/server-inventory-engine.ts"',
    "taxonomy PR path for launch scope",
)
replace_once(
    ".github/workflows/storefront-taxonomy.yml",
    '''          src/lib/ebay-authoritative-store-sync.ts
          src/lib/server-inventory-engine.ts
''',
    '''          src/lib/ebay-authoritative-store-sync.ts
          src/lib/sports-card-launch-scope.ts
          src/lib/server-inventory-engine.ts
''',
    "taxonomy lint launch scope",
)

print("Collectibles catalog expansion patch complete.")
