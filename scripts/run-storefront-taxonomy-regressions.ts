import assert from "node:assert/strict";
import { mapEbayInventoryCategory } from "../src/lib/ebay-category-mapper";
import { ebayAuthoritativeStoreSyncTestHelpers } from "../src/lib/ebay-authoritative-store-sync";
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

console.log("Storefront taxonomy regressions passed.");
