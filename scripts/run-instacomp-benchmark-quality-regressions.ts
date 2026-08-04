import assert from "node:assert/strict";
import { applyInstaCompIdentityGuard } from "../src/lib/instacomp-identity-guard";
import { buildInstaCompCuratedChecklistEvidence } from "../src/lib/instacomp-curated-checklist";
import { mergeExactMarketSources } from "../src/lib/instacomp-live-pipeline";
import { gradeInstaCompBenchmarkParallel } from "../src/lib/instacomp-benchmark-grading";
import type { InstaCompAiResult, InstaCompComp, InstaCompProviderResult } from "../src/lib/instacomp";

function ai(overrides: Partial<InstaCompAiResult>): InstaCompAiResult {
  return {
    player: "Justin Brazeau",
    year: "2024",
    brand: "Upper Deck",
    setName: "Upper Deck Series 1 Young Guns",
    cardNumber: "222",
    parallel: "Base",
    serialNumber: null,
    team: "Boston Bruins",
    sport: "Hockey",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    conditionGuess: null,
    confidence: 0.95,
    notes: null,
    ...overrides,
  };
}

const negatedAcetate = applyInstaCompIdentityGuard(
  ai({ notes: "No foil, color, clear-stock, or acetate cues are visible." }),
);
assert.equal(
  /acetate|clear/i.test(String(negatedAcetate.parallel || "")),
  false,
  "A negated acetate observation must never manufacture an acetate parallel.",
);

const positiveAcetate = applyInstaCompIdentityGuard(
  ai({
    parallel: "Base",
    notes: "The card is printed on transparent acetate stock with a clear back.",
  }),
);
assert.equal(
  /acetate|clear cut/i.test(String(positiveAcetate.parallel || "")),
  true,
  "Positive clear-stock evidence should still trigger review or Clear Cut handling.",
);

const mattRempeCatalog = buildInstaCompCuratedChecklistEvidence({
  ai: ai({
    player: "Matti Rempe",
    year: "2023-24",
    cardNumber: "216",
    team: "New York Rangers",
    notes: "Young Guns card. No acetate or clear-stock cues.",
  }),
});
assert.ok(mattRempeCatalog, "Catalog should recover the official card from card number, set, brand, and team.");
assert.equal(mattRempeCatalog?.compIdentity?.player, "Matt Rempe");
assert.equal(mattRempeCatalog?.compIdentity?.year, "2024-25");
assert.equal(mattRempeCatalog?.compIdentity?.cardNumber, "216");
assert.equal(mattRempeCatalog?.compIdentity?.parallel, "Base");

const yanCatalog = buildInstaCompCuratedChecklistEvidence({
  ai: ai({
    player: "Ilya Kuznetsov",
    year: "2024",
    cardNumber: "235",
    team: "Calgary Flames",
    notes: "Upper Deck Series 1 Young Guns. No acetate cues.",
  }),
});
assert.ok(yanCatalog, "Catalog should recover Yan Kuznetsov from the unique official checklist row.");
assert.equal(yanCatalog?.compIdentity?.player, "Yan Kuznetsov");
assert.equal(yanCatalog?.compIdentity?.year, "2024-25");

const actualClearVariation = buildInstaCompCuratedChecklistEvidence({
  ai: ai({
    cardNumber: "222",
    parallel: "Clear Cut",
    notes: "Transparent clear stock and centered back logo confirm Clear Cut.",
  }),
});
assert.equal(
  actualClearVariation,
  null,
  "The base checklist row must not overwrite a positively confirmed Clear Cut variation.",
);

const falseAcetateGrade = gradeInstaCompBenchmarkParallel({
  expected: {
    setName: "Base Set - Young Guns",
    setAliases: ["Young Guns"],
    parallel: "Base",
    parallelAliases: ["Base Young Guns", "Young Guns"],
  },
  actualParallel: "Acetate / clear parallel - exact type uncertain",
  actualSetName: "Upper Deck Series 1 Young Guns",
});
assert.equal(falseAcetateGrade.status, "fail");

const baseGrade = gradeInstaCompBenchmarkParallel({
  expected: {
    setName: "Base Set - Young Guns",
    setAliases: ["Young Guns"],
    parallel: "Base",
    parallelAliases: ["Base Young Guns", "Young Guns"],
  },
  actualParallel: null,
  actualSetName: "Upper Deck Series 1 Young Guns",
});
assert.equal(baseGrade.status, "pass");

const activeComp: InstaCompComp = {
  title: "2024-25 Upper Deck Series 1 Justin Brazeau Young Guns #222",
  price: 4.99,
  itemPrice: 4.99,
  shippingPrice: 0,
  priceIncludesShipping: true,
  currency: "USD",
  url: "https://www.ebay.com/itm/123456789012",
  imageUrl: null,
  source: "serpapi_active",
  sourceLabel: "eBay Active",
  sourceCategory: "marketplace",
  matchScore: 100,
  flags: [],
  observedAt: new Date().toISOString(),
};

function provider(
  source: string,
  status: InstaCompProviderResult["status"],
  results: InstaCompComp[],
): InstaCompProviderResult {
  return {
    source,
    label: source,
    status,
    message: status === "error" ? "timed out" : null,
    results,
  };
}

const partialMarket = mergeExactMarketSources([
  {
    sold: provider("serpapi_sold", "error", []),
    active: provider("serpapi_active", "live", [activeComp]),
  },
]);
assert.equal(partialMarket.status, "partial_provider_error");
assert.equal(partialMarket.active.length, 1);
assert.equal(partialMarket.trustedSuggestedPrice, null);

const activeOnlyMarket = mergeExactMarketSources([
  {
    sold: provider("serpapi_sold", "no_matches", []),
    active: provider("serpapi_active", "live", [activeComp]),
  },
]);
assert.equal(activeOnlyMarket.status, "active_only");
assert.equal(activeOnlyMarket.trustedSuggestedPrice, null);

console.log("InstaComp benchmark quality regressions passed.");
