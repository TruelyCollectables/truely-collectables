import { strict as assert } from "node:assert";
import { normalizeInstaCompMacSoldPayload } from "../src/lib/instacomp-mac-market-provider";
import { isInstaCompPricingEligibleComp } from "../src/lib/instacomp-live-pipeline";

const exactTitle =
  "Panini 2025 Donruss WNBA Elizabeth Kitley #66 Las Vegas Aces /25 Pink Shimmer";

const provider = normalizeInstaCompMacSoldPayload({
  ok: true,
  sold: [
    {
      title: exactTitle,
      price: 16.36,
      itemPrice: 15,
      shippingPrice: 1.36,
      priceIncludesShipping: true,
      currency: "USD",
      url: "https://www.ebay.com/itm/307099744373",
      source: "mac_ebay_exact_sold",
      sourceLabel: "eBay Exact Sold · Mac Chrome",
      sourceCategory: "sold",
      matchScore: 350,
      flags: ["Mac local exact-card gate", "reference only", "not used for pricing"],
      soldAt: "2026-08-01T00:00:00+00:00",
    },
  ],
  rejected: [{ reasons: ["parallel_mismatch"] }],
  providerCoverage: [
    {
      source: "mac_chrome_ebay_sold",
      label: "eBay Sold · Mac Chrome",
      status: "live",
      resultCount: 60,
      searchUrl: "https://www.ebay.com/sch/i.html?_nkw=kitley&LH_Sold=1",
    },
  ],
});
assert.equal(provider.status, "live");
assert.equal(provider.results.length, 1);
assert.equal(provider.results[0]?.title, exactTitle);
assert.equal(provider.results[0]?.price, 16.36);
assert.equal(provider.searchUrl?.includes("LH_Sold=1"), true);
assert.equal(
  isInstaCompPricingEligibleComp(provider.results[0]!),
  false,
  "Best Offer-hidden sold evidence must surface without becoming trusted pricing",
);
assert.match(provider.message || "", /1 exact sold evidence row/);
assert.match(provider.message || "", /60 raw/);

const empty = normalizeInstaCompMacSoldPayload({
  ok: true,
  sold: [],
  rejected: [],
  providerCoverage: [
    {
      source: "mac_chrome_ebay_sold",
      label: "eBay Sold · Mac Chrome",
      status: "no_matches",
      resultCount: 0,
    },
  ],
});
assert.equal(empty.status, "no_matches");
assert.equal(empty.results.length, 0);

console.log("PASS InstaComp Mac sold comp regressions");