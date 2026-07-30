import fs from "node:fs";

const routePath = process.argv[2];
if (!routePath) {
  throw new Error(
    "Usage: node fix-ebay-picture-repair-inventory-index-types.mjs <route-path>",
  );
}

let source = fs.readFileSync(routePath, "utf8");
const before = "listingIds.some((listingId) => listingId === ebayItemId)";
const after =
  "listingIds.some((listingId: string) => listingId === ebayItemId)";
if (!source.includes(before)) {
  throw new Error("Seller listing ID callback marker was not found.");
}
source = source.replace(before, after);
fs.writeFileSync(routePath, source);
console.log(`Typed seller listing IDs in ${routePath}`);
