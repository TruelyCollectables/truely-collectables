import assert from "node:assert/strict";
import fs from "node:fs";
import {
  filterAndRankExactMatches,
  normalizeInstaCompParallelForExactMatching,
  type InstaCompAiResult,
} from "../src/lib/instacomp";
import {
  buildExactEbayQueryLadder,
  buildSerpApiEbayRequestUrl,
  normalizeEbaySerpItems,
} from "../src/lib/instacomp-ebay-serp-provider";
import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";

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
  const rows = filterAndRankExactMatches([candidate(title, 1, index)], card.ai, 20, 0);
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
  const accepted = filterAndRankExactMatches(exactRows, card.ai, 20, 35);
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
      .replace(/swatches?|patches?|jerseys?|relics?|memorabilia|materials?/gi, "Insert")
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
assert.equal(normalized[0].soldDate, "Jul 20, 2026");

const soldUrl = buildSerpApiEbayRequestUrl("exact card", "sold").toString();
const activeUrl = buildSerpApiEbayRequestUrl("exact card", "active").toString();
assert.match(soldUrl, /show_only=Sold/);
assert.doesNotMatch(activeUrl, /show_only=/);
assert.match(activeUrl, /_sop=10/);

const proofSource = fs.readFileSync("src/lib/instacomp-ebay-serp-provider.ts", "utf8");
assert.ok(proofSource.includes("providerAcrossQueries"));
assert.ok(proofSource.includes("serpapi_ebay_v6_"));
assert.ok(proofSource.includes("targetExactCount"));
assert.ok(proofSource.includes("priceIncludesShipping: true"));
assert.ok(proofSource.includes("candidateDenominator !== null"));
assert.ok(proofSource.includes('flags.includes("grade")'));

const universalRoute = fs.readFileSync(
  "src/app/api/account/seller/inventory/instacomp-universal/route.ts",
  "utf8",
);
const excludeRoute = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",
  "utf8",
);
assert.ok(
  universalRoute.includes(
    "const suggestedPrice = hasReliableSoldComps ? pricingAnalysis.suggestedPrice : 0",
  ),
  "Universal pricing must remain $0 without exact sold evidence",
);
assert.ok(
  excludeRoute.includes(
    "const suggestedPrice = hasReliableSoldComps ? pricingAnalysis.suggestedPrice : 0",
  ),
  "Excluding the last exact sold comp must reset suggestion to $0",
);

console.log(
  "InstaComp Batch 001 exact-market regression passed: six exact identities, strict player/year/card/parallel/grade/condition/print-run gates, three-dimensional sold+active evidence, delivered-price normalization, and sold-only suggested-price trust.",
);