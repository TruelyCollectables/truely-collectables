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
  sortStorefrontSections,
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

const nba = classifyStorefrontItem({
  title: "2024-25 Panini Prizm LeBron James",
  rawSport: "Basketball",
  primaryCategory: "sports_cards",
  aspects: { League: ["National Basketball Association (NBA)"] },
});
assert.equal(nba.section, "NBA");

const collegeBasketball = classifyStorefrontItem({
  title: "2024 Bowman University Basketball Prospect",
  rawSport: "Basketball",
  primaryCategory: "sports_cards",
  aspects: { League: ["NCAA"] },
});
assert.equal(collegeBasketball.section, "Basketball");

const staleAutoRacing = classifyStorefrontItem({
  title: "2024 Panini Prizm NASCAR Auto Racing Card",
  rawSport: "Auto Racing",
  primaryCategory: "sports_cards",
  metadata: {
    tcos_storefront_section: "Autographs",
    tcos_is_autograph: true,
    tcos_taxonomy_version: 4,
    source_aspects: { Autographed: ["No"], Sport: ["Auto Racing"] },
  },
});
assert.equal(staleAutoRacing.section, "Racing / NASCAR");
assert.equal(staleAutoRacing.features.autograph, false);

const facsimile = classifyStorefrontItem({
  title: "Babe Ruth Facsimile Signature Reprint Photo",
  primaryCategory: "autographs",
  aspects: { Autographed: ["No"] },
});
assert.equal(facsimile.section, "Photos & Prints");
assert.equal(facsimile.features.autograph, false);

const musicBooklet = classifyStorefrontItem({
  title: "Beastie Boys Signed CD Booklet JSA COA",
  primaryCategory: "music",
  aspects: { Autographed: ["Yes"], "Signed By": ["Beastie Boys"] },
});
assert.equal(musicBooklet.section, "Music");
assert.equal(musicBooklet.features.autograph, true);

const unsignedMusic = classifyStorefrontItem({
  title: "Beastie Boys CD Booklet",
  primaryCategory: "music",
  aspects: { Autographed: ["No"] },
});
assert.equal(unsignedMusic.section, "Music");
assert.equal(unsignedMusic.features.autograph, false);

const puckRelicCard = classifyStorefrontItem({
  title: "2024 Upper Deck Hockey Puck Relic Card",
  rawSport: "Ice Hockey",
  primaryCategory: "sports_cards",
});
assert.equal(puckRelicCard.section, "Hockey");

const nonAutoSuperfractor = classifyStorefrontItem({
  title:
    "2013 Bowman Platinum Prospects Justin Nicolino Superfractor /1 BGS 9.5 Non Auto",
  rawSport: "Baseball",
  primaryCategory: "sports_cards",
  aspects: { Autographed: ["No"] },
});
assert.equal(nonAutoSuperfractor.section, "Baseball");
assert.equal(nonAutoSuperfractor.features.autograph, false);

const skyboxJerseyCard = classifyStorefrontItem({
  title: "2004 SkyBox LE #20 Josh Beckett PINSTRIPE Jersey Proof /299",
  rawSport: "Baseball",
  primaryCategory: "memorabilia",
});
assert.equal(skyboxJerseyCard.section, "Baseball");

const spGameUsedJerseyCard = classifyStorefrontItem({
  title:
    "2017-18 SP Game Used #FW-JQ Jonathan Quick Frameworks Jumbo Jersey Relic",
  rawSport: "Ice Hockey",
  primaryCategory: "memorabilia",
});
assert.equal(spGameUsedJerseyCard.section, "Hockey");

const staleV5JerseyCard = classifyStorefrontItem({
  title: "2025-26 SP Game Used #100 Peter Forsberg Red Jersey",
  rawSport: "Ice Hockey",
  primaryCategory: "memorabilia",
  metadata: { tcos_storefront_section: "Jerseys", tcos_taxonomy_version: 5 },
});
assert.equal(staleV5JerseyCard.section, "Hockey");

const actualPuck = classifyStorefrontItem({
  title: "Colorado Avalanche Official Hockey Puck",
  rawSport: "Ice Hockey",
  primaryCategory: "memorabilia",
});
assert.equal(actualPuck.section, "Pucks");

const wearableJersey = classifyStorefrontItem({
  title: "Peyton Manning Signed Denver Broncos Jersey Size XL",
  rawSport: "Football",
  primaryCategory: "memorabilia",
  aspects: { Autographed: ["Yes"] },
});
assert.equal(wearableJersey.section, "Jerseys");

const musicMapping = mapEbayInventoryCategory({
  title: "Beastie Boys Signed CD Booklet JSA COA",
  aspects: { Autographed: ["Yes"] },
});
assert.equal(musicMapping.category, "music");
assert.equal(musicMapping.attributes.tcos_is_autograph, "true");

