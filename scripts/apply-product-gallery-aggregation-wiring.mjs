import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`${label} was not found.`);
  return source.replace(before, after);
}

const pagePath = "src/app/product/[id]/page.tsx";
let page = fs.readFileSync(pagePath, "utf8");
page = replaceOnce(
  page,
  `        <ProductImageGallery
          inventoryItemId={product.inventoryItemId}
          primaryImageUrl={product.imageUrl}
          title={product.title}
        />`,
  `        <ProductImageGallery
          legacyProductId={product.legacyProductId}
          sku={product.sku}
          inventoryItemId={product.inventoryItemId}
          primaryImageUrl={product.imageUrl}
          title={product.title}
        />`,
  "active product gallery props",
);
fs.writeFileSync(pagePath, page);

const layoutPath = "src/app/product/[id]/layout.tsx";
let layout = fs.readFileSync(layoutPath, "utf8");
layout = replaceOnce(
  layout,
  `          <ProductImageGallery
            inventoryItemId={product.inventoryItemId}
            primaryImageUrl={product.imageUrl}
            title={product.title}
            sold
          />`,
  `          <ProductImageGallery
            legacyProductId={product.legacyProductId}
            sku={product.sku}
            inventoryItemId={product.inventoryItemId}
            primaryImageUrl={product.imageUrl}
            title={product.title}
            sold
          />`,
  "sold product gallery props",
);
fs.writeFileSync(layoutPath, layout);

console.log("Wired active and sold galleries to legacy-product image aggregation.");
