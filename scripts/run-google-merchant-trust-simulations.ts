import assert from "node:assert/strict";
import fs from "node:fs";
import {
  sanitizePublicListingDescription,
  sanitizePublicListingTitle,
} from "../src/lib/public-listing-copy";

assert.equal(
  sanitizePublicListingTitle("2025 Panini Prizm - Zduplicate Orange Ice Player #1"),
  "2025 Panini Prizm - Orange Ice Player #1",
);
assert.equal(
  sanitizePublicListingDescription(
    "Imported from CollX collection ID 938751849984911360.\nName/Player: Aaron Judge\nTeam: Yankees",
  ),
  "Name/Player: Aaron Judge Team: Yankees",
);
assert.equal(
  sanitizePublicListingDescription(
    "Imported from active eBay listing snapshot. Full description/images pending eBay API refresh.",
  ),
  null,
);
assert.equal(
  sanitizePublicListingDescription('<div class="ql-editor"><p>Clean <strong>listing</strong> copy &amp; details</p></div>'),
  "Clean listing copy & details",
);

const productPage = fs.readFileSync("src/app/product/[id]/page.tsx", "utf8");
assert.doesNotMatch(
  productPage,
  /brand:\s*\{[\s\S]{0,120}name:\s*"Truely Collectables"/,
  "Product structured data must not claim the retailer is every item's brand.",
);

for (const file of ["cloudflare-worker.ts", "cloudflare-storefront-entrypoint.ts"]) {
  const source = fs.readFileSync(file, "utf8");
  assert.ok(source.includes('url.protocol === "http:"'), `${file} must reject plaintext storefront delivery.`);
  assert.ok(source.includes('url.protocol = "https:"'), `${file} must redirect plaintext requests to HTTPS.`);
}

console.log("Google Merchant trust simulations passed.");
