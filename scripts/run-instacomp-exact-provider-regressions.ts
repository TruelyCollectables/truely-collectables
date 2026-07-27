import assert from "node:assert/strict";
import {
  buildSerpApiEbayRequestUrl,
  classifyExactEbayProviderStatus,
  isSerpApiNoResultsMessage,
  normalizeEbaySerpItems,
} from "../src/lib/instacomp-exact-market-provider";

assert.equal(
  isSerpApiNoResultsMessage("eBay hasn't returned any results for this query."),
  true,
);
assert.equal(isSerpApiNoResultsMessage("No results were found"), true);
assert.equal(isSerpApiNoResultsMessage("Invalid API key"), false);

assert.equal(
  classifyExactEbayProviderStatus({
    configured: false,
    resultCount: 0,
    successfulAttemptCount: 0,
    firstError: null,
  }),
  "not_configured",
);
assert.equal(
  classifyExactEbayProviderStatus({
    configured: true,
    resultCount: 2,
    successfulAttemptCount: 1,
    firstError: null,
  }),
  "live",
);
assert.equal(
  classifyExactEbayProviderStatus({
    configured: true,
    resultCount: 0,
    successfulAttemptCount: 3,
    firstError: "One query timed out.",
  }),
  "no_matches",
  "A completed empty query ladder must remain no_matches even when another attempt timed out.",
);
assert.equal(
  classifyExactEbayProviderStatus({
    configured: true,
    resultCount: 0,
    successfulAttemptCount: 0,
    firstError: "Provider unavailable.",
  }),
  "error",
);

const soldUrl = buildSerpApiEbayRequestUrl("Topps rookie card", "sold", "secret");
assert.equal(soldUrl.searchParams.get("show_only"), "Sold");
assert.equal(soldUrl.searchParams.get("_nkw"), "Topps rookie card");

const normalized = normalizeEbaySerpItems({
  organic_results: [
    {
      title: "Test card",
      link: "https://www.ebay.com/itm/123",
      product_id: "123",
      price: { extracted: 10 },
      shipping: "Free shipping",
      sold_date: "Jul 25, 2026",
    },
    {
      title: "Paid shipping card",
      link: "https://www.ebay.com/itm/456",
      price: "$12.00",
      shipping: "+$1.25 delivery",
      sold_date: "Jul 24, 2026",
    },
  ],
});
assert.equal(normalized.length, 2);
assert.equal(normalized[0].shippingPrice, 0);
assert.equal(normalized[0].price, 10);
assert.equal(normalized[1].shippingPrice, 1.25);
assert.equal(normalized[1].price, 13.25);

console.log(
  "InstaComp exact-provider regressions passed: sold filter, normal no-results handling, intermittent-error status, and delivered-price parsing.",
);
