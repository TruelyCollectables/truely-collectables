import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`${label} was not found.`);
  }
  return source.replace(before, after);
}

const pagePath = "src/app/product/[id]/page.tsx";
let page = fs.readFileSync(pagePath, "utf8");
page = replaceOnce(
  page,
  'import Link from "next/link";\nimport Image from "next/image";\nimport type { Metadata } from "next";',
  'import Link from "next/link";\nimport type { Metadata } from "next";\nimport ProductImageGallery from "../../components/ProductImageGallery";',
  "active product import block",
);
page = replaceOnce(
  page,
  `        <div>\n          <div className="relative min-h-[320px] overflow-hidden rounded border bg-neutral-50 lg:min-h-[620px]">\n            <Image\n              src={product.imageUrl || "/placeholder.png"}\n              alt={product.title}\n              fill\n              sizes="(min-width: 1024px) calc(100vw - 540px), 100vw"\n              unoptimized\n              className="object-contain"\n            />\n          </div>\n        </div>`,
  `        <ProductImageGallery\n          inventoryItemId={product.inventoryItemId}\n          primaryImageUrl={product.imageUrl}\n          title={product.title}\n        />`,
  "active product image block",
);
fs.writeFileSync(pagePath, page);

const layoutPath = "src/app/product/[id]/layout.tsx";
let layout = fs.readFileSync(layoutPath, "utf8");
layout = layout.replace('import Image from "next/image";\n', "");
layout = layout.replace(
  'import SoldOverlay from "../../../components/SoldOverlay";\n',
  "",
);
if (!layout.includes('import ProductImageGallery from "../../components/ProductImageGallery";')) {
  layout = replaceOnce(
    layout,
    'import Link from "next/link";\n',
    'import Link from "next/link";\nimport ProductImageGallery from "../../components/ProductImageGallery";\n',
    "sold product import marker",
  );
}
layout = replaceOnce(
  layout,
  `          <div className="relative min-h-[360px] overflow-hidden rounded border-2 border-red-800 bg-neutral-100 lg:min-h-[680px]">\n            <Image\n              src={product.imageUrl}\n              alt={product.title}\n              fill\n              unoptimized\n              sizes="(min-width: 1024px) calc(100vw - 540px), 100vw"\n              className="object-contain p-3"\n            />\n            <SoldOverlay />\n          </div>`,
  `          <ProductImageGallery\n            inventoryItemId={product.inventoryItemId}\n            primaryImageUrl={product.imageUrl}\n            title={product.title}\n            sold\n          />`,
  "sold product image block",
);
fs.writeFileSync(layoutPath, layout);

console.log("Applied active and sold product gallery wiring.");