const racingMapping = mapEbayInventoryCategory({
  title: "2024 Panini NASCAR Auto Racing Card",
  aspects: { Autographed: ["No"], Sport: ["Auto Racing"] },
});
assert.equal(racingMapping.attributes.tcos_is_autograph, "false");

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

const authoritativeWnba =
  ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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
assert.equal(
  authoritativeWnba.storefrontAttributes.tcos_storefront_section,
  "WNBA",
);

const inventory = [
  {
    legacyProductId: 1,
    title: "NBA Base",
    player: "Z Player",
    price: 5,
    storefrontSection: "NBA",
    features: {
      autograph: false,
      memorabilia: false,
      rookie: false,
      graded: false,
      numbered: false,
    },
  },
  {
    legacyProductId: 2,
    title: "Baseball Signed",
    player: "A Player",
    price: 10,
    storefrontSection: "Baseball",
    features: {
      autograph: true,
      memorabilia: false,
      rookie: false,
      graded: false,
      numbered: false,
    },
  },
  {
    legacyProductId: 3,
    title: "WNBA Signed",
    player: "C Player",
    price: 20,
    storefrontSection: "WNBA",
    features: {
      autograph: true,
      memorabilia: false,
      rookie: true,
      graded: false,
      numbered: false,
    },
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
  [2, 1, 3],
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

const ordinaryJersey =
  ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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
    features: {
      autograph: true,
      memorabilia: false,
      rookie: false,
      graded: false,
      numbered: false,
    },
  }),
  true,
);
assert.equal(
  isLaunchCollectible({
    title: "Denver Broncos Nike T-Shirt Size XL",
    sport: "Football",
    storefrontSection: "Football",
    category: "memorabilia",
    features: {
      autograph: false,
      memorabilia: false,
      rookie: false,
      graded: false,
      numbered: false,
    },
  }),
  false,
);
assert.equal(
  isLaunchCollectible({
    title: "Fuel Sensor Auto Part",
    sport: "Other Collectables",
    storefrontSection: "Other Collectables",
    category: "other_collectable",
    features: {
      autograph: false,
      memorabilia: false,
      rookie: false,
      graded: false,
      numbered: false,
    },
  }),
  false,
);

assert.equal(
  isLaunchCollectible({
    title: "Oakley Sports Sunglasses Black",
    sport: "Watches & Accessories",
    storefrontSection: "Watches & Accessories",
  }),
  true,
);
assert.equal(
  isLaunchCollectible({
    title: "Collectible Wristwatch",
    sport: "Watches & Accessories",
    storefrontSection: "Watches & Accessories",
  }),
  true,
);

const hockeyJerseyRelicCard =
  ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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

const authoritativeHockeyCard =
  ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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

