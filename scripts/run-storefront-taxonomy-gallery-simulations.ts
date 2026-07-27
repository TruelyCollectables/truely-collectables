import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canonicalStorefrontCategory,
  matchesStorefrontCategory,
  matchesStorefrontQuery,
  sortStorefrontCategories,
  storefrontCategoryForItem,
} from "../src/lib/storefront-taxonomy";
import type { UniversalInventoryItem } from "../src/modules/inventory";

function item(overrides: Partial<UniversalInventoryItem>): UniversalInventoryItem {
  return {
    inventoryItemId: "00000000-0000-4000-8000-000000000001",
    legacyProductId: 1,
    sellerAccountId: null,
    sku: "TEST-1",
    title: "Test card",
    description: null,
    player: null,
    sport: "Sports Cards",
    price: 10,
    quantity: 1,
    imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",
    ebayItemId: "123",
    status: "active",
    source: "inventory_items",
    authenticity: {
      status: "not_applicable",
      autographSource: "none",
      certProvider: null,
      certNumber: null,
      guaranteedAuthenticators: [],
      provenanceEvidence: null,
      authenticityNotes: null,
    },
    ...overrides,
  };
}

for (const rawSport of [
  "Basketball",
  "Basketball Cards",
  "Men's Basketball",
  "Mens Basketball",
  "NBA",
  "NBA Basketball",
]) {
  assert.equal(
    storefrontCategoryForItem(item({ sport: rawSport })),
    "Basketball",
    `${rawSport} must collapse into the single Basketball category.`,
  );
}

const explicitWnba = item({
  title: "2025 Panini Prizm WNBA Caitlin Clark Silver",
  player: "Caitlin Clark",
  sport: "Basketball",
});
const teamWnba = item({
  title: "2026 Select Paige Bueckers Dallas Wings Courtside",
  player: "Paige Bueckers",
  sport: "Basketball Cards",
});
const currentExpansionWnba = item({
  title: "2026 Toronto Tempo Rookie Card",
  sport: "Sports Cards",
});
const nba = item({
  title: "2025 Prizm Luka Doncic Los Angeles Lakers",
  sport: "Men's Basketball",
});

for (const wnbaCard of [explicitWnba, teamWnba, currentExpansionWnba]) {
  assert.equal(storefrontCategoryForItem(wnbaCard), "WNBA");
  assert.equal(matchesStorefrontQuery(wnbaCard, "WNBA"), true);
  assert.equal(matchesStorefrontCategory(wnbaCard, "WNBA"), true);
  assert.equal(matchesStorefrontCategory(wnbaCard, "Basketball"), false);
}
assert.equal(storefrontCategoryForItem(nba), "Basketball");
assert.equal(matchesStorefrontQuery(nba, "WNBA"), false);
assert.equal(matchesStorefrontCategory(nba, "Basketball Cards"), true);
assert.equal(canonicalStorefrontCategory("Men's Basketball"), "Basketball");
assert.equal(canonicalStorefrontCategory("WNBA"), "WNBA");

assert.deepEqual(
  sortStorefrontCategories([
    "Basketball",
    "WNBA",
    "Basketball",
    "Hockey",
    "Baseball",
  ]),
  ["Baseball", "Basketball", "WNBA", "Hockey"],
  "Category options must be unique and stable.",
);

const serverEngine = fs.readFileSync("src/lib/server-inventory-engine.ts", "utf8");
for (const token of [
  "matchesStorefrontQuery",
  "matchesStorefrontCategory",
  "storefrontCategoryForItem",
  "sortStorefrontCategories",
]) {
  assert.ok(serverEngine.includes(token), `Storefront engine is missing ${token}.`);
}
assert.ok(
  serverEngine.includes("await super.listAvailable()"),
  "Search must classify the complete live inventory before filtering.",
);

const shop = fs.readFileSync("src/app/shop/page.tsx", "utf8");
assert.ok(shop.includes("storefrontCategoryForItem"));
assert.ok(shop.includes("including WNBA") || shop.includes("including WNBA."));
assert.ok(shop.includes("All Categories"));
assert.doesNotMatch(shop, /Collector research links|exact-match signals/i);

const home = fs.readFileSync("src/app/page.tsx", "utf8");
assert.ok(home.includes("storefrontCategoryForItem"));
assert.ok(home.includes('["WNBA", "/shop?sport=WNBA"]'));
assert.doesNotMatch(
  home,
  /const sport = product\.sport\?\.trim\(\)/,
  "Homepage categories must not use raw imported sport labels.",
);

const productPage = fs.readFileSync("src/app/product/[id]/page.tsx", "utf8");
for (const token of [
  '.from("inventory_images")',
  "metadata.ebay_image_urls",
  "metadata.image_urls",
  "metadata.source_image_urls",
  "normalizeListingImageUrls",
  "galleryImages.map",
  "listingImageLabel",
  "<OfferForm",
]) {
  assert.ok(productPage.includes(token), `Product page is missing ${token}.`);
}
assert.doesNotMatch(productPage, /Collector Intelligence/);
assert.doesNotMatch(productPage, /Research before you make it yours/);
assert.doesNotMatch(productPage, /buildCollectorIntelligence/);
assert.doesNotMatch(productPage, /group-hover:scale|animate-|blur-3xl/);
assert.ok(
  productPage.indexOf("<OfferForm") < productPage.lastIndexOf("</main>"),
  "Shoot Me an Offer must remain on the simplified product page.",
);

const offerForm = fs.readFileSync("src/app/product/[id]/OfferForm.tsx", "utf8");
assert.ok(offerForm.includes("Shoot Me an Offer"));

console.log(
  "Storefront taxonomy and gallery simulations passed: one Basketball category, searchable WNBA, shared homepage/shop taxonomy, every saved image source rendered, and no product-page intelligence tail.",
);
