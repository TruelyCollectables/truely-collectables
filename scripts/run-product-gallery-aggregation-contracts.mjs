import assert from "node:assert/strict";
import fs from "node:fs";
import { prioritizeStorefrontProductImageRows } from "../src/lib/storefront-product-images.ts";

const rows = [
  {
    inventory_item_id: "shadow",
    image_url: "https://example.com/front.jpg",
    sort_order: 0,
    is_primary: true,
  },
  {
    inventory_item_id: "shadow",
    image_url: "https://example.com/back.jpg",
    sort_order: 1,
    is_primary: false,
  },
  {
    inventory_item_id: "preferred",
    image_url: "https://i.ebayimg.com/images/g/front/s-l1600.jpg",
    sort_order: 0,
    is_primary: true,
  },
];

assert.deepEqual(
  prioritizeStorefrontProductImageRows(rows, "preferred").map(
    (row) => row.inventory_item_id,
  ),
  ["preferred", "shadow", "shadow"],
);

const helper = fs.readFileSync(
  "src/lib/storefront-product-images.ts",
  "utf8",
);
const gallery = fs.readFileSync(
  "src/app/components/ProductImageGallery.tsx",
  "utf8",
);
const api = fs.readFileSync(
  "src/app/api/storefront/product-images/[id]/route.ts",
  "utf8",
);
const page = fs.readFileSync("src/app/product/[id]/page.tsx", "utf8");
const layout = fs.readFileSync("src/app/product/[id]/layout.tsx", "utf8");

assert.match(helper, /\.eq\("legacy_product_id", params\.legacyProductId\)/);
assert.match(helper, /\.eq\("sku", params\.sku\)/);
assert.match(helper, /\.in\("inventory_item_id", Array\.from\(inventoryIds\)\)/);
assert.match(helper, /selectFrontBackListingImages/);
assert.match(gallery, /listStorefrontProductImages/);
assert.match(gallery, /legacyProductId: number/);
assert.match(api, /listStorefrontProductImages/);
assert.match(page, /legacyProductId=\{product\.legacyProductId\}/);
assert.match(page, /sku=\{product\.sku\}/);
assert.match(layout, /legacyProductId=\{product\.legacyProductId\}/);
assert.match(layout, /sku=\{product\.sku\}/);

console.log(
  JSON.stringify(
    {
      ok: true,
      aggregatesLegacyLinkedRows: true,
      aggregatesSkuLinkedRows: true,
      keepsPreferredInventoryFirst: true,
      activeAndSoldPagesWired: true,
      publicImageApiUsesAggregation: true,
    },
    null,
    2,
  ),
);
