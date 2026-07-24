import { applyActiveMarketConsensus } from "../src/lib/active-market-consensus";

type Json = Record<string, any>;

type Scenario = {
  name: string;
  attack: Json;
  verify: (result: ReturnType<typeof applyActiveMarketConsensus>) => void;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function candidate(
  id: string,
  sellerUsername: string | null,
  landedPrice: number | null,
  overrides: Json = {},
): Json {
  const shippingCost = landedPrice === null ? null : 4.99;
  const price = landedPrice === null ? 20 : landedPrice - (shippingCost || 0);
  return {
    legacyItemId: id,
    itemId: id,
    title: `2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1 ${id}`,
    price,
    shippingCost,
    shippingKnown: shippingCost !== null,
    landedPrice,
    fixedPrice: true,
    matchLevel: "exact",
    matchScore: 96,
    directProofConfirmed: true,
    sellerUsername,
    url: `https://www.ebay.com/itm/${id}`,
    flags: [],
    ...overrides,
  };
}

function attack(competitors: Json[], overrides: Json = {}): Json {
  return {
    ourItemPrice: 30,
    ourShipping: 6.99,
    ourLanded: 36.99,
    profitFloor: null,
    competitors,
    exactActiveCount: competitors.length,
    strictExactCount: competitors.length,
    strongMatchCount: 0,
    scoutingCandidates: [],
    scoutingCount: 0,
    suggestions: [],
    ...overrides,
  };
}

const scenarios: Scenario[] = [
  {
    name: "two independent sellers with a tight spread establish limited consensus",
    attack: attack([
      candidate("111111111111", "seller-a", 20),
      candidate("222222222222", "seller-b", 23),
    ]),
    verify(result) {
      assert(result.passed, "Expected two-seller consensus to pass");
      assert(result.level === "two_seller_limited", "Expected limited consensus level");
      assert(result.independentSellerCount === 2, "Expected two sellers");
      assert(result.attack.lowestCompetitorLanded === 20, "Expected $20 baseline");
      assert(result.attack.suggestions.length === 5, "Expected five strategies");
    },
  },
  {
    name: "duplicate listings from one seller cannot create consensus",
    attack: attack([
      candidate("111111111111", "same-seller", 20),
      candidate("222222222222", "same-seller", 21),
    ]),
    verify(result) {
      assert(!result.passed, "One seller must not establish consensus");
      assert(result.level === "single_seller", "Expected single-seller level");
      assert(result.duplicateSellerCount === 1, "Expected one duplicate seller listing");
      assert(result.attack.competitors.length === 1, "Only one seller representative should remain");
      assert(result.attack.scoutingCandidates.length === 1, "Duplicate should become scouting");
      assert(result.attack.suggestions.length === 0, "Blocked consensus must clear strategies");
    },
  },
  {
    name: "isolated low-price outlier is removed before pricing",
    attack: attack([
      candidate("111111111111", "seller-a", 10),
      candidate("222222222222", "seller-b", 30),
      candidate("333333333333", "seller-c", 31),
    ]),
    verify(result) {
      assert(result.passed, "Two remaining sellers should establish consensus");
      assert(result.outlierCount === 1, "Expected one low outlier");
      assert(result.attack.competitors.length === 2, "Expected two inlier competitors");
      assert(result.attack.lowestCompetitorLanded === 30, "Outlier must not set the baseline");
      assert(
        result.attack.scoutingCandidates.some((entry: Json) =>
          entry.marketConsensusReasons?.includes("isolated low-price outlier"),
        ),
        "Low outlier should be visible in scouting",
      );
    },
  },
  {
    name: "isolated high-price outlier is removed from consensus weighting",
    attack: attack([
      candidate("111111111111", "seller-a", 20),
      candidate("222222222222", "seller-b", 21),
      candidate("333333333333", "seller-c", 60),
    ]),
    verify(result) {
      assert(result.passed, "Two remaining sellers should pass");
      assert(result.outlierCount === 1, "Expected one high outlier");
      assert(result.attack.competitors.length === 2, "Expected two inliers");
      assert(result.attack.lowestCompetitorLanded === 20, "Expected $20 baseline");
    },
  },
  {
    name: "two independent sellers with a wide spread are guidance-only",
    attack: attack([
      candidate("111111111111", "seller-a", 20),
      candidate("222222222222", "seller-b", 35),
    ]),
    verify(result) {
      assert(!result.passed, "Wide two-seller spread must be blocked");
      assert(result.level === "wide_spread_blocked", "Expected wide-spread level");
      assert(result.attack.lowestCompetitor === null, "Blocked spread must clear leader");
      assert(result.attack.suggestions.length === 0, "Blocked spread must clear strategies");
    },
  },
  {
    name: "missing seller identity is review-only",
    attack: attack([candidate("111111111111", null, 20)]),
    verify(result) {
      assert(!result.passed, "Unknown seller must not establish consensus");
      assert(result.independentSellerCount === 0, "Expected zero proved sellers");
      assert(result.attack.competitors.length === 0, "Unknown seller should leave pricing board");
      assert(result.attack.scoutingCandidates.length === 1, "Unknown seller should remain visible");
    },
  },
  {
    name: "unknown landed price is review-only",
    attack: attack([candidate("111111111111", "seller-a", null)]),
    verify(result) {
      assert(!result.passed, "Unknown landed price must not establish consensus");
      assert(result.attack.competitors.length === 0, "Unknown landed price should leave pricing board");
      assert(result.attack.scoutingCandidates.length === 1, "Unknown shipping should remain visible");
    },
  },
  {
    name: "three equal independent sellers establish strong consensus",
    attack: attack([
      candidate("111111111111", "seller-a", 25),
      candidate("222222222222", "seller-b", 25),
      candidate("333333333333", "seller-c", 25),
    ]),
    verify(result) {
      assert(result.passed, "Three equal sellers should pass");
      assert(result.level === "three_plus_strong", "Expected strong consensus");
      assert(result.medianLandedPrice === 25, "Expected $25 median");
      assert(result.spreadPercent === 0, "Expected zero spread");
    },
  },
  {
    name: "same seller duplicate keeps the lowest current threat only",
    attack: attack([
      candidate("111111111111", "seller-a", 28),
      candidate("222222222222", "seller-a", 22),
      candidate("333333333333", "seller-b", 24),
    ]),
    verify(result) {
      assert(result.passed, "Two independent sellers should pass");
      assert(result.duplicateSellerCount === 1, "Expected one duplicate");
      assert(result.attack.lowestCompetitorLanded === 22, "Lowest same-seller listing should remain");
      assert(
        !result.attack.competitors.some((entry: Json) => entry.landedPrice === 28),
        "Higher same-seller duplicate must not remain in pricing",
      );
    },
  },
  {
    name: "three sellers with a broad non-outlier spread are blocked",
    attack: attack([
      candidate("111111111111", "seller-a", 20),
      candidate("222222222222", "seller-b", 35),
      candidate("333333333333", "seller-c", 50),
    ]),
    verify(result) {
      assert(!result.passed, "Broad spread must be blocked");
      assert(result.level === "wide_spread_blocked", "Expected wide spread block");
      assert(result.outlierCount === 0, "This should be a spread block, not an outlier removal");
      assert(result.attack.suggestions.length === 0, "No strategies when spread is unresolved");
    },
  },
];

let passed = 0;
for (const scenario of scenarios) {
  const result = applyActiveMarketConsensus({ attack: scenario.attack });
  scenario.verify(result);
  passed += 1;
  console.log(`PASS ${scenario.name}`);
}

console.log(`Active Market consensus simulations passed: ${passed}/${scenarios.length}`);
