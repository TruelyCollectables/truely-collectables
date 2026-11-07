import assert from "node:assert/strict";
import type {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
} from "../src/lib/instacomp";
import {
  buildExactIdentityTitle,
  dedupeExactMarketComps,
  mergeExactMarketSources,
  missingExactIdentityFields,
} from "../src/lib/instacomp-live-pipeline";

const ai: InstaCompAiResult = {
  player: "Test Player",
  year: "2025",
  brand: "Topps",
  setName: "Chrome",
  cardNumber: "123",
  parallel: "Gold Refractor",
  serialNumber: "12/50",
  gradingCompany: null,
  gradeValue: null,
  certificationNumber: null,
  team: "Test Team",
  sport: "Baseball",
  isRookie: true,
  isAuto: false,
  isRelic: false,
  conditionGuess: "raw",
  confidence: 0.97,
  notes: null,
};

function comp(params: {
  title: string;
  price: number;
  url: string;
  lane: "sold" | "active";
  delivered?: boolean;
  shippingFlagOnly?: boolean;
  discoveryOnly?: boolean;
}): InstaCompComp {
  const delivered = params.delivered !== false;
  return {
    title: params.title,
    price: params.price,
    itemPrice: params.shippingFlagOnly ? undefined : params.price,
    shippingPrice: params.shippingFlagOnly ? undefined : delivered ? 0 : null,
    priceIncludesShipping: params.shippingFlagOnly ? undefined : delivered,
    currency: "USD",
    url: params.url,
    imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",
    source: params.discoveryOnly
      ? params.lane === "sold"
        ? "openai_web_ebay_sold_exact"
        : "openai_web_ebay_active_exact"
      : params.lane === "sold"
        ? "test_sold"
        : "test_active",
    sourceLabel: params.lane === "sold" ? "Test Sold" : "Test Active",
    sourceCategory: params.discoveryOnly
      ? "reference"
      : params.lane === "sold"
        ? "sold"
        : "marketplace",
    matchScore: 100,
    flags: [
      "strict exact identity",
      "exact print run /50",
      ...(params.shippingFlagOnly ? ["shipping not reported"] : []),
      ...(params.discoveryOnly ? ["not independently verified for pricing"] : []),
    ],
    soldAt: params.lane === "sold" ? "2026-07-20" : null,
    listedAt: params.lane === "active" ? "2026-07-21" : null,
  };
}

function provider(
  lane: "sold" | "active",
  results: InstaCompComp[],
  status: InstaCompProviderResult["status"] = results.length ? "live" : "no_matches",
): InstaCompProviderResult {
  return {
    source: lane === "sold" ? "test_sold" : "test_active",
    label: lane === "sold" ? "Test Sold" : "Test Active",
    status,
    message: null,
    results,
  };
}

const title = buildExactIdentityTitle(ai);
assert.match(title, /2025 Topps Chrome Test Player RC Gold Refractor #123 \/50/);
assert.deepEqual(missingExactIdentityFields(ai), []);
assert.deepEqual(
  missingExactIdentityFields({ ...ai, cardNumber: null, setName: null }),
  ["set", "card number"],
);

const duplicateSold = [
  comp({
    title,
    price: 20,
    url: "https://www.ebay.com/itm/123?foo=1",
    lane: "sold",
  }),
  comp({
    title,
    price: 20,
    url: "https://www.ebay.com/itm/123?bar=2",
    lane: "sold",
  }),
];
assert.equal(dedupeExactMarketComps(duplicateSold).length, 1);

const shippingUnknown = comp({
  title,
  price: 20,
  url: "https://www.ebay.com/itm/shipping-unknown",
  lane: "sold",
  delivered: false,
});
assert.equal(
  dedupeExactMarketComps([shippingUnknown]).length,
  0,
  "A provider row with priceIncludesShipping=false must not enter trusted pricing.",
);

const shippingUnknownByFlag = comp({
  title,
  price: 20,
  url: "https://www.ebay.com/itm/shipping-flag-unknown",
  lane: "sold",
  shippingFlagOnly: true,
});
assert.equal(
  dedupeExactMarketComps([shippingUnknownByFlag]).length,
  0,
  "A SerpApi row flagged shipping not reported must not enter trusted pricing.",
);

const discoveryOnlySold = comp({
  title,
  price: 999,
  url: "https://www.ebay.com/itm/discovery-only",
  lane: "sold",
  discoveryOnly: true,
});
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
assert.equal(activeOnly.status, "no_exact_sold");
assert.equal(activeOnly.trustedSuggestedPrice, null);
assert.equal(activeOnly.pricing.strategy, "active_only");

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
  "InstaComp live-pipeline regressions passed: identity gating, exact comp dedupe, delivered-price enforcement, discovery-only exclusion, sold-backed pricing, active-only refusal, and provider failure handling.",
);
