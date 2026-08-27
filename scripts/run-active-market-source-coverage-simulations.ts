import { auditActiveMarketSourceCoverage } from "../src/lib/active-market-source-coverage";

type Json = Record<string, any>;

type Scenario = {
  name: string;
  attack: Json;
  tracking: Json;
  diagnostics: Json;
  expectedPass: boolean;
  expectedFailure?: string;
  expectedWarning?: string;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-07-24T22:00:00.000Z");
const verifiedLedger = {
  id: "111111111111",
  title: "2023-24 Upper Deck Ice Frozen In Ice UNRIPPED Cale Makar #FI-1",
  disposition: "verified_pricing",
  seenInQueries: ["Cale Makar FI-1", "Cale Makar Frozen In Ice"],
  sourceLanes: ["finding_accounting"],
};

function validAttack(overrides: Json = {}): Json {
  return {
    selfResolved: true,
    updatedAt: "2026-07-24T21:59:45.000Z",
    exactActiveCount: 1,
    productSearchUsed: true,
    epid: "123456789",
    epidResultCount: 2,
    searchQueries: [
      "Cale Makar FI-1",
      "Cale Makar Frozen In Ice",
      "2023-24 Cale Makar FI-1",
      "Upper Deck Ice FI-1 Cale Makar",
    ],
    evidenceAccountingReceipt: "abcdef1234567890abcdef12",
    evidenceAccounting: {
      passed: true,
      checkedAt: "2026-07-24T21:59:50.000Z",
      queriesAttempted: 4,
      queriesSucceeded: 4,
      queriesFailed: 0,
      rawUniqueCandidateCount: 6,
      ledger: [verifiedLedger],
    },
    ...overrides,
  };
}

function validTracking(overrides: Json = {}): Json {
  return {
    trustedForPricing: true,
    updatedAt: "2026-07-24T21:59:45.000Z",
    evidenceAccountingReceipt: "abcdef1234567890abcdef12",
    ...overrides,
  };
}

function validDiagnostics(overrides: Json = {}): Json {
  return {
    ebayTokenAvailable: true,
    epid: "123456789",
    epidResultCount: 2,
    keywordResultCount: 6,
    ...overrides,
  };
}

const scenarios: Scenario[] = [
  {
    name: "fresh redundant source coverage passes",
    attack: validAttack(),
    tracking: validTracking(),
    diagnostics: validDiagnostics(),
    expectedPass: true,
  },
  {
    name: "seller listing proof is mandatory",
    attack: validAttack({ selfResolved: false }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "seller_self_listing_not_confirmed",
  },
  {
    name: "evidence accounting must pass",
    attack: validAttack({ evidenceAccounting: { ...validAttack().evidenceAccounting, passed: false } }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "evidence_accounting_not_passed",
  },
  {
    name: "receipt is mandatory",
    attack: validAttack({ evidenceAccountingReceipt: null }),
    tracking: validTracking({ trustedForPricing: false, evidenceAccountingReceipt: null }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "evidence_accounting_receipt_missing",
  },
  {
    name: "no accounting query coverage blocks",
    attack: validAttack({
      productSearchUsed: false,
      epid: null,
      epidResultCount: 0,
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        queriesAttempted: 0,
        queriesSucceeded: 0,
        queriesFailed: 0,
      },
    }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics({ epid: null, epidResultCount: 0 }),
    expectedPass: false,
    expectedFailure: "no_accounting_queries_attempted",
  },
  {
    name: "one narrow query without ePID is insufficient",
    attack: validAttack({
      productSearchUsed: false,
      epid: null,
      epidResultCount: 0,
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        queriesAttempted: 2,
        queriesSucceeded: 1,
        queriesFailed: 1,
      },
    }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics({ epid: null, epidResultCount: 0 }),
    expectedPass: false,
    expectedFailure: "insufficient_successful_query_coverage",
  },
  {
    name: "single successful query may pass when ePID corroborates",
    attack: validAttack({
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        queriesAttempted: 1,
        queriesSucceeded: 1,
        queriesFailed: 0,
      },
    }),
    tracking: validTracking(),
    diagnostics: validDiagnostics(),
    expectedPass: true,
  },
  {
    name: "majority query failure blocks even with some results",
    attack: validAttack({
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        queriesAttempted: 5,
        queriesSucceeded: 2,
        queriesFailed: 3,
      },
    }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "majority_of_accounting_queries_failed",
  },
  {
    name: "partial query failure warns but passes",
    attack: validAttack({
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        queriesAttempted: 4,
        queriesSucceeded: 3,
        queriesFailed: 1,
      },
    }),
    tracking: validTracking(),
    diagnostics: validDiagnostics(),
    expectedPass: true,
    expectedWarning: "partial_query_failure_with_usable_coverage",
  },
  {
    name: "stale accounting receipt blocks",
    attack: validAttack({
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        checkedAt: "2026-07-24T21:30:00.000Z",
      },
    }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "accounting_evidence_is_stale",
  },
  {
    name: "stale active market snapshot blocks",
    attack: validAttack({ updatedAt: "2026-07-24T21:30:00.000Z" }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "active_market_snapshot_is_stale",
  },
  {
    name: "future timestamp blocks",
    attack: validAttack({
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        checkedAt: "2026-07-24T22:05:00.000Z",
      },
    }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "accounting_timestamp_is_in_the_future",
  },
  {
    name: "verified candidate needs source provenance",
    attack: validAttack({
      evidenceAccounting: {
        ...validAttack().evidenceAccounting,
        ledger: [
          {
            ...verifiedLedger,
            seenInQueries: [],
            sourceLanes: [],
          },
        ],
      },
    }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "verified_candidate_missing_source_provenance",
  },
  {
    name: "verified ledger count must match competitor count",
    attack: validAttack({ exactActiveCount: 2 }),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics(),
    expectedPass: false,
    expectedFailure: "verified_ledger_count_does_not_match_active_competitors",
  },
  {
    name: "missing eBay token blocks",
    attack: validAttack(),
    tracking: validTracking({ trustedForPricing: false }),
    diagnostics: validDiagnostics({ ebayTokenAvailable: false }),
    expectedPass: false,
    expectedFailure: "ebay_access_token_unavailable",
  },
];

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];
for (const scenario of scenarios) {
  try {
    const result = auditActiveMarketSourceCoverage({
      attack: scenario.attack,
      tracking: scenario.tracking,
      diagnostics: scenario.diagnostics,
      now,
    });
    assert(
      result.passed === scenario.expectedPass,
      `Expected passed=${scenario.expectedPass}, received ${result.passed}; failures=${result.failures.join(", ")}`,
    );
    if (scenario.expectedFailure) {
      assert(
        result.failures.includes(scenario.expectedFailure),
        `Expected failure ${scenario.expectedFailure}; received ${result.failures.join(", ")}`,
      );
    }
    if (scenario.expectedWarning) {
      assert(
        result.warnings.includes(scenario.expectedWarning),
        `Expected warning ${scenario.expectedWarning}; received ${result.warnings.join(", ")}`,
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
  `Active Market source coverage simulations: ${results.length - failed.length}/${results.length} passed.`,
);
if (failed.length) process.exitCode = 1;
