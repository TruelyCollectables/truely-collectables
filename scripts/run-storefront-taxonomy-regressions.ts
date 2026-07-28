import assert from "node:assert/strict";
import { mapEbayInventoryCategory } from "../src/lib/ebay-category-mapper";
import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";
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

console.log("Storefront taxonomy regressions passed.");
