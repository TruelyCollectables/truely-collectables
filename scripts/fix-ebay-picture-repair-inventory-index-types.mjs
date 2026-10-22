import fs from "node:fs";

const routePath = process.argv[2];
if (!routePath) {
  throw new Error(
    "Usage: node fix-ebay-picture-repair-inventory-index-types.mjs <route-path>",
  );
}

let source = fs.readFileSync(routePath, "utf8");

const listingBefore =
  "listingIds.some((listingId) => listingId === ebayItemId)";
const listingAfter =
  "listingIds.some((listingId: string) => listingId === ebayItemId)";
if (!source.includes(listingBefore)) {
  throw new Error("Seller listing ID callback marker was not found.");
}
source = source.replace(listingBefore, listingAfter);

const languageMarker = '"Content-Language": "en-US",';
const languageReplacement = [
  languageMarker,
  '          "Accept-Language": "en-US",',
].join("\n");
const languageOccurrences = source.split(languageMarker).length - 1;
if (languageOccurrences < 1) {
  throw new Error("eBay REST language header marker was not found.");
}
source = source.replaceAll(languageMarker, languageReplacement);

fs.writeFileSync(routePath, source);
console.log(
  `Typed seller listing IDs and normalized ${languageOccurrences} eBay language headers in ${routePath}`,
);
