import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const offerForm = readFileSync("src/app/product/[id]/OfferForm.tsx", "utf8");
const productActions = readFileSync(
  "src/app/product/[id]/ProductActions.tsx",
  "utf8",
);

assert.match(offerForm, /Shoot Me an Offer/);
assert.match(offerForm, /aria-label="Shoot Me an Offer"/);
assert.match(offerForm, /<sup aria-hidden="true"/);
assert.match(offerForm, />\s*™\s*<\/sup>/);
assert.doesNotMatch(offerForm, /Make Best Offer/);

assert.match(productActions, /Make It Mine/);
assert.match(productActions, /aria-label="Make It Mine"/);
assert.match(productActions, /<sup aria-hidden="true"/);
assert.match(productActions, />\s*™\s*<\/sup>/);
assert.match(productActions, /onClick=\{handleBuyNow\}/);
assert.match(productActions, /window\.location\.href = "\/cart"/);
assert.match(productActions, /Add To Cart/);

console.log("Storefront trademark CTA simulations passed.");
