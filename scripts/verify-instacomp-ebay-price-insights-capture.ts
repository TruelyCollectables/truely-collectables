import assert from "node:assert/strict";
import { filterExactEbayPriceInsightsRows } from "../src/lib/instacomp-ebay-price-insights";
import type { InstaCompAiResult } from "../src/lib/instacomp";

const target: InstaCompAiResult = {
  player: "George Lombard Jr",
  year: "2024",
  brand: "Bowman Chrome",
  setName: "Prospects",
  cardNumber: "BCP-222",
  parallel: "Refractor",
  serialNumber: "355/499",
  team: null,
  sport: "Baseball",
  isRookie: true,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Ungraded",
  confidence: 1,
  notes: null,
};

const rows = [
  {
    title: "GEORGE LOMBARD JR 2024 Bowman Chrome Prospects Refractor #355/499 BCP-222 RC",
    soldAt: "2026-08-06",
    itemPrice: 14.99,
    shippingPrice: 6,
    url: "https://www.ebay.com/itm/123456789001",
    condition: "Ungraded - Near Mint or Better",
    buyingOption: "Buy It Now",
  },
  {
    title: "2024 Bowman Chrome Prospects George Lombard Jr #BCP-222 Refractor /499 RC",
    soldAt: "2026-08-05",
    itemPrice: 19.99,
    shippingPrice: 1.5,
    url: "https://www.ebay.com/itm/123456789002?foo=bar",
    condition: "Ungraded - Near Mint or Better",
  },
  {
    title: "2024 Bowman Chrome Prospects George Lombard Jr #BCP-222 RC",
    soldAt: "2026-08-05",
    itemPrice: 13.99,
    shippingPrice: 1.36,
    url: "https://www.ebay.com/itm/123456789003",
  },
  {
    title: "2024 Bowman Chrome Prospects George Lombard Jr #BCP-222 Refractor /250 RC",
    soldAt: "2026-08-05",
    itemPrice: 10,
    shippingPrice: 1.35,
    url: "https://www.ebay.com/itm/123456789004",
  },
  {
    title: "2024 Bowman Chrome Prospects George Lombard Jr #BCP-222 Refractor /499 RC",
    soldAt: "2026-08-05",
    itemPrice: 15,
    shippingPrice: 2,
    url: "https://example.com/not-ebay",
  },
];

const result = filterExactEbayPriceInsightsRows(rows, target);
assert.equal(result.received, 5);
assert.equal(result.normalized, 4);
assert.equal(result.accepted.length, 2);
assert.equal(result.rejected.length, 3);
assert.deepEqual(
  result.accepted.map((row) => row.price).sort((a, b) => a - b),
  [20.99, 21.49],
);
assert.ok(result.accepted.every((row) => row.source === "ebay_price_insights_owner_capture"));
assert.ok(result.accepted.every((row) => row.sourceCategory === "sold"));
assert.ok(result.accepted.every((row) => row.priceIncludesShipping === true));
assert.ok(result.accepted.every((row) => row.flags.includes("strict exact identity")));
assert.ok(result.rejected.some((row) => row.reason.includes("strict exact-card")));
assert.ok(result.rejected.some((row) => row.reason.includes("direct ebay.com/itm")));

console.log(
  JSON.stringify(
    {
      ok: true,
      received: result.received,
      normalized: result.normalized,
      acceptedExactSold: result.accepted.length,
      rejected: result.rejected.length,
      acceptedLandedPrices: result.accepted.map((row) => row.price),
    },
    null,
    2,
  ),
);
