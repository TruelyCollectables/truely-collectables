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
}): InstaCompComp {
  return {
    title: params.title,
    price: params.price,
    currency: "USD",
    url: params.url,
    imageUrl: "https://example.com/card.jpg",
    source: params.lane === "sold" ? "test_sold" : "test_active",
    sourceLabel: params.lane === "sold" ? "Test Sold" : "Test Active",
    sourceCategory: params.lane === "sold" ? "sold" : "marketplace",
    matchScore: 100,
    flags: ["strict exact identity", "exact print run /50"],
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
    title: title,
    price: 20,
    url: "https://www.ebay.com/itm/123?foo=1",
    lane: "sold",
  }),
  comp({
    title: title,
    price: 20,
    url: "https://www.ebay.com/itm/123?bar=2",
    lane: "sold",
  }),
];
assert.equal(dedupeExactMarketComps(duplicateSold).length, 1);

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

console.log(
  "InstaComp live-pipeline regressions passed: identity gating, exact comp dedupe, sold-backed pricing, active-only refusal, and provider failure handling.",
);
