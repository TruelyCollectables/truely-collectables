import {
  auditActiveMarketIntegrity,
  classifyActiveMarketPackagingState,
} from "../src/lib/active-market-integrity-audit";

type Json = Record<string, any>;

type Scenario = {
  name: string;
  attack: Json;
  tracking: Json;
  selfListingId?: string | null;
  expectedPass: boolean;
  expectedFailure?: string;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const competitor = {
  legacyItemId: "111",
  itemId: "111",
  title: "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1",
  price: 24.99,
  shippingCost: 4.99,
  landedPrice: 29.98,
  fixedPrice: true,
  matchScore: 96,
  matchLevel: "exact",
  url: "https://www.ebay.com/itm/111",
};

const rejectedRipped = {
  legacyItemId: "222",
  itemId: "222",
  title: "2023-24 Upper Deck Ice Frozen In Ice RIPPED Cale Makar #FI-1",
  price: 7.73,
  shippingCost: 4.99,
  landedPrice: 12.72,
  fixedPrice: true,
  matchScore: 92,
  matchLevel: "exact",
  packagingState: "opened",
  url: "https://www.ebay.com/itm/222",
};

function validAttack(overrides: Json = {}): Json {
  return {
    packagingState: "sealed",
    selfResolved: true,
    selfListing: {
      legacyItemId: "999",
      itemId: "999",
      title: "2023-24 Upper Deck Ice Cale Makar Frozen In Ice SEALED #FI-1",
      price: 30,
      url: "https://www.ebay.com/itm/999",
    },
    marketIntegrityStatus: "complete",
    exactActiveCount: 1,
    strictExactCount: 1,
    strongMatchCount: 0,
    competitors: [competitor],
    scoutingCount: 0,
    scoutingCandidates: [],
    packagingRejectedCount: 1,
    packagingRejectedCandidates: [rejectedRipped],
    lowestCompetitor: competitor,
    lowestCompetitorLanded: 29.98,
    suggestions: [
      {
        key: "beat_by_cent",
        label: "Beat by $0.01",
        itemPrice: 22.98,
        shipping: 6.99,
        landedPrice: 29.97,
      },
    ],
    gapToLowest: 7.01,
    ...overrides,
  };
}

function validTracking(attack: Json, overrides: Json = {}): Json {
  return {
    marketCompCount: attack.exactActiveCount,
    trustedForPricing: attack.selfResolved === true && attack.exactActiveCount > 0,
    marketPrice: null,
    deltaAmount: null,
    deltaPercent: null,
    topMarketComps: attack.competitors,
    activeMarketAttack: attack,
    ...overrides,
  };
}

const valid = validAttack();
const scenarios: Scenario[] = [
  {
    name: "valid sealed market proof passes",
    attack: valid,
    tracking: validTracking(valid),
    selfListingId: "999",
    expectedPass: true,
  },
  {
    name: "ripped listing left in scouting blocks pricing",
    attack: validAttack({
      scoutingCount: 1,
      scoutingCandidates: [rejectedRipped],
    }),
    tracking: validTracking(
      validAttack({ scoutingCount: 1, scoutingCandidates: [rejectedRipped] }),
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "opposite_packaging_candidate_left_in_scouting",
  },
  {
    name: "seller own listing in competitors blocks pricing",
    attack: validAttack({
      competitors: [
        {
          ...competitor,
          legacyItemId: "999",
          itemId: "999",
          url: "https://www.ebay.com/itm/999",
        },
      ],
      lowestCompetitor: {
        ...competitor,
        legacyItemId: "999",
        itemId: "999",
        url: "https://www.ebay.com/itm/999",
      },
    }),
    tracking: validTracking(
      validAttack({
        competitors: [
          {
            ...competitor,
            legacyItemId: "999",
            itemId: "999",
            url: "https://www.ebay.com/itm/999",
          },
        ],
        lowestCompetitor: {
          ...competitor,
          legacyItemId: "999",
          itemId: "999",
          url: "https://www.ebay.com/itm/999",
        },
      }),
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "seller_own_listing_present_in_competitors",
  },
  {
    name: "count mismatch blocks pricing",
    attack: validAttack({ exactActiveCount: 2 }),
    tracking: validTracking(validAttack({ exactActiveCount: 2 })),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "exact_active_count_does_not_match_competitor_array",
  },
  {
    name: "stale suggestions without landed competitor block pricing",
    attack: validAttack({
      exactActiveCount: 0,
      strictExactCount: 0,
      competitors: [],
      lowestCompetitor: null,
      lowestCompetitorLanded: null,
      suggestions: [{ key: "stale" }],
      gapToLowest: null,
    }),
    tracking: validTracking(
      validAttack({
        exactActiveCount: 0,
        strictExactCount: 0,
        competitors: [],
        lowestCompetitor: null,
        lowestCompetitorLanded: null,
        suggestions: [{ key: "stale" }],
        gapToLowest: null,
      }),
      { trustedForPricing: false, topMarketComps: [] },
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "pricing_suggestions_present_without_landed_candidate",
  },
  {
    name: "pricing cannot be trusted without confirmed seller listing",
    attack: validAttack({ selfResolved: false, marketIntegrityStatus: "incomplete" }),
    tracking: validTracking(
      validAttack({ selfResolved: false, marketIntegrityStatus: "incomplete" }),
      { trustedForPricing: true },
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "pricing_trusted_without_confirmed_self_listing",
  },
  {
    name: "unknown packaging remains review-only",
    attack: validAttack({
      exactActiveCount: 0,
      strictExactCount: 0,
      competitors: [],
      scoutingCount: 1,
      scoutingCandidates: [
        {
          ...competitor,
          legacyItemId: "333",
          itemId: "333",
          title: "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
          matchLevel: "scouting",
          url: "https://www.ebay.com/itm/333",
        },
      ],
      lowestCompetitor: null,
      lowestCompetitorLanded: null,
      suggestions: [],
      gapToLowest: null,
    }),
    tracking: validTracking(
      validAttack({
        exactActiveCount: 0,
        strictExactCount: 0,
        competitors: [],
        scoutingCount: 1,
        scoutingCandidates: [
          {
            ...competitor,
            legacyItemId: "333",
            itemId: "333",
            title: "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
            matchLevel: "scouting",
            url: "https://www.ebay.com/itm/333",
          },
        ],
        lowestCompetitor: null,
        lowestCompetitorLanded: null,
        suggestions: [],
        gapToLowest: null,
      }),
      { trustedForPricing: false, topMarketComps: [] },
    ),
    selfListingId: "999",
    expectedPass: true,
  },
  {
    name: "unknown packaging competitor cannot drive sealed pricing",
    attack: validAttack({
      competitors: [
        {
          ...competitor,
          title: "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
        },
      ],
      lowestCompetitor: {
        ...competitor,
        title: "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
      },
    }),
    tracking: validTracking(
      validAttack({
        competitors: [
          {
            ...competitor,
            title: "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
          },
        ],
        lowestCompetitor: {
          ...competitor,
          title: "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
        },
      }),
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "unknown_packaging_candidate_used_for_pricing",
  },
  {
    name: "opened target rejects sealed competitor",
    attack: validAttack({
      packagingState: "opened",
      competitors: [competitor],
    }),
    tracking: validTracking(validAttack({ packagingState: "opened", competitors: [competitor] })),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "opposite_packaging_candidate_used_for_pricing",
  },
  {
    name: "duplicate competitors block pricing",
    attack: validAttack({
      exactActiveCount: 2,
      competitors: [competitor, competitor],
      topMarketComps: [competitor, competitor],
    }),
    tracking: validTracking(
      validAttack({ exactActiveCount: 2, competitors: [competitor, competitor] }),
    ),
    selfListingId: "999",
    expectedPass: false,
    expectedFailure: "duplicate_competitor_candidates_present",
  },
  {
    name: "verified competitor with unknown shipping may remain without strategy",
    attack: validAttack({
      competitors: [
        {
          ...competitor,
          shippingCost: null,
          landedPrice: null,
        },
      ],
      lowestCompetitor: null,
      lowestCompetitorLanded: null,
      suggestions: [],
      gapToLowest: null,
    }),
    tracking: validTracking(
      validAttack({
        competitors: [
          {
            ...competitor,
            shippingCost: null,
            landedPrice: null,
          },
        ],
        lowestCompetitor: null,
        lowestCompetitorLanded: null,
        suggestions: [],
        gapToLowest: null,
      }),
    ),
    selfListingId: "999",
    expectedPass: true,
  },
];

assert(
  classifyActiveMarketPackagingState("Frozen In Ice UNRIPPED") === "sealed",
  "UNRIPPED must be classified as sealed before the RIPPED substring is checked.",
);
assert(
  classifyActiveMarketPackagingState("Frozen In Ice RIPPED") === "opened",
  "RIPPED must be classified as opened.",
);
assert(
  classifyActiveMarketPackagingState("Frozen In Ice") === "unknown",
  "Missing packaging language must remain unknown.",
);

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];

for (const scenario of scenarios) {
  try {
    const result = auditActiveMarketIntegrity({
      attack: scenario.attack,
      tracking: scenario.tracking,
      selfListingId: scenario.selfListingId,
    });
    assert(
      result.passed === scenario.expectedPass,
      `Expected passed=${scenario.expectedPass}, received ${result.passed}. Failures: ${result.failures.join(", ")}`,
    );
    if (scenario.expectedFailure) {
      assert(
        result.failures.includes(scenario.expectedFailure),
        `Expected failure ${scenario.expectedFailure}, received ${result.failures.join(", ")}`,
      );
    }
    results.push({ name: scenario.name, status: "passed" });
  } catch (error) {
    results.push({
      name: scenario.name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  console.log(
    `${result.status === "passed" ? "PASS" : "FAIL"} ${result.name}${
      result.error ? ` - ${result.error}` : ""
    }`,
  );
}

const failed = results.filter((result) => result.status === "failed");
console.log(
  `Active Market integrity simulations: ${results.length - failed.length}/${results.length} passed.`,
);
if (failed.length) process.exitCode = 1;
