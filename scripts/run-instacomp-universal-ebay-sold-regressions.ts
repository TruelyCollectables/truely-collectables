import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildSerpApiEbayRequestUrl,
  normalizeEbaySerpItems,
} from "../src/lib/instacomp-ebay-serp-provider";
import {
  calculateCompStats,
  filterAndRankExactMatches,
  type InstaCompAiResult,
  type InstaCompComp,
} from "../src/lib/instacomp";

const exactTitle =
  "2025 Panini Select Shedeur Sanders Rookie Swatches Red Prizm #RSW-SSS";
const soldUrl = buildSerpApiEbayRequestUrl(exactTitle, "sold", "test-key");
const activeUrl = buildSerpApiEbayRequestUrl(exactTitle, "active", "test-key");
assert.equal(soldUrl.searchParams.get("engine"), "ebay");
assert.equal(soldUrl.searchParams.get("_nkw"), exactTitle);
assert.equal(soldUrl.searchParams.get("show_only"), "Sold");
assert.equal(soldUrl.searchParams.get("_ipg"), "50");
assert.equal(activeUrl.searchParams.get("engine"), "ebay");
assert.equal(activeUrl.searchParams.get("show_only"), null);
assert.equal(activeUrl.searchParams.get("_sop"), "10");

const payload = {
  search_information: { total_results: 29 },
  organic_results: [
    ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 3.99, "2026-07-18"],
    ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 3.0, "2026-07-16"],
    ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 4.0, "2026-07-16"],
    ["2025 Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 5.0, "2026-07-13"],
    ["2025 Select Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 1.99, "2026-07-10"],
    ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 5.0, "2026-07-07"],
    ["2025 Select Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 2.1, "2026-07-04"],
    ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Blue Prizm", 6.0, "2026-06-06"],
    ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS White Prizm 21/99", 12.49, "2026-07-19"],
  ].map(([title, price, soldDate], index) => ({
    title,
    link: `https://www.ebay.com/itm/${1000 + index}`,
    product_id: String(1000 + index),
    price: { raw: `$${price}`, extracted: price },
    thumbnail: `https://i.ebayimg.com/images/g/test${index}/s-l225.jpg`,
    sold_date: soldDate,
    condition: "Pre-Owned",
  })),
};

const items = normalizeEbaySerpItems(payload);
assert.equal(items.length, 9);
assert.equal(items[0].price, 3.99);
assert.equal(items[0].soldDate, "2026-07-18");
assert.match(items[0].link, /^https:\/\/www\.ebay\.com\/itm\//);

const ai: InstaCompAiResult = {
  player: "Shedeur Sanders",
  year: "2025",
  brand: "Panini",
  setName: "Select Rookie Swatches",
  cardNumber: "RSW-SSS",
  parallel: "Red Prizm",
  serialNumber: null,
  team: "Browns",
  sport: "Football",
  isRookie: true,
  isAuto: false,
  isRelic: true,
  conditionGuess: "Near Mint",
  confidence: 1,
  notes: null,
};

const raw: Omit<InstaCompComp, "matchScore" | "flags">[] = items.map((item) => ({
  title: item.title,
  price: item.price,
  currency: "USD",
  url: item.link,
  imageUrl: item.thumbnail,
  source: "ebay_sold_serpapi",
  sourceLabel: "eBay Sold",
  sourceCategory: "sold",
  soldAt: item.soldDate,
}));
const exact = filterAndRankExactMatches(raw, ai, 50, 35);
assert.equal(
  exact.length,
  7,
  "All seven exact Red Rookie Swatches sales must pass even when titles omit relic/MEM wording.",
);
assert.ok(exact.every((comp) => comp.flags.includes("relic")));
assert.ok(exact.every((comp) => comp.flags.includes("parallel")));
assert.ok(exact.every((comp) => !/Blue|White/i.test(comp.title)));
const stats = calculateCompStats(exact);
assert.equal(stats.suggestedPrice, 3.99);
assert.equal(stats.low, 1.99);
assert.equal(stats.high, 5);

const scanSource = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const sellerSource = fs.readFileSync(
  "src/app/api/account/seller/inventory/instacomp/route.ts",
  "utf8",
);
assert.ok(scanSource.includes("getUniversalEbaySerpProviders"));
assert.ok(scanSource.includes("exactTitle: requestedListingTitle"));
assert.ok(scanSource.includes("universalEbay.sold"));
assert.ok(scanSource.includes("exactStoredTitleQuery: universalEbay.query"));
assert.ok(sellerSource.includes('formData.set("listingTitle", item.title)'));
assert.ok(sellerSource.includes("visualSoldReview"));
assert.ok(sellerSource.includes("const priceCandidate = soldSuggestion(soldCompEvidence)"));

console.log(
  "Universal eBay InstaComp regression passed: exact stored titles drive structured sold and active searches, exact Rookie Swatches sales survive relic filtering, wrong parallels are excluded, and seven accepted sales suggest $3.99.",
);
