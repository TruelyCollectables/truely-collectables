import { quarantineActiveMarketTrackingForRead } from "../src/lib/active-market-read-freshness";
import { buildRunningActiveMarketScanLease, finishActiveMarketScanLease } from "../src/lib/active-market-scan-lease";

type Json = Record<string, any>;

type Scenario = {
  name: string;
  metadata?: Json;
  tracking: Json;
  now: Date;
  expectedStatus: string;
  expectedTrusted: boolean;
  verify?: (result: ReturnType<typeof quarantineActiveMarketTrackingForRead>) => void;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function resultTracking(
  result: ReturnType<typeof quarantineActiveMarketTrackingForRead>,
): Json {
  return (result.tracking || {}) as Json;
}

const now = new Date("2026-07-24T23:00:00.000Z");
const receipt = "abcdef1234567890abcdef12";

function freshTracking(overrides: Json = {}): Json {
  return {
    trustedForPricing: true,
    pricingEvidenceMode: "active_market_attack",
    soldCompCount: 0,
    marketPrice: 24.99,
    deltaAmount: 5.01,
    deltaPercent: 20.05,
    updatedAt: "2026-07-24T22:55:00.000Z",
    evidenceAccountingReceipt: receipt,
    reviewReasons: [],
    activeMarketAttack: {
      updatedAt: "2026-07-24T22:55:00.000Z",
      exactActiveCount: 1,
      lowestCompetitor: { title: "Exact competitor", landedPrice: 24.99 },
      lowestCompetitorLanded: 24.99,
      gapToLowest: 5.01,
      position: "over_market",
      suggestions: [{ key: "beat_by_cent", itemPrice: 17.99 }],
      evidenceAccountingReceipt: receipt,
      evidenceAccounting: {
        passed: true,
        checkedAt: "2026-07-24T22:55:30.000Z",
      },
      sourceCoverage: {
        passed: true,
        checkedAt: "2026-07-24T22:56:00.000Z",
      },
      taxNote: "Sales tax is excluded.",
      marketLocation: { label: "Denver shipping estimate" },
    },
    ...overrides,
  };
}

const runningLease = buildRunningActiveMarketScanLease({
  runId: "run-active",
  ownerAccountId: "seller-1",
  now: new Date("2026-07-24T22:58:00.000Z"),
  ttlMs: 5 * 60_000,
});

const scenarios: Scenario[] = [
  {
    name: "fresh active-market evidence remains usable",
    tracking: freshTracking(),
    now,
    expectedStatus: "fresh",
    expectedTrusted: true,
    verify(result) {
      assert(result.freshness.ageMinutes === 5, "Expected oldest evidence age of five minutes");
      assert(
        resultTracking(result).activeMarketAttack?.suggestions?.length === 1,
        "Fresh suggestions should remain visible",
      );
    },
  },
  {
    name: "sixteen-minute-old evidence is quarantined",
    tracking: freshTracking({
      updatedAt: "2026-07-24T22:44:00.000Z",
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        updatedAt: "2026-07-24T22:44:00.000Z",
        evidenceAccounting: {
          passed: true,
          checkedAt: "2026-07-24T22:44:00.000Z",
        },
        sourceCoverage: {
          passed: true,
          checkedAt: "2026-07-24T22:44:00.000Z",
        },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("active_market_snapshot_stale"),
        "Expected stale reason",
      );
      assert(
        resultTracking(result).pricingEvidenceMode === "active_market_refresh_required",
        "Expected refresh-required mode",
      );
    },
  },
  {
    name: "missing source coverage timestamp is quarantined",
    tracking: freshTracking({
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        sourceCoverage: { passed: true },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("source_coverage_timestamp_missing"),
        "Expected missing source coverage timestamp",
      );
    },
  },
  {
    name: "missing evidence accounting timestamp is quarantined",
    tracking: freshTracking({
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        evidenceAccounting: { passed: true },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("evidence_accounting_timestamp_missing"),
        "Expected missing accounting timestamp",
      );
    },
  },
  {
    name: "missing receipt is quarantined",
    tracking: freshTracking({
      evidenceAccountingReceipt: null,
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        evidenceAccountingReceipt: null,
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("evidence_accounting_receipt_missing"),
        "Expected missing receipt reason",
      );
    },
  },
  {
    name: "failed source coverage is quarantined",
    tracking: freshTracking({
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        sourceCoverage: {
          passed: false,
          checkedAt: "2026-07-24T22:56:00.000Z",
        },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("source_coverage_not_passed"),
        "Expected coverage failure reason",
      );
    },
  },
  {
    name: "failed evidence accounting is quarantined",
    tracking: freshTracking({
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        evidenceAccounting: {
          passed: false,
          checkedAt: "2026-07-24T22:55:30.000Z",
        },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("evidence_accounting_not_passed"),
        "Expected accounting failure reason",
      );
    },
  },
  {
    name: "invalid timestamp is quarantined",
    tracking: freshTracking({
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        sourceCoverage: { passed: true, checkedAt: "not-a-date" },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("active_market_timestamp_invalid"),
        "Expected invalid timestamp reason",
      );
    },
  },
  {
    name: "future timestamp is quarantined",
    tracking: freshTracking({
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        sourceCoverage: {
          passed: true,
          checkedAt: "2026-07-24T23:05:00.000Z",
        },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      assert(
        result.freshness.reasons.includes("active_market_timestamp_in_future"),
        "Expected future timestamp reason",
      );
    },
  },
  {
    name: "sold comp evidence is unaffected",
    tracking: freshTracking({ soldCompCount: 2, pricingEvidenceMode: "exact_sold_and_market" }),
    now,
    expectedStatus: "not_applicable",
    expectedTrusted: true,
    verify(result) {
      assert(
        resultTracking(result).pricingEvidenceMode === "exact_sold_and_market",
        "Sold evidence mode should remain unchanged",
      );
    },
  },
  {
    name: "tracking without active attack is unaffected",
    tracking: { trustedForPricing: true, soldCompCount: 0, updatedAt: "2026-07-24T20:00:00Z" },
    now,
    expectedStatus: "not_applicable",
    expectedTrusted: true,
  },
  {
    name: "unexpired running lease hides saved recommendations",
    metadata: { active_market_scan_lease: runningLease },
    tracking: freshTracking(),
    now,
    expectedStatus: "scan_running",
    expectedTrusted: false,
    verify(result) {
      assert(
        resultTracking(result).pricingEvidenceMode === "active_market_scan_running",
        "Expected running mode",
      );
      assert(
        resultTracking(result).activeMarketAttack?.suggestions?.length === 0,
        "Running scan must hide old suggestions",
      );
    },
  },
  {
    name: "expired running lease forces refresh",
    metadata: { active_market_scan_lease: runningLease },
    tracking: freshTracking(),
    now: new Date("2026-07-24T23:04:00.000Z"),
    expectedStatus: "scan_lease_expired",
    expectedTrusted: false,
    verify(result) {
      assert(
        resultTracking(result).reviewReasons?.includes("active_market_scan_lease_expired"),
        "Expected expired lease reason",
      );
    },
  },
  {
    name: "completed lease does not block fresh evidence",
    metadata: {
      active_market_scan_lease: finishActiveMarketScanLease({
        lease: runningLease,
        status: "completed",
        now: new Date("2026-07-24T22:59:00.000Z"),
        responseStatus: 200,
      }),
    },
    tracking: freshTracking(),
    now,
    expectedStatus: "fresh",
    expectedTrusted: true,
  },
  {
    name: "quarantine clears every stale pricing field",
    tracking: freshTracking({
      updatedAt: "2026-07-24T22:30:00.000Z",
      activeMarketAttack: {
        ...freshTracking().activeMarketAttack,
        updatedAt: "2026-07-24T22:30:00.000Z",
        evidenceAccounting: {
          passed: true,
          checkedAt: "2026-07-24T22:30:00.000Z",
        },
        sourceCoverage: {
          passed: true,
          checkedAt: "2026-07-24T22:30:00.000Z",
        },
      },
    }),
    now,
    expectedStatus: "refresh_required",
    expectedTrusted: false,
    verify(result) {
      const tracking = resultTracking(result);
      const attack = tracking.activeMarketAttack || {};
      assert(tracking.marketPrice === null, "Market price must be cleared");
      assert(tracking.deltaAmount === null, "Delta amount must be cleared");
      assert(tracking.deltaPercent === null, "Delta percent must be cleared");
      assert(attack.lowestCompetitor === null, "Lowest competitor must be cleared");
      assert(attack.lowestCompetitorLanded === null, "Lowest landed must be cleared");
      assert(attack.gapToLowest === null, "Gap must be cleared");
      assert(Array.isArray(attack.suggestions) && attack.suggestions.length === 0, "Suggestions must be cleared");
      assert(
        String(attack.taxNote).includes("ACTIVE MARKET REFRESH REQUIRED"),
        "Expected visible refresh-required note",
      );
      assert(
        tracking.reviewReasons?.includes("active_market_snapshot_stale"),
        "Expected stale review reason",
      );
    },
  },
];

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];
for (const scenario of scenarios) {
  try {
    const result = quarantineActiveMarketTrackingForRead({
      metadata: scenario.metadata || {},
      tracking: scenario.tracking,
      now: scenario.now,
    });
    assert(
      result.freshness.status === scenario.expectedStatus,
      `Expected status ${scenario.expectedStatus}, received ${result.freshness.status}; reasons=${result.freshness.reasons.join(", ")}`,
    );
    assert(
      resultTracking(result).trustedForPricing === scenario.expectedTrusted,
      `Expected trusted=${scenario.expectedTrusted}, received ${resultTracking(result).trustedForPricing}`,
    );
    scenario.verify?.(result);
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
  `Active Market read freshness simulations: ${results.length - failed.length}/${results.length} passed.`,
);
if (failed.length) process.exitCode = 1;
