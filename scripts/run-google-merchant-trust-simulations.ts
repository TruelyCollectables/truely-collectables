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
  sanitizePublicListingDescription(
    "Name/Player: Veronica Burton Set: 2025 Panini Prizm WNBA - Zduplicate Orange Ice Prizms Card number: 70",
  ),
  "Name/Player: Veronica Burton Set: 2025 Panini Prizm WNBA - Orange Ice Prizms Card number: 70",
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


const requestGate = fs.readFileSync("src/request-gate.ts", "utf8");
assert.doesNotMatch(
  requestGate,
  /response\.headers\.set\("Content-Security-Policy"/,
  "Request gate must not add a second CSP on top of next.config.ts.",
);
assert.doesNotMatch(
  requestGate,
  /response\.headers\.set\("X-Content-Type-Options"/,
  "Request gate must not duplicate global nosniff headers.",
);

const nextConfig = fs.readFileSync("next.config.ts", "utf8");
for (const requiredGoogleSource of ["https://apis.google.com", "https://www.gstatic.com"]) {
  assert.ok(
    nextConfig.includes(requiredGoogleSource),
    `Global CSP must allow Google Customer Reviews resource ${requiredGoogleSource}.`,
  );
}

console.log("Google Merchant trust simulations passed.");
