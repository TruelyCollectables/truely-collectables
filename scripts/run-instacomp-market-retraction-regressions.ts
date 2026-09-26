import assert from "node:assert/strict";
import {
  calculateExactCardMarketTrend,
  filterRetractedMarketObservations,
  type ExactMarketObservation,
} from "../src/lib/instacomp-market-history";

const rows: ExactMarketObservation[] = [
  {
    id: "bad-ask",
    registry_identity_id: "11111111-1111-4111-8111-111111111111",
    observation_fingerprint: "a".repeat(64),
    observation_kind: "ASK",
    marketplace: "eBay",
    provider_source: "deal_hunter_target",
    listing_item_id: "128038039130",
    listing_url: "https://www.ebay.com/itm/128038039130",
    title: "Kiki Iriafen WNBA card incorrectly bound to another identity",
    item_price: 9.99,
    shipping_price: 0,
    buyer_fees: 0,
    tax: 0,
    delivered_price: 9.99,
    currency: "USD",
    condition_text: null,
    match_score: 1,
    effective_at: "2026-08-21T20:00:00.000Z",
    observed_at: "2026-08-21T20:00:00.000Z",
    scan_id: "scan-bad",
    source_payload: {},
  },
  {
    id: "good-sold",
    registry_identity_id: "11111111-1111-4111-8111-111111111111",
    observation_fingerprint: "b".repeat(64),
    observation_kind: "SOLD",
    marketplace: "eBay",
    provider_source: "ebay_sold",
    listing_item_id: "999999999999",
    listing_url: "https://www.ebay.com/itm/999999999999",
    title: "Trusted exact sold",
    item_price: 24,
    shipping_price: 1,
    buyer_fees: null,
    tax: null,
    delivered_price: 25,
    currency: "USD",
    condition_text: null,
    match_score: 1,
    effective_at: "2026-08-21T19:00:00.000Z",
    observed_at: "2026-08-21T19:05:00.000Z",
    scan_id: "scan-good",
    source_payload: {},
  },
];

const trusted = filterRetractedMarketObservations(rows, ["bad-ask"]);
assert.deepEqual(
  trusted.map((row) => row.id),
  ["good-sold"],
  "a retracted immutable observation must be excluded while unrelated exact history remains",
);

const trend = calculateExactCardMarketTrend(trusted);
assert.equal(trend.askObservationCount, 0);
assert.equal(trend.soldObservationCount, 1);
assert.equal(trend.latestAskDeliveredPrice, null);
assert.equal(trend.latestSoldDeliveredPrice, 25);
assert.equal(trend.asksUsedAsSoldValue, false);

assert.deepEqual(
  filterRetractedMarketObservations(rows, []),
  rows,
  "an empty retraction set must preserve existing exact-card history",
);

console.log(
  "PASS append-only market retractions exclude known-bad observations before exact-card trend calculations without deleting trusted history",
);
