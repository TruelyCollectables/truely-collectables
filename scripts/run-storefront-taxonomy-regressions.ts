import assert from "node:assert/strict";
import fs from "node:fs";
import { mapEbayInventoryCategory } from "../src/lib/ebay-category-mapper";
import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";
import {
  EBAY_MERGED_LISTING_GROUPS,
  isMergedEbayAliasItemId,
  isMergedEbayCanonicalProductId,
} from "../src/lib/ebay-merged-listing-groups";
import { isLaunchCollectible } from "../src/lib/sports-card-launch-scope";
import {
  classifyStorefrontItem,
  matchesStorefrontFilters,
  sortStorefrontItems,
} from "../src/lib/storefront-taxonomy";

const wnbaAuto = {
  title: "2024 Panini Prizm WNBA Caitlin Clark Rookie Auto /25",
  rawSport: "Basketball",
  primaryCategory: "sports_cards",
  aspects: {
    League: ["Women's National Basketball Association (WNBA)"],
    Autographed: ["Yes"],
    Features: ["Rookie, Serial Numbered"],
  },
};

const wnba = classifyStorefrontItem(wnbaAuto);
assert.equal(wnba.section, "WNBA");
assert.equal(wnba.features.autograph, true);
assert.equal(wnba.features.rookie, true);
assert.equal(wnba.features.numbered, true);

const signedBaseball = mapEbayInventoryCategory({
  title: "2023 Topps Chrome Baseball Mike Trout Autograph Card",
  aspects: {
    Sport: ["Baseball"],
    Autographed: ["Yes"],
    Features: ["Autograph"],
  },
});
assert.equal(signedBaseball.category, "sports_cards");
assert.equal(signedBaseball.attributes.tcos_is_autograph, "true");

const baseball = classifyStorefrontItem({
  title: "2023 Topps Chrome Mike Trout Auto",
  rawSport: "Baseball",
  primaryCategory: signedBaseball.category,
  aspects: { Autographed: ["Yes"] },
});
assert.equal(baseball.section, "Baseball");
assert.equal(baseball.features.autograph, true);

const hockey = classifyStorefrontItem({
  title: "2024 Upper Deck Young Guns",
  rawSport: "Ice Hockey",
  primaryCategory: "sports_cards",
});
assert.equal(hockey.section, "Hockey");
assert.equal(hockey.features.rookie, true);

const authoritativeWnba = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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
  {
    legacyProductId: 1,
    title: "Basketball Base",
    player: "Z Player",
    price: 5,
    storefrontSection: "Basketball",
    features: { autograph: false, rookie: false, graded: false, numbered: false },
  },
  {
    legacyProductId: 2,
    title: "Baseball Signed",
    player: "A Player",
    price: 10,
    storefrontSection: "Baseball",
    features: { autograph: true, rookie: false, graded: false, numbered: false },
  },
  {
    legacyProductId: 3,
    title: "WNBA Signed",
    player: "C Player",
    price: 20,
    storefrontSection: "WNBA",
    features: { autograph: true, rookie: true, graded: false, numbered: false },
  },
];

assert.deepEqual(
  inventory
    .filter((item) => matchesStorefrontFilters(item, { feature: "autographs" }))
    .map((item) => item.legacyProductId),
  [2, 3],
);
assert.deepEqual(
  inventory
    .filter((item) => matchesStorefrontFilters(item, { section: "WNBA" }))
    .map((item) => item.legacyProductId),
  [3],
);
assert.deepEqual(
  sortStorefrontItems(inventory, "section").map((item) => item.legacyProductId),
  [2, 3, 1],
);

const signedPuck = ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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

assert.equal(
  isLaunchCollectible({ title: "Oakley Sports Sunglasses Black", sport: null }),
  true,
);
assert.equal(
  isLaunchCollectible({ title: "Collectible Wristwatch", sport: null }),
  true,
);


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

