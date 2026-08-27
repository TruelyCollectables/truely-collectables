import assert from "node:assert/strict";
import {
  independentVerifiedInstaCompSaleCount,
  instaCompVerifiedSalePrice,
  isVerifiedInstaCompCompletedSale,
  verifiedInstaCompCompletedSales,
  type InstaCompMarketComp,
} from "../src/lib/instacomp-market-evidence";

const now = new Date("2026-08-02T20:00:00.000Z");

function verifiedSale(
  overrides: Partial<InstaCompMarketComp> = {},
): InstaCompMarketComp {
  return {
    title: "2025 Panini Select WNBA #7 White Disco /75",
    itemPrice: 40,
    shippingPrice: 5,
    price: 45,
    priceIncludesShipping: true,
    currency: "USD",
    url: "https://www.ebay.com/itm/123456789012?mkcid=1&mkrid=711",
    source: "ebay_connected_receipt",
    sourceLabel: "Connected eBay receipt",
    sourceCategory: "sold",
    matchScore: 100,
    flags: [],
    saleId: "ebay-buyer-order:ORDER-1:item:123456789012",
    saleVerified: true,
    finalPriceVerified: true,
    shippingVerified: true,
    soldAt: "2026-07-25T18:00:00.000Z",
    observedAt: "2026-08-02T19:00:00.000Z",
    ...overrides,
  };
}

const first = verifiedSale();
assert.equal(isVerifiedInstaCompCompletedSale(first, now), true);
assert.equal(instaCompVerifiedSalePrice(first), 45);

const duplicateAdapter = verifiedSale({
  source: "market_intel_ebay_receipt",
  sourceLabel: "Market Intel eBay receipt",
  url: "https://www.ebay.com/itm/123456789012",
});
assert.equal(
  independentVerifiedInstaCompSaleCount([first, duplicateAdapter], now),
  1,
  "The same eBay transaction must not become independent evidence through two adapters.",
);

const duplicateUrlDifferentClaim = verifiedSale({
  source: "other_ebay_adapter",
  saleId: "different-claimed-sale-id",
  url: "https://www.ebay.com/itm/example-title/123456789012?hash=itemabc",
});
assert.equal(
  independentVerifiedInstaCompSaleCount([first, duplicateUrlDifferentClaim], now),
  1,
  "One canonical eBay item URL must not count twice under different claimed sale IDs.",
);

const flagsOnly = verifiedSale({
  saleVerified: false,
  finalPriceVerified: false,
  shippingVerified: false,
  flags: [
    "verified completed sale",
    "final price verified",
    "shipping verified",
  ],
});
assert.equal(
  isVerifiedInstaCompCompletedSale(flagsOnly, now),
  false,
  "Provider-controlled flags must never grant completed-sale authority.",
);

const conflictingTotal = verifiedSale({
  itemPrice: 40,
  shippingPrice: 5,
  price: 99,
  priceIncludesShipping: true,
});
assert.equal(
  instaCompVerifiedSalePrice(conflictingTotal),
  null,
  "A displayed total that conflicts with verified item plus shipping values must fail closed.",
);

const hostileUrl = verifiedSale({
  url: "javascript:alert(document.cookie)",
});
assert.equal(
  isVerifiedInstaCompCompletedSale(hostileUrl, now),
  false,
  "A verified sale requires a canonical HTTPS evidence URL.",
);

const futureSale = verifiedSale({
  soldAt: "2026-08-03T00:00:00.000Z",
});
assert.equal(isVerifiedInstaCompCompletedSale(futureSale, now), false);

const second = verifiedSale({
  saleId: "ebay-buyer-order:ORDER-2:item:987654321098",
  url: "https://www.ebay.com/itm/987654321098",
  price: 55,
  itemPrice: 50,
  shippingPrice: 5,
});
assert.equal(
  independentVerifiedInstaCompSaleCount([first, second], now),
  2,
  "Two genuinely distinct verified receipts must remain independent.",
);
assert.equal(verifiedInstaCompCompletedSales([first, second], now).length, 2);

console.log("InstaComp sold-evidence replay regressions passed (all assertions).");
