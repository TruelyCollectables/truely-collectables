import assert from "node:assert/strict";
import fs from "node:fs";

const navbar = fs.readFileSync("src/app/components/Navbar.tsx", "utf8");
const footer = fs.readFileSync("src/app/components/Footer.tsx", "utf8");
const soldPage = fs.readFileSync("src/app/recently-sold/page.tsx", "utf8");
const gallery = fs.readFileSync("src/app/components/ProductImageGallery.tsx", "utf8");
const productPage = fs.readFileSync("src/app/product/[id]/page.tsx", "utf8");
const productLayout = fs.readFileSync("src/app/product/[id]/layout.tsx", "utf8");

assert.match(navbar, /href: "\/recently-sold", label: "Recently Sold"/);
assert.match(footer, /href="\/recently-sold"/);
assert.match(soldPage, /Recently Sold — See What You Missed/);
assert.match(soldPage, /listRecentSoldStorefrontItems/);
assert.match(gallery, /selectFrontBackListingImages/);
assert.match(gallery, /inventory_images/);
assert.match(gallery, /listingImageLabel/);
assert.match(gallery, /front and back photos/);
assert.match(productPage, /ProductImageGallery/);
assert.match(productLayout, /ProductImageGallery/);

const tcosCollectorIntelligenceSignals = [
  /buildCollectorIntelligence/,
  /collector-intelligence/,
  /Collector Intelligence/,
  /Collector Research Page/,
  /Research before you make it yours/,
  /TCOS only shows a public trend/,
];

for (const signal of tcosCollectorIntelligenceSignals) {
  assert.doesNotMatch(productPage, signal);
}

assert.doesNotMatch(productPage, /TCOS shows the seller/);
assert.match(productPage, /Truely Collectables shows the seller/);

console.log(
  JSON.stringify(
    {
      ok: true,
      recentlySoldNavigation: true,
      publicRecentlySoldPage: true,
      activeProductFrontBackGallery: true,
      soldProductFrontBackGallery: true,
      truelyProductPageExcludesTcosCollectorIntelligence: true,
    },
    null,
    2,
  ),
);
