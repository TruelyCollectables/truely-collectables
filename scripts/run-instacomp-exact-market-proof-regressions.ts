import assert from "node:assert/strict";
import fs from "node:fs";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  buildExactEbayQueryLadder,
  buildSerpApiEbayRequestUrl,
  filterStrictExactMarketMatches,
  normalizeEbaySerpItems,
  normalizeInstaCompParallelForExactMatching,
} from "../src/lib/instacomp-exact-market-provider";
import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
import { buildInstaCompCuratedChecklistEvidence } from "../src/lib/instacomp-curated-checklist";

type FixtureCard = {
  id: string;
  exactTitle: string;
  ai: InstaCompAiResult;
  exactTitles: string[];
  wrongDenominator: string;
  wrongParallel: string;
};

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as { cards: FixtureCard[] };

function candidate(title: string, price: number, index: number) {
  return {
    title,
    price,
    currency: "USD",
    url: `https://www.ebay.com/itm/test-${index}`,
    imageUrl: null,
    source: "fixture",
    sourceLabel: "Fixture",
    sourceCategory: "sold" as const,
    soldAt: "Jul 20, 2026",
  };
}

function mustReject(card: FixtureCard, title: string, label: string, index: number) {
  const rows = filterStrictExactMarketMatches([candidate(title, 1, index)], card.ai, 20);
  assert.equal(rows.length, 0, `${card.id}: ${label} must be rejected`);
}

assert.equal(fixture.cards.length, 6, "Batch 001 must contain exactly six proof cards");
assert.equal(
  normalizeInstaCompParallelForExactMatching("Base /99"),
  "",
  "Base /99 is a print-run descriptor, not a named parallel",
);
assert.equal(
  normalizeInstaCompParallelForExactMatching(
    "Base memorabilia issue, serial-numbered /100",
  ),
  "",
  "Memorabilia issue /100 is a card-type and print-run descriptor, not a named parallel",
);
assert.equal(
  normalizeInstaCompParallelForExactMatching("Choice Fusion Red & Yellow Prizm"),
  "choice fusion red and yellow prizm",
);