const authoritativeSyncSource = fs.readFileSync(
  "src/lib/ebay-authoritative-store-sync.ts",
  "utf8",
);
assert.match(
  authoritativeSyncSource,
  /function normalizedComparableText[\s\S]*\.normalize\("NFKC"\)/,
  "Equivalent Unicode and whitespace values must compare consistently.",
);
assert.match(
  authoritativeSyncSource,
  /function listingDifferences[\s\S]*differences\.push\("title"\)[\s\S]*differences\.push\("quantity"\)[\s\S]*differences\.push\("price"\)[\s\S]*differences\.push\("sport"\)/,
  "Field-level convergence diagnostics must remain deterministic.",
);
assert.ok(
  !authoritativeSyncSource.includes("listingImageIdentity(local.image_url)"),
  "Authoritative inventory and complete image reconciliation must not fight.",
);
assert.equal(EBAY_MERGED_LISTING_GROUPS[0].canonicalLegacyProductId, 1991);
assert.deepEqual([...EBAY_MERGED_LISTING_GROUPS[0].aliasItemIds], [
  "317570836168",
  "317570836334",
]);
assert.equal(isMergedEbayAliasItemId("317570836168"), true);
assert.equal(isMergedEbayCanonicalProductId(1991), true);
assert.match(
  authoritativeSyncSource,
  /function collapseMergedRemoteListings[\s\S]*mergedQuantity[\s\S]*mergedAliasListings/,
  "Merged eBay listings must aggregate into their canonical website inventory row.",
);
assert.ok(authoritativeSyncSource.includes("representedInventoryRows"));
assert.ok(
  authoritativeSyncSource.includes("const MAX_ACTIVE_LISTINGS = 3000;"),
  "Authoritative eBay inventory reads must stop at the approved 3,000-active-listing ceiling.",
);
assert.ok(
  authoritativeSyncSource.includes(
    "const MAX_PAGES = Math.ceil(MAX_ACTIVE_LISTINGS / PAGE_SIZE);",
  ),
  "The authoritative page limit must derive from the 3,000-listing ceiling.",
);
assert.match(
  authoritativeSyncSource,
  /<ActiveList>[\s\S]*<Include>true<\/Include>/,
  "The authoritative pull must request eBay's active-listing collection only.",
);
assert.match(
  authoritativeSyncSource,
  /if \(params\.deactivateEnded && remote\.cycleComplete\)/,
  "Ended or sold listings may be zeroed only after every capped active page was read.",
);
assert.ok(authoritativeSyncSource.includes("const LOCAL_PAGE_SIZE = 1000;"));
assert.ok(
  authoritativeSyncSource.includes(
    ".range(from, from + LOCAL_PAGE_SIZE - 1);",
  ),
);
assert.ok(
  authoritativeSyncSource.includes(
    "const locals = await readAllLocalProducts({",
  ),
);
assert.ok(
  authoritativeSyncSource.includes(
    "const changed = await deactivateLocalProduct({ ...params, local });",
  ),
);
assert.ok(authoritativeSyncSource.includes("if (changed) deactivated += 1;"));
assert.ok(authoritativeSyncSource.includes("return changed;"));
assert.ok(
  authoritativeSyncSource.includes(
    'syncErrorMessage(error, "Unknown sync failure.")',
  ),
);

console.log("Storefront taxonomy regressions passed.");


const scheduledSyncSource = fs.readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "utf8",
);
const fixedPriceBackfillSource = fs.readFileSync(
  "src/lib/ebay-fixed-price-backfill.ts",
  "utf8",
);
assert.match(
  scheduledSyncSource,
  /sync\.unchanged === sync\.representedInventoryRows/,
  "Cron convergence must use represented website rows rather than raw alias listings.",
);
assert.match(
  scheduledSyncSource,
  /expectedActiveLinkedProducts[\s\S]*representedInventoryRows/,
  "Database audit must expose the alias-aware expected row count.",
);
assert.match(
  fixedPriceBackfillSource,
  /isMergedEbayAliasItemId\(params\.listing\.itemId\)/,
  "Backfill must not recreate merged aliases.",
);
assert.match(
  fixedPriceBackfillSource,
  /isMergedEbayListingMember\(listing\)/,
  "Quantity reconciliation must leave merged listing groups to the authoritative aggregate sync.",
);
assert.match(
  authoritativeSyncSource,
  /const mergedAliasLocals = locals\.filter[\s\S]*isMergedEbayAliasItemId[\s\S]*deactivateLocalProduct/,
  "Authoritative sync must retire local rows for active merged aliases.",
);
