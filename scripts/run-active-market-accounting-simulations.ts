import {
  buildActiveMarketEvidenceAccounting,
  canonicalActiveMarketCandidateId,
} from "../src/lib/active-market-evidence-accounting";

type Json = Record<string, any>;

type Scenario = {
  name: string;
  input: Parameters<typeof buildActiveMarketEvidenceAccounting>[0];
  expect: (result: ReturnType<typeof buildActiveMarketEvidenceAccounting>) => void;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const targetTitle =
  "2023-24 Upper Deck Ice #FI-1 Cale Makar Frozen In Ice SEALED";
const identity = {
  player: "Cale Makar",
  year: "2023-24",
  setName: "Upper Deck Ice Frozen In Ice",
  parallel: null,
  cardNumber: "FI-1",
  printRun: null,
  isAuto: false,
  isRelic: false,
  isGraded: false,
};

function candidate(
  id: string,
  title: string,
  overrides: Json = {},
): Json {
  return {
    legacyItemId: id,
    itemId: id,
    title,
    price: 20,
    shippingCost: 4.99,
    landedPrice: 24.99,
    fixedPrice: true,
    queryUsed: "Cale Makar FI-1",
    seenInQueries: ["Cale Makar FI-1"],
    discoveryLane: "finding_accounting",
    sourceLanes: ["finding_accounting"],
    url: `https://www.ebay.com/itm/${id}`,
    ...overrides,
  };
}

const verified = candidate(
  "111111111111",
  "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1",
  { matchLevel: "exact", matchScore: 96 },
);
const scout = candidate(
  "222222222222",
  "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-1",
  { matchLevel: "scouting", matchScore: 76 },
);
const ripped = candidate(
  "333333333333",
  "2023-24 Upper Deck Ice Frozen In Ice RIPPED Cale Makar #FI-1",
  { matchLevel: "exact", matchScore: 94, packagingState: "opened" },
);
const wrongPlayer = candidate(
  "444444444444",
  "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Nathan MacKinnon #FI-1",
);
const wrongNumber = candidate(
  "555555555555",
  "2023-24 Upper Deck Ice Frozen In Ice Cale Makar #FI-9",
);
const auction = candidate(
  "666666666666",
  "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1",
  { fixedPrice: false },
);
const self = candidate(
  "999999999999",
  targetTitle,
  { price: 30 },
);

function attack(overrides: Json = {}): Json {
  return {
    packagingState: "sealed",
    competitors: [verified],
    scoutingCandidates: [scout],
    packagingRejectedCandidates: [
      { ...ripped, rejectionReason: "OPENED product state conflicts with SEALED target" },
    ],
    ...overrides,
  };
}

const scenarios: Scenario[] = [
  {
    name: "every raw listing receives a disposition",
    input: {
      rawCandidates: [
        verified,
        scout,
        ripped,
        wrongPlayer,
        wrongNumber,
        auction,
        self,
      ],
      attack: attack(),
      targetTitle,
      identity,
      selfListingIds: ["999999999999"],
      queriesAttempted: 4,
      queriesSucceeded: 4,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.passed, `Expected pass, received ${result.failures.join(", ")}`);
      assert(result.externalCandidateCount === 6, "Expected six external listings");
      assert(result.accountedExternalCount === 6, "Expected all six external listings accounted");
      assert(result.counts.verifiedPricing === 1, "Expected one verified listing");
      assert(result.counts.scouting === 1, "Expected one scouting listing");
      assert(result.counts.packagingRejected === 1, "Expected one packaging rejection");
      assert(result.counts.identityRejected === 2, "Expected two identity rejections");
      assert(result.counts.auctionOnly === 1, "Expected one auction-only listing");
      assert(result.counts.selfListing === 1, "Expected seller listing separated");
      assert(result.counts.unclassified === 0, "No listing may vanish unclassified");
    },
  },
  {
    name: "the four listings that previously vanished become identity rejections",
    input: {
      rawCandidates: [
        candidate("710000000001", "2022-23 Upper Deck Ice Nathan MacKinnon #FI-1"),
        candidate("710000000002", "2023-24 Upper Deck Ice Cale Makar #FI-9"),
        candidate("710000000003", "2023-24 Upper Deck Ice Cale Makar #FI-1 PSA 10"),
        candidate("710000000004", "2023-24 Upper Deck Ice Cale Makar #FI-1 /99"),
      ],
      attack: attack({ competitors: [], scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 4,
      queriesSucceeded: 4,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.passed, "Identity-rejected listings should still reconcile");
      assert(result.externalCandidateCount === 4, "Expected four external listings");
      assert(result.counts.identityRejected === 4, "All four must be identity rejected");
      assert(
        result.ledger.every((entry) => entry.reasons.length > 0),
        "Every rejected listing needs a reason",
      );
    },
  },
  {
    name: "ripped listing is packaging rejected even if not in the saved rejection array",
    input: {
      rawCandidates: [ripped],
      attack: attack({ competitors: [], scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 1,
      queriesSucceeded: 1,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.passed, "Ripped listing should be accounted safely");
      assert(result.counts.packagingRejected === 1, "RIPPED must be packaging rejected");
      assert(result.counts.scouting === 0, "RIPPED cannot remain scouting for SEALED");
    },
  },
  {
    name: "seller listing is separated from external counts",
    input: {
      rawCandidates: [self],
      attack: attack({ competitors: [], scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: ["999999999999"],
      queriesAttempted: 1,
      queriesSucceeded: 1,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.passed, "Self-only result should reconcile");
      assert(result.externalCandidateCount === 0, "Self cannot count as external");
      assert(result.counts.selfListing === 1, "Self listing should be explicit");
    },
  },
  {
    name: "numbered variant conflicts with unnumbered target",
    input: {
      rawCandidates: [candidate("720000000001", `${targetTitle} /99`)],
      attack: attack({ competitors: [], scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 1,
      queriesSucceeded: 1,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.counts.identityRejected === 1, "Numbered variant must be rejected");
      assert(
        result.ledger[0]?.reasons.includes(
          "numbered_variant_conflicts_with_unnumbered_target",
        ),
        "Expected explicit numbered-variant reason",
      );
    },
  },
  {
    name: "one failed query is a warning when other searches succeeded",
    input: {
      rawCandidates: [verified],
      attack: attack({ scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 4,
      queriesSucceeded: 3,
      sourceFailures: [{ query: "failed", status: 500 }],
    },
    expect(result) {
      assert(result.passed, "Partial source failure should not break reconciled evidence");
      assert(
        result.warnings.includes("one_or_more_external_search_queries_failed"),
        "Expected source failure warning",
      );
      assert(result.queriesFailed === 1, "Expected one failed query");
    },
  },
  {
    name: "all accounting searches failing blocks evidence trust",
    input: {
      rawCandidates: [],
      attack: attack({ competitors: [], scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 4,
      queriesSucceeded: 0,
      sourceFailures: [{ query: "one" }, { query: "two" }, { query: "three" }, { query: "four" }],
    },
    expect(result) {
      assert(!result.passed, "No successful accounting query must block");
      assert(
        result.failures.includes("no_external_search_query_completed_successfully"),
        "Expected no-success failure",
      );
    },
  },
  {
    name: "candidate from ePID lane remains accounted with a coverage warning",
    input: {
      rawCandidates: [],
      attack: attack({ scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 2,
      queriesSucceeded: 2,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.passed, "Non-Finding final candidate can still be accounted");
      assert(result.counts.verifiedPricing === 1, "Expected verified candidate");
      assert(
        result.warnings.includes("final_candidates_included_from_non_finding_search_lanes"),
        "Expected non-Finding lane warning",
      );
    },
  },
  {
    name: "duplicate raw results across queries collapse to one ledger entry",
    input: {
      rawCandidates: [
        verified,
        {
          ...verified,
          queryUsed: "Cale Makar Frozen In Ice",
          seenInQueries: ["Cale Makar Frozen In Ice"],
        },
      ],
      attack: attack({ scoutingCandidates: [], packagingRejectedCandidates: [] }),
      targetTitle,
      identity,
      selfListingIds: [],
      queriesAttempted: 2,
      queriesSucceeded: 2,
      sourceFailures: [],
    },
    expect(result) {
      assert(result.ledger.length === 1, "Duplicate item IDs must collapse");
      assert(result.externalCandidateCount === 1, "Duplicate cannot inflate raw count");
    },
  },
];

assert(
  canonicalActiveMarketCandidateId({ itemId: "v1|123456789012|0" }) ===
    "123456789012",
  "Browse item IDs must normalize to the legacy eBay item ID.",
);
assert(
  canonicalActiveMarketCandidateId({
    url: "https://www.ebay.com/itm/example-title/123456789012",
  }) === "123456789012",
  "eBay item URLs must normalize to the numeric item ID.",
);

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];
for (const scenario of scenarios) {
  try {
    const result = buildActiveMarketEvidenceAccounting(scenario.input);
    scenario.expect(result);
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
  `Active Market evidence accounting simulations: ${results.length - failed.length}/${results.length} passed.`,
);
if (failed.length) process.exitCode = 1;
