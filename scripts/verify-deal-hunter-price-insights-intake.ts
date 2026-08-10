import assert from "node:assert/strict";
import {
  instaCompAiFromDealHunterCandidate,
  priceInsightsCandidateEligibility,
  registryTruthFromDealHunterCandidate,
} from "../src/lib/deal-hunter-price-insights-capture";
import { filterExactEbayPriceInsightsRows } from "../src/lib/instacomp-ebay-price-insights";

const candidate = {
  id: "candidate-1",
  title: "2024 Bowman Chrome George Lombard Jr Refractor /499 BCP-222",
  identity: {
    player: "George Lombard Jr",
    year: "2024",
    brand: "Bowman Chrome",
    setName: "Prospects",
    cardNumber: "BCP-222",
    parallel: "Refractor",
    serialNumber: "355/499",
    team: "New York Yankees",
    sport: "Baseball",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Ungraded",
    confidence: 0.97,
  },
  exact_market: {
    dealHunterMacFailover: {
      registryIdentityId: "1f68b75e-1c1e-4759-ba09-bf3356bed793",
      registryFingerprintSha256:
        "82e468ff8477159b2cecb1e5654e217f7a07aa20bea8181b863c0aa28c9fd5ce",
    },
  },
  evaluation: {},
};

const registry = registryTruthFromDealHunterCandidate(candidate);
assert.ok(registry);
assert.equal(registry.matched, true);
assert.equal(registry.identityId, "1f68b75e-1c1e-4759-ba09-bf3356bed793");

const ai = instaCompAiFromDealHunterCandidate(candidate);
assert.ok(ai);
assert.equal(ai.player, "George Lombard Jr");
assert.equal(ai.cardNumber, "BCP-222");

const eligibility = priceInsightsCandidateEligibility(candidate);
assert.equal(eligibility.eligible, true);

const exact = filterExactEbayPriceInsightsRows(
  [
    {
      title: "2024 Bowman Chrome Prospects George Lombard Jr #BCP-222 Refractor /499 RC",
      soldAt: "2026-08-05",
      itemPrice: 19.99,
      shippingPrice: 1.5,
      url: "https://www.ebay.com/itm/123456789002",
      condition: "Ungraded - Near Mint or Better",
      buyingOption: "Offer accepted",
    },
  ],
  ai!,
  1,
);
assert.equal(exact.accepted.length, 1);
assert.equal(exact.accepted[0].price, 21.49);
assert.equal(exact.accepted[0].source, "ebay_price_insights_owner_capture");

const wrongParallel = filterExactEbayPriceInsightsRows(
  [
    {
      title: "2024 Bowman Chrome Prospects George Lombard Jr #BCP-222 Blue Refractor /150 RC",
      soldAt: "2026-08-05",
      itemPrice: 12,
      shippingPrice: 1.5,
      url: "https://www.ebay.com/itm/123456789003",
    },
  ],
  ai!,
  1,
);
assert.equal(wrongParallel.accepted.length, 0);
assert.equal(wrongParallel.rejected.length, 1);

const incomplete = priceInsightsCandidateEligibility({
  ...candidate,
  identity: { ...candidate.identity, confidence: 0.8 },
});
assert.equal(incomplete.eligible, false);

const noRegistry = priceInsightsCandidateEligibility({
  ...candidate,
  exact_market: {},
});
assert.equal(noRegistry.eligible, false);

console.log(
  JSON.stringify(
    {
      ok: true,
      candidateBoundRegistry: true,
      requires95PercentIdentity: true,
      exactPriceInsightsAccepted: exact.accepted.length,
      wrongParallelRejected: wrongParallel.rejected.length,
      reusableLandedPrice: exact.accepted[0].price,
    },
    null,
    2,
  ),
);
