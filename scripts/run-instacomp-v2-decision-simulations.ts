import { buildInstaCompV2Decision } from "../src/lib/instacomp-v2";

function equal(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function ok(value: unknown, label: string) {
  if (!value) throw new Error(`${label}: expected a truthy value.`);
}

const now = new Date("2026-07-31T12:00:00Z");
const scan = {
  ai: { confidence: 0.98, conditionGuess: "Near Mint" },
  review: { trustedForPricing: true, reviewReasons: [] },
  soldComps: [
    {
      title: "Morpeko ex 115/081 raw",
      price: 50,
      sourceLabel: "eBay",
      sourceCategory: "sold",
      soldAt: "2026-07-25T00:00:00Z",
      matchScore: 99,
    },
    {
      title: "Morpeko ex 115/081 raw",
      price: 55,
      sourceLabel: "eBay",
      sourceCategory: "sold",
      soldAt: "2026-07-10T00:00:00Z",
      matchScore: 98,
    },
    {
      title: "Morpeko ex 115/081 raw",
      price: 42,
      sourceLabel: "eBay",
      sourceCategory: "sold",
      soldAt: "2026-05-25T00:00:00Z",
      matchScore: 97,
    },
    {
      title: "Morpeko ex 115/081 raw",
      price: 44,
      sourceLabel: "130point",
      sourceCategory: "sold",
      soldAt: "2026-06-10T00:00:00Z",
      matchScore: 96,
    },
  ],
  marketValueComps: [
    {
      title: "Morpeko ex 115/081 raw",
      price: 58,
      sourceLabel: "eBay",
      sourceCategory: "marketplace",
      matchScore: 99,
    },
  ],
  activeComps: [
    {
      title: "Morpeko ex 115/081 raw",
      price: 58,
      sourceLabel: "eBay",
      sourceCategory: "marketplace",
      matchScore: 99,
    },
    {
      title: "Morpeko ex 115/081 raw",
      price: 62,
      sourceLabel: "COMC",
      sourceCategory: "marketplace",
      matchScore: 95,
    },
  ],
  providers: [
    {
      label: "Search",
      results: [
        {
          title: "Morpeko ex 115/081 PSA 9",
          price: 85,
          sourceLabel: "eBay",
          matchScore: 92,
        },
        {
          title: "Morpeko ex 115/081 PSA 10",
          price: 330,
          sourceLabel: "eBay",
          matchScore: 93,
        },
        {
          title: "Morpeko ex 115/081 PSA 10",
          price: 350,
          sourceLabel: "130point",
          matchScore: 95,
        },
      ],
    },
  ],
  soldStats: {
    median: 52.5,
    suggestedPrice: 52.5,
    low: 42,
    high: 55,
    average: 47.75,
  },
};

const noPrice = buildInstaCompV2Decision(scan, {}, now);
equal(noPrice.schema, "instacomp.decision.v2", "schema");
equal(noPrice.recommendation.action, "ENTER_BUY_PRICE", "price-entry action");
equal(noPrice.market.graded.psa10, 340, "PSA 10 median");
equal(noPrice.market.trend.direction, "up", "trend direction");
ok((noPrice.targets.goodBuy || 0) > 0, "good-buy target");

const buy = buildInstaCompV2Decision(
  scan,
  { purchasePrice: 15, purchaseShipping: 5 },
  now,
);
equal(buy.recommendation.action, "BUY_NOW", "strong deal action");
ok((buy.economics.projectedProfit || 0) > 10, "projected profit");
ok((buy.economics.roiPercent || 0) > 50, "projected ROI");
ok((buy.scores.opportunity || 0) >= 70, "opportunity score");

const pass = buildInstaCompV2Decision(scan, { purchasePrice: 48 }, now);
equal(pass.recommendation.action, "PASS", "overpriced action");

const noMarket = buildInstaCompV2Decision(
  {
    ai: { confidence: 0.3 },
    review: { trustedForPricing: false },
  },
  { purchasePrice: 5 },
  now,
);
equal(noMarket.recommendation.action, "NO_MARKET_DATA", "missing market action");

console.log("InstaComp 2.0 decision simulations passed.");