for (const [cardIndex, card] of fixture.cards.entries()) {
  const ladder = buildExactEbayQueryLadder({
    exactTitle: card.exactTitle,
    fallbackQuery: card.exactTitle,
    ai: card.ai,
  });
  assert.ok(ladder.length >= 2, `${card.id}: exact query ladder must have multiple attempts`);
  assert.ok(
    ladder.some((query) => query.toLowerCase().includes(String(card.ai.cardNumber).toLowerCase())),
    `${card.id}: query ladder must include the exact card number`,
  );
  if (card.ai.certificationNumber) {
    assert.ok(
      ladder.every((query) => !query.includes(String(card.ai.certificationNumber))),
      `${card.id}: exact slab cert must never poison market search queries`,
    );
  }
  if (card.ai.serialNumber) {
    assert.ok(
      ladder.every((query) => !query.includes(String(card.ai.serialNumber))),
      `${card.id}: exact physical-copy numerator must not be required in market queries`,
    );
    const denominator = String(card.ai.serialNumber).split("/").at(-1);
    assert.ok(
      ladder.some((query) => query.includes(`/${Number(denominator)}`)),
      `${card.id}: query ladder must preserve the exact print-run denominator`,
    );
  }

  const exactRows = card.exactTitles.map((title, index) =>
    candidate(title, 10 + cardIndex * 5 + index, cardIndex * 10 + index),
  );
  const accepted = filterStrictExactMarketMatches(exactRows, card.ai, 20);
  assert.ok(accepted.length >= 1, `${card.id}: at least one exact title must be accepted`);

  mustReject(card, card.wrongDenominator, "wrong serial run or numbered variation", 100 + cardIndex);
  mustReject(card, card.wrongParallel, "wrong parallel or wrong grade", 200 + cardIndex);
  mustReject(card, `Lot of 3 ${card.exactTitles[0]}`, "multi-card lot", 300 + cardIndex);

  const wrongPlayer = card.exactTitles[0].replace(
    new RegExp(String(card.ai.player).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    "Different Player",
  );
  mustReject(card, wrongPlayer, "wrong player", 400 + cardIndex);

  const wrongYear = card.exactTitles[0].replace(String(card.ai.year), "1901");
  mustReject(card, wrongYear, "wrong year", 500 + cardIndex);

  const wrongCardNumber = card.exactTitles[0].replace(
    String(card.ai.cardNumber),
    `WRONG-${cardIndex}`,
  );
  mustReject(card, wrongCardNumber, "wrong card number", 600 + cardIndex);

  if (card.ai.isAuto) {
    const missingAuto = card.exactTitles[0]
      .replace(/autographs?|autos?|signed|signatures?/gi, "Insert")
      .replace(/\s+/g, " ");
    mustReject(card, missingAuto, "missing autograph evidence", 700 + cardIndex);
  } else {
    mustReject(card, `${card.exactTitles[0]} Autograph`, "unexpected autograph", 800 + cardIndex);
  }

  if (card.ai.isRelic) {
    const missingRelic = card.exactTitles[0]
      .replace(/swatch(?:es)?|patch(?:es)?|jersey(?:s)?|relic(?:s)?|memorabilia|material(?:s)?/gi, "Insert")
      .replace(/\s+/g, " ");
    mustReject(card, missingRelic, "missing relic evidence", 900 + cardIndex);
  } else {
    mustReject(card, `${card.exactTitles[0]} Patch`, "unexpected relic", 1000 + cardIndex);
  }

  const sold = accepted.map((row, index) => ({ ...row, price: 12 + index * 2 }));
  const active = accepted.map((row, index) => ({ ...row, price: 18 + index * 2 }));
  const pricing = calculateInstaCompSweetSpot({ sold, active });
  assert.ok(pricing.suggestedPrice > 0, `${card.id}: exact sold evidence must create a suggestion`);
  assert.equal(pricing.soldCount, sold.length, `${card.id}: all exact sold evidence must be counted`);
  assert.equal(pricing.activeCount, active.length, `${card.id}: exact active evidence must be counted`);
}

const normalized = normalizeEbaySerpItems({
  organic_results: [
    {
      title: fixture.cards[1].exactTitles[0],
      link: "https://www.ebay.com/itm/123456789012",
      product_id: "123456789012",
      price: { raw: "$6.00", extracted: 6 },
      shipping: { raw: "+$1.25", extracted: 1.25 },
      sold_date: "Jul 20, 2026",
      thumbnail: "https://i.ebayimg.com/test.jpg",
      condition: "Ungraded - Near mint or better",
    },
  ],
});
assert.equal(normalized.length, 1);
assert.equal(normalized[0].itemPrice, 6);
assert.equal(normalized[0].shippingPrice, 1.25);
assert.equal(normalized[0].price, 7.25, "pricing evidence must use delivered cost");
assert.equal(normalized[0].priceIncludesShipping, true);
assert.equal(normalized[0].soldDate, "Jul 20, 2026");

const seasonTarget: InstaCompAiResult = {
  player: "Season Guard",
  year: "2024-25",
  brand: "Upper Deck",
  setName: "Series 1",
  cardNumber: "25",
  parallel: "Base",
  serialNumber: null,
  team: "Test Team",
  sport: "Hockey",
  isRookie: false,
  isAuto: false,
  isRelic: false,
  conditionGuess: "Raw",
  confidence: 1,
  notes: null,
};
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("2024/25 Upper Deck Series 1 Season Guard #25", 10, 5000)],
    seasonTarget,
    10,
  ).length,
  1,
  "a 2024/25 season must not be treated as a /25 print run",
);
const numberedTarget = { ...seasonTarget, serialNumber: "07/25" };
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("2024/25 Upper Deck Series 1 Season Guard #25", 10, 5001)],
    numberedTarget,
    10,
  ).length,
  0,
  "a season written 2024/25 must not satisfy a true /25 serial gate",
);

