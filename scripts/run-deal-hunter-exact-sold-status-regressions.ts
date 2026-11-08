import assert from "node:assert/strict";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
import type { InstaCompProviderResult } from "../src/lib/instacomp";

function provider(
  source: string,
  status: InstaCompProviderResult["status"],
): InstaCompProviderResult {
  return {
    source,
    label: source,
    status,
    message: null,
    results: [],
  };
}

const officialActiveOnly = {
  sold: provider("ebay_official_sold_unavailable", "not_configured"),
  active: provider("ebay_active", "live"),
};

const healthyZeroSold = mergeExactMarketSources([
  {
    sold: provider("ebay_sold_serpapi_exact", "no_matches"),
    active: provider("ebay_active_serpapi_exact", "no_matches"),
  },
  officialActiveOnly,
]);
assert.equal(
  healthyZeroSold.status,
  "no_exact_sold",
  "Intentional official-eBay sold unavailability must not masquerade as a provider failure.",
);

const actualSoldFailure = mergeExactMarketSources([
  {
    sold: provider("ebay_sold_serpapi_exact", "error"),
    active: provider("ebay_active_serpapi_exact", "live"),
  },
  officialActiveOnly,
]);
assert.equal(
  actualSoldFailure.status,
  "provider_error",
  "A real failure of the pricing-capable sold provider must remain provider_error.",
);

const soldProviderMissing = mergeExactMarketSources([
  {
    sold: provider("ebay_sold_serpapi_exact", "not_configured"),
    active: provider("ebay_active_serpapi_exact", "live"),
  },
  officialActiveOnly,
]);
assert.equal(
  soldProviderMissing.status,
  "provider_error",
  "A missing pricing-capable sold provider must remain provider_error.",
);

console.log("Deal Hunter exact sold status regressions passed (3/3).");
