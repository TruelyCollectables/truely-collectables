import assert from "node:assert/strict";
import type { InstaCompAiResult, InstaCompComp, InstaCompProviderResult } from "../src/lib/instacomp";
import {
  buildExactIdentityTitle,
  dedupeExactMarketComps,
  mergeExactMarketSources,
  missingExactIdentityFields,
} from "../src/lib/instacomp-live-pipeline";

function card(overrides: Partial<InstaCompAiResult> = {}): InstaCompAiResult {
  return {
    player: "Connor Bedard",
    year: "2023-24",
    brand: "Upper Deck",
    setName: "Upper Deck Series 2 Hockey",
    cardNumber: "451",
    parallel: "Young Guns",
    serialNumber: null,
    gradingCompany: null,
    gradeValue: null,
    certificationNumber: null,
    certificationLookupUrl: null,
    gradingEvidence: null,
    team: "Chicago Blackhawks",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: "Raw",
    confidence: 0.97,
    notes: "Front and back match.",
    ...overrides,
  };
}

function comp(params: {
  title: string;
  price: number;
  url: string;
  lane: "sold" | "active";
  soldAt?: string | null;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  priceIncludesShipping?: boolean;
  flags?: string[];
}): InstaCompComp {
  return {
    title: params.title,
    price: params.price,
    itemPrice: params.itemPrice ?? params.price,
    shippingPrice: params.shippingPrice ?? 0,
    priceIncludesShipping: params.priceIncludesShipping ?? true,
    currency: "USD",
    url: params.url,
    imageUrl: null,
    source: params.lane === "sold" ? "serpapi_sold" : "serpapi_active",
    sourceLabel: params.lane === "sold" ? "eBay Sold" : "eBay Active",
    sourceCategory: params.lane === "sold" ? "sold" : "marketplace",
    matchScore: 100,
    flags: params.flags || [],
    soldAt:
      params.lane === "sold"
        ? params.soldAt === undefined
          ? "2026-07-20"
          : params.soldAt
        : null,
    observedAt: "2026-07-26T00:00:00.000Z",
  };
}

function provider(
  source: string,
  results: InstaCompComp[],
  status: InstaCompProviderResult["status"] = results.length ? "live" : "no_matches",
): InstaCompProviderResult {
  return {
    source,
    label: source,
    status,
    message: status === "error" ? "provider failed" : null,
    results,
  };
}

const exactCard = card();
assert.deepEqual(missingExactIdentityFields(exactCard), []);
assert.equal(
  buildExactIdentityTitle(exactCard),
  "2023-24 Upper Deck Upper Deck Series 2 Hockey Connor Bedard RC Young Guns #451 Raw",
);

const missing = card({ cardNumber: null, year: null });
assert.deepEqual(missingExactIdentityFields(missing), ["year", "card number"]);

const title = "2023-24 Upper Deck Series 2 Connor Bedard Young Guns #451 RC";
const soldWithoutDate = comp({
  title,
  price: 30,
  url: "https://www.ebay.com/itm/no-date",
  lane: "sold",
  soldAt: null,
});
assert.equal(
  dedupeExactMarketComps([soldWithoutDate]).length,
  0,
  "A sold row without a sold date must not enter trusted pricing.",
);

const unknownShipping = comp({
  title,
  price: 30,
  url: "https://www.ebay.com/itm/unknown-shipping",
  lane: "sold",
  priceIncludesShipping: false,
  flags: ["shipping not reported"],
});
assert.equal(
  dedupeExactMarketComps([unknownShipping]).length,
  0,
  "Shipping-unknown rows must not enter trusted pricing.",
);

const discoveryOnlySold = {
  ...comp({
    title,
    price: 19.99,
    url: "https://example.com/openai-discovery-row",
    lane: "sold",
  }),
  source: "openai_web_sold",
  sourceLabel: "OpenAI Web Search Sold Discovery",
  flags: ["discovery candidate", "not independently verified for pricing"],
};
assert.equal(
  dedupeExactMarketComps([discoveryOnlySold]).length,
  0,
  "A direct-cited OpenAI discovery row must never enter trusted pricing.",
);
const discoveryOnlySummary = mergeExactMarketSources([
  {
    sold: provider("sold", [discoveryOnlySold]),
    active: provider("active", []),
  },
]);
assert.equal(discoveryOnlySummary.sold.length, 1, "Discovery evidence may remain visible.");
assert.equal(discoveryOnlySummary.pricing.soldCount, 0);
assert.equal(discoveryOnlySummary.trustedSuggestedPrice, null);

const sold = [
  comp({ title, price: 20, url: "https://www.ebay.com/itm/1", lane: "sold" }),
  comp({ title, price: 24, url: "https://www.ebay.com/itm/2", lane: "sold" }),
  comp({ title, price: 22, url: "https://www.ebay.com/itm/3", lane: "sold" }),
];
const active = [
  comp({ title, price: 29, url: "https://www.ebay.com/itm/4", lane: "active" }),
  comp({ title, price: 31, url: "https://www.ebay.com/itm/5", lane: "active" }),
];
const trusted = mergeExactMarketSources([
  { sold: provider("sold", sold), active: provider("active", active) },
]);
assert.equal(trusted.status, "ready");
assert.equal(trusted.sold.length, 3);
assert.equal(trusted.active.length, 2);
assert.ok(trusted.trustedSuggestedPrice && trusted.trustedSuggestedPrice > 0);

const activeOnly = mergeExactMarketSources([
  { sold: provider("sold", []), active: provider("active", active) },
]);
assert.equal(activeOnly.status, "active_only");
assert.equal(activeOnly.trustedSuggestedPrice, null);
assert.equal(activeOnly.pricing.strategy, "active_only");

const partialProviderFailure = mergeExactMarketSources([
  {
    sold: provider("sold", [], "error"),
    active: provider("active", active),
  },
]);
assert.equal(partialProviderFailure.status, "partial_provider_error");
assert.equal(partialProviderFailure.active.length, 2);
assert.equal(partialProviderFailure.trustedSuggestedPrice, null);

const providerFailure = mergeExactMarketSources([
  {
    sold: provider("sold", [], "error"),
    active: provider("active", [], "error"),
  },
]);
assert.equal(providerFailure.status, "provider_error");
assert.equal(providerFailure.trustedSuggestedPrice, null);

const providerMissing = mergeExactMarketSources([
  {
    sold: provider("sold", [], "not_configured"),
    active: provider("active", [], "not_configured"),
  },
]);
assert.equal(providerMissing.status, "provider_error");
assert.equal(providerMissing.trustedSuggestedPrice, null);

console.log(
  "InstaComp live-pipeline regressions passed: identity gating, exact comp dedupe, delivered-price enforcement, discovery-only exclusion, sold-backed pricing, active-only and partial-provider states, and provider failure handling.",
);