const authoritativePokemonCard =
  ebayAuthoritativeStoreSyncTestHelpers.parseRemoteListing(`
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
assert.deepEqual(
  [...EBAY_MERGED_LISTING_GROUPS[0].aliasItemIds],
  ["317570836168", "317570836334"],
);
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
  authoritativeSyncSource.includes(".range(from, from + LOCAL_PAGE_SIZE - 1);"),
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

const taxonomyV7Cases = [
  ["1993-94 Stadium Club #17 Nick Van Exel Beam Team Members Only", "NBA"],
  ["1997-98 Leaf #6 Paul Kariya Fractal Matrix Die Cuts SSP", "Hockey"],
  ["2001 SP Authentic #31 Peter Jacobsen Gold #/500", "Golf"],
  [
    "2006 Razor WPT Showdown Signatures Hoyt Corkins WSOP Royalty SSP Auto",
    "Poker",
  ],
  ["2013 Leaf Keeping It Real Autos Bam Margera RC SP /25", "Skateboarding"],
  ["2025 Score #35 Jaxson Dart Red", "Football"],
  [
    "2025 Topps Chrome Update John Rave RC Auto Orange Refractors /25",
    "Baseball",
  ],
  ["2025-26 SkyBox Metal Universe #150 Ivan Demidov", "Hockey"],
  ["2026 Donruss #1 Paige Bueckers Donruss Ballpark Stars RC", "WNBA"],
  ["ME05: Pitch Black #077/084 Gladion's Final Battle", "Trading Card Games"],
  ["Prize Pack Series Cards #005 Basic Psychic Energy", "Trading Card Games"],
  [
    "Saturn Automotive GM Dealer Quartz Wristwatch Water Resistant Japan Movement NEW",
    "Watches & Accessories",
  ],
  [
    "NOAH HANIFIN Limited Edition 2024 Preseason Pin Vegas Golden Knights SGA NEW",
    "Pins & Souvenirs",
  ],
  [
    "Vegas Golden Knights vanity license plate for player Alex Tuch TUCH",
    "Signs & Display",
  ],
  ["The Beastie Boys ALL 3 Signed CD Booklet PSA Authenticated", "Music"],
  [
    "2024 POP CENTURY RETRO TV AUTO ED MARINARO 1/1 AUTOGRAPH HILL STREET BLUES",
    "Entertainment & Pop Culture",
  ],
] as const;

for (const [title, expectedSection] of taxonomyV7Cases) {
  const result = classifyStorefrontItem({
    title,
    primaryCategory: "other_collectable",
  });
  assert.equal(result.section, expectedSection, title);
  assert.ok(
    !["Other Collectables", "Other Sports", "Memorabilia"].includes(
      result.section,
    ),
  );
}

const baseballJerseyCard = classifyStorefrontItem({
  title: "2004 SkyBox LE #20 Josh Beckett PINSTRIPE Jersey Proof /299",
  rawSport: "Baseball",
  primaryCategory: "memorabilia",
});
assert.equal(baseballJerseyCard.section, "Baseball");
assert.equal(baseballJerseyCard.features.memorabilia, true);

const hockeyRelicCard = classifyStorefrontItem({
  title:
    "2017-18 SP Game Used #FW-JQ Jonathan Quick Frameworks Jumbo Jersey Relic",
  rawSport: "Ice Hockey",
  primaryCategory: "memorabilia",
});
assert.equal(hockeyRelicCard.section, "Hockey");
assert.equal(hockeyRelicCard.features.memorabilia, true);

const gradedBaseball = classifyStorefrontItem({
  title: "1989 Upper Deck #13 Gary Sheffield RC PSA 10",
  primaryCategory: "sports_cards",
});
assert.equal(gradedBaseball.section, "Baseball");
assert.equal(gradedBaseball.features.graded, true);
assert.equal(gradedBaseball.features.rookie, true);

const multiFeatureCard = classifyStorefrontItem({
  title:
    "2025 Panini Origins Shedeur Sanders RC Jumbo Patch Auto Pink RPA FOTL /12 PSA 9",
  primaryCategory: "sports_cards",
});
assert.equal(multiFeatureCard.section, "Football");
assert.equal(multiFeatureCard.features.autograph, true);
assert.equal(multiFeatureCard.features.memorabilia, true);
assert.equal(multiFeatureCard.features.graded, true);
assert.equal(multiFeatureCard.features.rookie, true);
assert.equal(multiFeatureCard.features.numbered, true);
assert.equal(
  matchesStorefrontFilters(
    {
      legacyProductId: 900001,
      title: "2004 SkyBox LE #20 Josh Beckett PINSTRIPE Jersey Proof /299",
      price: 1,
      storefrontSection: baseballJerseyCard.section,
      features: baseballJerseyCard.features,
    },
    { feature: "memorabilia cards" },
  ),
  true,
);
assert.deepEqual(
  sortStorefrontSections([
    "Other Sports",
    "Baseball",
    "Memorabilia",
    "Other Collectables",
    "Hockey",
    "Needs Review",
  ]),
  ["Baseball", "Hockey"],
);

const taxonomyV8Cases = [
  ["2024-25 Artifacts Spectrum Jungle Seth Jones SSP /15 Blackhawks", "Hockey"],
  [
    "Oakley Fuel Cell Desolve Bare Camo Prizm Tungsten Lens 9096 I760 60 90 130",
    "Watches & Accessories",
  ],
  [
    "2023-24 Credentials #DTAA-MK Marco Kasper Debut Ticket Access Auto /199",
    "Hockey",
  ],
  [
    "2023-24 Credentials Connor Bedard RC Debut Ticket Blue Horizontal Variation /199",
    "Hockey",
  ],
  [
    "2024-25 SP Authentic Danil Gushchin Retro Autographed Future Watch /699",
    "Hockey",
  ],
  [
    "2022-23 SP Authentic Mads Sogaard Retro Future Watch Autographs /699",
    "Hockey",
  ],
  ["18-19 Spectra Nick Van Exel Making it Rain Auto Neon Pink /25", "NBA"],
  [
    "2014-15 Flawless Nick Van Exel Momentous Autographed Memorabilia /20",
    "NBA",
  ],
  [
    "2019-20 O-Pee-Chee Platinum #R-91 Cody Glass Retro-Black-Pack-Wars",
    "Hockey",
  ],
  ["Prize Pack Series Cards #005 Basic Psychic Energy", "Trading Card Games"],
  ["2015-16 Hoops #54 Luol Deng Artist Proof #/99", "NBA"],
] as const;

for (const [title, expectedSection] of taxonomyV8Cases) {
  const result = classifyStorefrontItem({
    title,
    primaryCategory: "other_collectable",
    metadata: {
      tcos_storefront_section: "Needs Review",
      tcos_taxonomy_version: 7,
    },
  });
  assert.equal(result.section, expectedSection, title);
}

const v8FeatureCases = [
  {
    title:
      "2015 Topps Museum Collection Henderson Alvarez Momentous Material Autos /10",
    section: "Baseball",
    expected: { autograph: true, memorabilia: true, numbered: true },
  },
  {
    title:
      "2013-14 Panini Timeless Treasures #18 Nick Van Exel Treasured Ink /15",
    section: "NBA",
    expected: { autograph: true, numbered: true },
  },
  {
    title:
      "2017-18 OPC Platinum Rookie Autos Ivan Barbashev Orange Checkers /15 RC HGA 9",
    section: "Hockey",
    expected: { autograph: true, rookie: true, graded: true, numbered: true },
  },
  {
    title:
      "2007 Upper Deck Premier #PS-69 Maurice Jones-Drew Stitchings Variation /75",
    section: "Football",
    expected: { memorabilia: true, numbered: true },
  },
  {
    title: "2023-24 SP Game Used #150 Nathan MacKinnon Jersey",
    section: "Hockey",
    expected: { memorabilia: true },
  },
  {
    title:
      "2012 SP Authentic #20 Paula Creamer Base Limited Auto & Swatch #/100",
    section: "Golf",
    expected: { autograph: true, memorabilia: true, numbered: true },
  },
  {
    title:
      "2008 RAFO WRESTLING KECERI STICKERS #137 Stone Cold Steve Austin CSG 5",
    section: "Wrestling",
    expected: { graded: true },
  },
  {
    title: "2023-24 Hoops #RR-PAO Paolo Banchero Rookie Remembrance",
    section: "NBA",
    expected: { rookie: true, memorabilia: true },
  },
  {
    title: "2013 Leaf Keeping It Real Autos Bam Margera RC SP /25",
    section: "Skateboarding",
    expected: { autograph: true, rookie: true, numbered: true },
  },
  {
    title: "2011 Finest #44 Mike Stanton Orange Refractors #/99",
    section: "Baseball",
    expected: { numbered: true },
  },
] as const;

for (const testCase of v8FeatureCases) {
  const result = classifyStorefrontItem({
    title: testCase.title,
    rawSport: testCase.section,
    primaryCategory: "sports_cards",
    metadata: { tcos_taxonomy_version: 7 },
  });
  for (const [feature, expected] of Object.entries(testCase.expected)) {
    assert.equal(
      result.features[feature as keyof typeof result.features],
      expected,
      `${testCase.title} ${feature}`,
    );
  }
}

const pokemonSetNumber = classifyStorefrontItem({
  title: "ME05: Pitch Black #001/084 Tropius",
  primaryCategory: "trading_cards",
});
assert.equal(pokemonSetNumber.section, "Trading Card Games");
assert.equal(pokemonSetNumber.features.numbered, false);

const physicalBasketball = classifyStorefrontItem({
  title:
    "Michael Jordan Autographed Official NBA Basketball Upper Deck Authenticated",
  primaryCategory: "memorabilia",
});
assert.equal(physicalBasketball.section, "Balls");
assert.equal(physicalBasketball.features.memorabilia, false);

const oakleyProductionOverride = classifyStorefrontItem({
  title:
    "Oakley Fuel Cell Desolve Bare Camo Prizm Tungsten Lens 9096 I760 60 90 130",
  primaryCategory: "sports_cards",
  metadata: {
    tcos_storefront_section: "Needs Review",
    tcos_taxonomy_version: 8,
  },
});
assert.equal(oakleyProductionOverride.section, "Watches & Accessories");
assert.equal(oakleyProductionOverride.features.autograph, false);
assert.equal(oakleyProductionOverride.features.memorabilia, false);
assert.equal(oakleyProductionOverride.features.graded, false);
assert.equal(oakleyProductionOverride.features.rookie, false);

const oakleyMapperOverride = mapEbayInventoryCategory({
  title:
    "Oakley Fuel Cell Desolve Bare Camo Prizm Tungsten Lens 9096 I760 60 90 130",
});
assert.equal(oakleyMapperOverride.category, "other_collectable");
assert.equal(oakleyMapperOverride.confidence, "high");
assert.equal(oakleyMapperOverride.reviewRequired, false);

const futureWatchCardV9 = classifyStorefrontItem({
  title:
    "2024-25 SP Authentic Danil Gushchin Retro Autographed Future Watch /699",
  primaryCategory: "sports_cards",
  metadata: { tcos_taxonomy_version: 8 },
});
assert.equal(futureWatchCardV9.section, "Hockey");
assert.equal(futureWatchCardV9.features.autograph, true);
assert.equal(futureWatchCardV9.features.numbered, true);