const psaNine: InstaCompAiResult = {
  ...seasonTarget,
  player: "Grade Guard",
  year: "1989",
  brand: "Topps",
  setName: "Topps",
  cardNumber: "9",
  gradingCompany: "PSA",
  gradeValue: "9",
  conditionGuess: "Graded",
};
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("1989 Topps Grade Guard #9 PSA 10", 10, 5002)],
    psaNine,
    10,
  ).length,
  0,
  "card #9 must never make a PSA 10 listing pass as PSA 9",
);
assert.equal(
  filterStrictExactMarketMatches(
    [candidate("1989 Topps Grade Guard #9 PSA 9", 10, 5003)],
    psaNine,
    10,
  ).length,
  1,
  "the exact PSA 9 grade must still pass",
);

const shippingUnknown = {
  ...candidate("2024-25 Upper Deck Series 1 Season Guard #25", 10, 5004),
  matchScore: 100,
  flags: ["strict exact identity", "shipping unknown"],
  itemPrice: 10,
  shippingPrice: null,
  priceIncludesShipping: false,
};
const delivered = {
  ...candidate("2024-25 Upper Deck Series 1 Season Guard #25", 12, 5005),
  matchScore: 100,
  flags: ["strict exact identity", "price includes reported shipping"],
  itemPrice: 10,
  shippingPrice: 2,
  priceIncludesShipping: true,
};
const merged = mergeExactMarketSources([
  {
    sold: {
      source: "fixture_sold",
      label: "Fixture Sold",
      status: "live",
      message: null,
      results: [delivered],
    },
    active: {
      source: "fixture_active",
      label: "Fixture Active",
      status: "live",
      message: null,
      results: [shippingUnknown],
    },
  },
]);
assert.equal(merged.active.length, 1, "shipping-unknown exact active evidence must stay visible");
assert.equal(merged.pricing.activeCount, 0, "shipping-unknown evidence must not enter pricing");
assert.equal(merged.pricing.soldCount, 1, "delivered-price sold evidence must enter pricing");
assert.ok(merged.trustedSuggestedPrice && merged.trustedSuggestedPrice > 0);

const soldUrl = buildSerpApiEbayRequestUrl("exact card", "sold").toString();
const activeUrl = buildSerpApiEbayRequestUrl("exact card", "active").toString();
assert.match(soldUrl, /show_only=Sold/);
assert.doesNotMatch(activeUrl, /show_only=/);
assert.match(activeUrl, /_sop=10/);

const proofSource = fs.readFileSync("src/lib/instacomp-exact-market-provider.ts", "utf8");
assert.ok(proofSource.includes("providerAcrossQueries"));
assert.ok(proofSource.includes("serpapi_ebay_v6_"));
assert.ok(proofSource.includes("targetExactCount"));
assert.ok(proofSource.includes("strictNumberingGate"));
assert.ok(proofSource.includes("filterStrictExactMarketMatches"));

const openAiWebSource = fs.readFileSync(
  "src/lib/instacomp-openai-web-market-provider.ts",
  "utf8",
);
assert.ok(openAiWebSource.includes('type: "web_search"'));
assert.ok(openAiWebSource.includes('allowed_domains: ["ebay.com"]'));
assert.ok(openAiWebSource.includes("sourceItemIds"));
assert.ok(openAiWebSource.includes("citedIds.has(itemId)"));
assert.ok(openAiWebSource.includes('params.lane === "sold" && !soldAt'));
assert.ok(openAiWebSource.includes("shippingPrice === null"));
assert.ok(openAiWebSource.includes("!title || !imageUrl"));
assert.ok(openAiWebSource.includes("filterStrictExactMarketMatches"));

