import assert from "node:assert/strict";
import {
  calculateCustomWebsitePricing,
  calculateDualMarketplacePricing,
} from "../src/lib/dual-marketplace-pricing";
import {
  compactEbayTitle,
  conservativeCardCondition,
  createDualMarketplaceListingDraft,
} from "../src/lib/dual-marketplace-listing";
import {
  assertSafeEbayListingContent,
  normalizeEbayAspects,
  plainTextFromEbayHtml,
  validatedHttpsImageUrls,
} from "../src/lib/ebay-listing-content";
import {
  chunkDualMarketplaceItems,
  validateDualMarketplaceAction,
  type DualMarketplaceReadinessInput,
} from "../src/lib/dual-marketplace-workflow";

const lowDollar = calculateDualMarketplacePricing(1);
assert.ok(lowDollar.websitePrice > 0.01, "A $1 card must never calculate to a $0.01 website price.");
assert.ok(lowDollar.websitePrice < 1, "The website price must remain below eBay.");
assert.equal(
  calculateDualMarketplacePricing(10).ebayEstimatedFees,
  1.63,
  "The <=$10 eBay estimate must use the $0.30 fixed fee.",
);
assert.equal(
  calculateDualMarketplacePricing(10.01).ebayEstimatedFees,
  1.73,
  "The >$10 eBay estimate must use the $0.40 fixed fee.",
);

const custom = calculateCustomWebsitePricing(100, 84.99);
assert.equal(
  custom.netDifference,
  Math.round((custom.websiteEstimatedNet - custom.ebayEstimatedNet) * 100) / 100,
  "Manual website pricing must recalculate net difference.",
);
assert.equal(custom.customerSavings, 15.01);

assert.equal(
  conservativeCardCondition(null),
  "",
  "Unknown raw-card condition must fail closed instead of inventing Very Good.",
);
assert.equal(conservativeCardCondition("Review needed"), "");
assert.equal(conservativeCardCondition("Not near mint"), "");
assert.equal(conservativeCardCondition("Near Mint"), "Near Mint or Better");

const draft = createDualMarketplaceListingDraft({
  title: "Fallback Card",
  category: "sports cards",
  metadata: {
    instacomp: {
      ai: {
        player: "<script>alert(1)</script>",
        year: "2025",
        brand: "Topps",
        conditionGuess: "Review needed",
      },
    },
  },
});
assert.ok(draft.ebayTitle.length <= 80, "Generated eBay title must fit the 80-character limit.");
assert.equal(draft.cardCondition, "");
assert.ok(!draft.websiteDescription.includes("front and back images are part"));
assert.ok(draft.ebayDescription.includes("&lt;script&gt;"), "AI-derived HTML must be escaped.");
assert.equal(compactEbayTitle("A ".repeat(100), 80).length <= 80, true);

assert.throws(
  () => assertSafeEbayListingContent("<script>alert(1)</script>"),
  /script tags/,
);
assert.throws(
  () => assertSafeEbayListingContent('<div onclick="steal()">bad</div>'),
  /event handlers/,
);
assert.doesNotThrow(() =>
  assertSafeEbayListingContent("<div><h2>Safe</h2><p>Text</p></div>"),
);
assert.equal(
  plainTextFromEbayHtml("<div><h2>Card</h2><p>Exact item</p></div>"),
  "Card\nExact item",
);
assert.ok(plainTextFromEbayHtml("x".repeat(5_000)).length <= 4_000);

assert.throws(
  () => normalizeEbayAspects({ ["x".repeat(41)]: ["value"] }),
  /over 40 characters/,
);
assert.throws(
  () => normalizeEbayAspects({ Player: ["x".repeat(51)] }),
  /over 50 characters/,
);
assert.deepEqual(normalizeEbayAspects({ Player: ["David", "David"] }), {
  Player: ["David"],
});
assert.throws(
  () => validatedHttpsImageUrls(["http://example.com/card.jpg"]),
  /HTTPS URLs/,
);
assert.deepEqual(
  validatedHttpsImageUrls([
    "https://example.com/front.jpg",
    "https://example.com/front.jpg",
    "https://example.com/back.jpg",
  ]),
  ["https://example.com/front.jpg", "https://example.com/back.jpg"],
);

const fiveHundred = Array.from({ length: 500 }, (_, index) => index);
const ebayChunks = chunkDualMarketplaceItems(fiveHundred, "publish-both");
assert.equal(ebayChunks.length, 100, "500 eBay listings must be split into five-card batches.");
assert.equal(ebayChunks.flat().length, 500, "No selected eBay listing may be silently dropped.");
const localChunks = chunkDualMarketplaceItems(fiveHundred, "save");
assert.equal(localChunks.length, 10);
assert.equal(localChunks.flat().length, 500);

const baseReadiness: DualMarketplaceReadinessInput = {
  sku: "IC-TEST",
  websiteTitle: "Website title",
  websiteDescription: "Website description",
  websitePrice: 8.99,
  ebayTitle: "eBay title",
  ebayDescription: "eBay description",
  ebayPrice: 9.99,
  quantity: 1,
  imageUrls: ["https://example.com/card.jpg"],
  ebayCategoryId: "261328",
  ebayCondition: "USED_VERY_GOOD",
  grader: "",
  grade: "",
  cardCondition: "Near Mint or Better",
  aspects: { Type: ["Sports Trading Card"] },
};
assert.deepEqual(validateDualMarketplaceAction("publish-both", baseReadiness), []);
assert.deepEqual(
  validateDualMarketplaceAction("save", {
    ...baseReadiness,
    websiteTitle: "",
    ebayTitle: "",
    quantity: 0,
  }),
  [],
  "Saving an incomplete draft must remain possible.",
);
assert.deepEqual(
  validateDualMarketplaceAction("publish-ebay", {
    ...baseReadiness,
    websiteTitle: "",
    websiteDescription: "",
    websitePrice: 0,
  }),
  [],
  "eBay-only publishing must not be blocked by incomplete website fields.",
);
assert.ok(
  validateDualMarketplaceAction("publish-website", {
    ...baseReadiness,
    quantity: 0,
  }).some((problem) => problem.includes("quantity")),
  "Zero stock must block website publication instead of being changed to one.",
);
assert.ok(
  validateDualMarketplaceAction("publish-both", {
    ...baseReadiness,
    websitePrice: 9.99,
  }).some((problem) => problem.includes("lower")),
  "Publish-both must enforce a lower website price.",
);

console.log("Dual-marketplace adversarial audit simulations passed.");
