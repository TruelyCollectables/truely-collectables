import assert from "node:assert/strict";
import {
  buildDealHunterTargetObservation,
  buildExactMarketObservation,
  calculateExactCardMarketTrend,
  listingItemIdFromUrl,
  persistExactCardMarketHistory,
} from "../src/lib/instacomp-market-history";
import type { InstaCompComp } from "../src/lib/instacomp";

function comp(overrides: Partial<InstaCompComp> = {}): InstaCompComp {
  return {
    title: "2025 Panini Prizm WNBA Sonia Citron Silver #122 RC",
    price: 10,
    itemPrice: 8,
    shippingPrice: 2,
    priceIncludesShipping: false,
    currency: "USD",
    url: "https://www.ebay.com/itm/123456789012",
    imageUrl: null,
    source: "ebay_sold_serpapi_exact",
    sourceLabel: "eBay Sold",
    sourceCategory: "sold",
    matchScore: 0.99,
    flags: [],
    soldAt: "2026-07-01T12:00:00Z",
    observedAt: "2026-07-02T12:00:00Z",
    ...overrides,
  };
}

async function main() {
  assert.equal(
    listingItemIdFromUrl("https://www.ebay.com/itm/123456789012"),
    "123456789012",
  );
  assert.equal(
    listingItemIdFromUrl("https://www.mercari.com/us/item/m12345678901/"),
    "m12345678901",
  );

  const first = buildExactMarketObservation({
    registryIdentityId: "11111111-1111-1111-1111-111111111111",
    kind: "SOLD",
    comp: comp(),
    observedAt: "2026-07-02T12:00:00Z",
    scanId: "scan-1",
  });
  const duplicate = buildExactMarketObservation({
    registryIdentityId: "11111111-1111-1111-1111-111111111111",
    kind: "SOLD",
    comp: comp(),
    observedAt: "2026-08-02T12:00:00Z",
    scanId: "scan-2",
  });
  assert.equal(first.delivered_price, 10);
  assert.equal(
    first.observation_fingerprint,
    duplicate.observation_fingerprint,
    "Repeated discovery of the same sold comp must dedupe.",
  );

  const changedPrice = buildExactMarketObservation({
    registryIdentityId: "11111111-1111-1111-1111-111111111111",
    kind: "ASK",
    comp: comp({
      source: "ebay_active",
      sourceLabel: "eBay Active",
      sourceCategory: "marketplace",
      soldAt: null,
      listedAt: "2026-08-01T12:00:00Z",
      itemPrice: 12,
      shippingPrice: 3,
      price: 15,
    }),
    observedAt: "2026-08-02T12:00:00Z",
  });
  assert.equal(changedPrice.observation_kind, "ASK");
  assert.equal(changedPrice.delivered_price, 15);
  assert.notEqual(first.observation_fingerprint, changedPrice.observation_fingerprint);

  const target = buildDealHunterTargetObservation({
    registryIdentityId: "11111111-1111-1111-1111-111111111111",
    target: {
      title: "Sonia Citron exact target",
      marketplace: "Mercari",
      listingUrl: "https://www.mercari.com/us/item/m12345678901/",
      itemPrice: 7,
      shippingPrice: 6,
      buyerFees: 0.52,
      tax: 1.11,
      deliveredPrice: 14.63,
      currency: "USD",
      conditionText: "Like new",
      observedAt: "2026-08-03T12:00:00Z",
    },
    observedAt: "2026-08-03T12:00:00Z",
    scanId: "scan-target",
  });
  assert.equal(target.item_price, 7);
  assert.equal(target.shipping_price, 6);
  assert.equal(target.buyer_fees, 0.52);
  assert.equal(target.tax, 1.11);
  assert.equal(target.delivered_price, 14.63);

  const trend = calculateExactCardMarketTrend([
    {
      observation_kind: "SOLD",
      delivered_price: 10,
      effective_at: "2026-01-01T00:00:00Z",
      observed_at: "2026-01-02T00:00:00Z",
    },
    {
      observation_kind: "SOLD",
      delivered_price: 12,
      effective_at: "2026-02-01T00:00:00Z",
      observed_at: "2026-02-02T00:00:00Z",
    },
    {
      observation_kind: "SOLD",
      delivered_price: 18,
      effective_at: "2026-07-01T00:00:00Z",
      observed_at: "2026-07-02T00:00:00Z",
    },
    {
      observation_kind: "SOLD",
      delivered_price: 20,
      effective_at: "2026-08-01T00:00:00Z",
      observed_at: "2026-08-02T00:00:00Z",
    },
    {
      observation_kind: "ASK",
      delivered_price: 80,
      effective_at: "2026-08-03T00:00:00Z",
      observed_at: "2026-08-03T00:00:00Z",
    },
  ]);
  assert.equal(trend.direction, "RISING");
  assert.equal(trend.earlySoldMedian, 11);
  assert.equal(trend.recentSoldMedian, 19);
  assert.equal(trend.latestAskDeliveredPrice, 80);
  assert.equal(trend.asksUsedAsSoldValue, false);

  const insufficient = calculateExactCardMarketTrend([
    {
      observation_kind: "ASK",
      delivered_price: 100,
      effective_at: null,
      observed_at: "2026-08-01T00:00:00Z",
    },
  ]);
  assert.equal(insufficient.direction, "INSUFFICIENT_SOLD_HISTORY");
  assert.equal(insufficient.soldMedianAllTime, null);

  const blocked = await persistExactCardMarketHistory({
    registry: { matched: false, identityId: null, fingerprintSha256: null },
    ai: {
      player: "Sonia Citron",
      year: "2025",
      brand: "Panini",
      setName: "Prizm WNBA",
      cardNumber: "122",
      parallel: "Silver",
      serialNumber: null,
      team: "Washington Mystics",
      sport: "Basketball",
      isRookie: true,
      isAuto: false,
      isRelic: false,
      conditionGuess: null,
      confidence: 0.99,
      notes: null,
    },
    sold: [comp()],
    active: [],
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.inserted, 0);

  console.log("InstaComp exact-card market-history simulations passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