const sellerRoute = fs.readFileSync(
  "src/app/api/account/seller/inventory/instacomp/route.ts",
  "utf8",
);
assert.ok(sellerRoute.includes("getExactEbayMarketProviders"));
assert.ok(sellerRoute.includes("getOpenAiExactEbayMarketProviders"));
assert.ok(sellerRoute.includes("shouldSearchOpenAiWeb"));
assert.ok(sellerRoute.includes("mergedSoldCandidates"));
assert.ok(sellerRoute.includes("mergedActiveCandidates"));
assert.match(
  sellerRoute,
  /const suggestedPrice\s*=\s*hasReliableSoldComps\s*\?\s*(?:raw)?PricingAnalysis\.suggestedPrice\s*:\s*0\s*;/,
  "Seller pricing must remain $0 without strict exact sold evidence",
);
assert.ok(sellerRoute.includes("soldCompEvidence"));
assert.ok(sellerRoute.includes("activeCompetition"));

const officialCatalogMatch = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Lane Hutson",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Young Guns",
    cardNumber: "C-111",
    parallel: "Canvas Young Guns",
    serialNumber: null,
    team: "Montreal Canadiens",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.95,
    notes: null,
  },
});
assert.equal(officialCatalogMatch?.status, "catalog_confirmed");
assert.equal(officialCatalogMatch?.compIdentity?.cardNumber, "C-111");
assert.equal(officialCatalogMatch?.compIdentity?.year, "2024-25");
assert.match(String(officialCatalogMatch?.compIdentity?.parallel), /Canvas Young Guns/i);

const officialBlackWhiteCanvasVariation = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Lane Hutson",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Black and White Parallel - Young Guns",
    cardNumber: "C-111",
    parallel: "Black and White",
    serialNumber: null,
    team: "Montreal Canadiens",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.95,
    notes: null,
  },
});
assert.equal(officialBlackWhiteCanvasVariation?.status, "catalog_confirmed");
assert.equal(officialBlackWhiteCanvasVariation?.compIdentity?.cardNumber, "C-111");
assert.match(
  String(officialBlackWhiteCanvasVariation?.compIdentity?.parallel),
  /Black and White/i,
);

const unlistedCanvasVariation = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Lane Hutson",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - UD Canvas Sepia Parallel - Young Guns",
    cardNumber: "C-111",
    parallel: "Sepia",
    serialNumber: null,
    team: "Montreal Canadiens",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.95,
    notes: null,
  },
});
assert.notEqual(
  unlistedCanvasVariation?.status,
  "catalog_confirmed",
  "an unlisted Sepia C-111 variation must not be catalog confirmed",
);
assert.equal(
  unlistedCanvasVariation?.compIdentity ?? null,
  null,
  "an unlisted Sepia C-111 variation must not inherit a comp identity",
);
assert.equal(
  unlistedCanvasVariation?.actionPermissions.exactCompSearchAllowed ?? false,
  false,
  "an unlisted Sepia C-111 variation must remain blocked from exact comps",
);

const wrongCatalogParallel = buildInstaCompCuratedChecklistEvidence({
  ai: {
    player: "Connor Bedard",
    year: "2024",
    brand: "Upper Deck",
    setName: "2024-25 Upper Deck Series 1 - City Satellites",
    cardNumber: "CS-11",
    parallel: "Blue parallel",
    serialNumber: null,
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isRookie: false,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.8,
    notes: null,
  },
});
assert.equal(
  wrongCatalogParallel,
  null,
  "an unlisted blue City Satellites variation must not fall back to the base catalog card",
);

const scanSource = fs.readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const benchmarkSource = fs.readFileSync(
  "src/app/api/instacomp/benchmark/ebay-25/route.ts",
  "utf8",
);
const benchmarkTitleSource = fs.readFileSync(
  "src/lib/instacomp-benchmark-title.ts",
  "utf8",
);
assert.ok(scanSource.includes("authorizedEphemeralBenchmark"));
assert.ok(scanSource.includes("const scanId = ephemeralBenchmark"));
assert.ok(benchmarkSource.includes("x-instacomp-benchmark-ephemeral"));
assert.ok(benchmarkTitleSource.includes("benchmarkTitleHasExpectedSerialRun"));

console.log(
  "InstaComp Batch 001 exact-market regression passed: six exact identities, strict player/year/card/parallel/grade/condition/print-run gates, sold and active evidence lists, delivered-price normalization, and sold-only suggested-price trust.",
);
