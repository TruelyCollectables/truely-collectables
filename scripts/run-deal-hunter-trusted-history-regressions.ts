import assert from "node:assert/strict";
import { trustedHistoricalSoldPricing } from "../src/lib/deal-hunter-trusted-sold-history";
import type { ExactMarketObservation } from "../src/lib/instacomp-market-history";

const identityId = "11111111-1111-1111-1111-111111111111";
const fingerprint = "a".repeat(64);
const now = new Date("2026-08-08T23:00:00Z");

function soldRow(overrides: Partial<ExactMarketObservation> = {}): ExactMarketObservation {
  return {
    registry_identity_id: identityId,
    observation_fingerprint: "b".repeat(64),
    observation_kind: "SOLD",
    marketplace: "eBay",
    provider_source: "ebay_sold_serpapi_exact",
    listing_item_id: "123456789012",
    listing_url: "https://www.ebay.com/itm/123456789012",
    title: "2025 Panini Prizm WNBA Exact Card #123",
    item_price: 20,
    shipping_price: 5,
    buyer_fees: null,
    tax: null,
    delivered_price: 25,
    currency: "USD",
    condition_text: null,
    match_score: 0.99,
    effective_at: "2026-08-01T12:00:00Z",
    observed_at: "2026-08-01T12:05:00Z",
    scan_id: "scan-1",
    source_payload: {
      title: "2025 Panini Prizm WNBA Exact Card #123",
      price: 25,
      itemPrice: 20,
      shippingPrice: 5,
      priceIncludesShipping: true,
      currency: "USD",
      url: "https://www.ebay.com/itm/123456789012",
      imageUrl: null,
      source: "ebay_sold_serpapi_exact",
      sourceLabel: "eBay Sold",
      sourceCategory: "sold",
      matchScore: 0.99,
      flags: [],
      soldAt: "2026-08-01T12:00:00Z",
      observedAt: "2026-08-01T12:05:00Z",
    },
    ...overrides,
  };
}

const history = {
  identity: {
    registry_identity_id: identityId,
    registry_fingerprint_sha256: fingerprint,
  },
  observations: [
    soldRow(),
    soldRow({
      observation_fingerprint: "c".repeat(64),
      listing_item_id: "123456789013",
      delivered_price: 35,
      effective_at: "2026-08-03T12:00:00Z",
      source_payload: {
        ...(soldRow().source_payload as Record<string, unknown>),
        price: 35,
        itemPrice: 30,
        url: "https://www.ebay.com/itm/123456789013",
        soldAt: "2026-08-03T12:00:00Z",
      },
    }),
    soldRow({
      observation_fingerprint: "d".repeat(64),
      observation_kind: "ASK",
      delivered_price: 999,
      source_payload: {
        ...(soldRow().source_payload as Record<string, unknown>),
        sourceCategory: "marketplace",
      },
    }),
  ],
};

const trusted = trustedHistoricalSoldPricing({
  history,
  registryIdentityId: identityId,
  registryFingerprintSha256: fingerprint,
  now,
});
assert.ok(trusted);
assert.equal(trusted.soldCount, 2);
assert.equal(trusted.medianDeliveredPrice, 30);

assert.equal(
  trustedHistoricalSoldPricing({
    history,
    registryIdentityId: identityId,
    registryFingerprintSha256: "e".repeat(64),
    now,
  }),
  null,
  "Fingerprint drift must block historical pricing.",
);

const stale = trustedHistoricalSoldPricing({
  history: {
    ...history,
    observations: [soldRow({ effective_at: "2026-01-01T12:00:00Z" })],
  },
  registryIdentityId: identityId,
  registryFingerprintSha256: fingerprint,
  now,
});
assert.equal(stale, null, "Sold observations older than 90 days must not price a current deal.");

const lowMatch = trustedHistoricalSoldPricing({
  history: { ...history, observations: [soldRow({ match_score: 0.90 })] },
  registryIdentityId: identityId,
  registryFingerprintSha256: fingerprint,
  now,
});
assert.equal(lowMatch, null, "Low-match historical rows must not create pricing authority.");

const unknownShipping = soldRow({
  source_payload: {
    ...(soldRow().source_payload as Record<string, unknown>),
    priceIncludesShipping: false,
    shippingPrice: null,
    flags: ["shipping unknown"],
  },
});
assert.equal(
  trustedHistoricalSoldPricing({
    history: { ...history, observations: [unknownShipping] },
    registryIdentityId: identityId,
    registryFingerprintSha256: fingerprint,
    now,
  }),
  null,
  "Rows that fail today's pricing-eligibility guard must not be resurrected from history.",
);

console.log("Deal Hunter trusted sold-history regressions passed (5/5).");
