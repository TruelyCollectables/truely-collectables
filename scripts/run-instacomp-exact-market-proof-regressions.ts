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

  const wrongRun = filterAndRankExactMatches(
    [candidate(card.wrongDenominator, 1, 100 + cardIndex)],
    card.ai,
    20,
    0,
  );
  assert.equal(
    wrongRun.length,
    0,
    `${card.id}: wrong serial run or numbered variation must be rejected`,
  );

  const wrongParallel = filterAndRankExactMatches(
    [candidate(card.wrongParallel, 1, 200 + cardIndex)],
    card.ai,
    20,
    0,
  );
  assert.equal(
    wrongParallel.length,
    0,
    `${card.id}: wrong parallel or wrong grade must be rejected`,
  );

  const lot = filterAndRankExactMatches(
    [candidate(`Lot of 3 ${card.exactTitles[0]}`, 1, 300 + cardIndex)],
    card.ai,
    20,
    0,
  );
  assert.equal(lot.length, 0, `${card.id}: lots must never support single-card pricing`);

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

console.log(
  "InstaComp Batch 001 exact-market regression passed: six exact identities, strict denominator/non-numbered gates, exact parallel/grade rejection, progressive sold+active queries, delivered-price normalization, and sold-backed pricing.",
);