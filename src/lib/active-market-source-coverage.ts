type Json = Record<string, unknown>;

export type ActiveMarketSourceCoverageResult = {
  schema: "truely.activeMarketSourceCoverage.v1";
  passed: boolean;
  checkedAt: string;
  failures: string[];
  warnings: string[];
  summary: string;
  metrics: {
    selfListingConfirmed: boolean;
    accountingPassed: boolean;
    accountingReceiptPresent: boolean;
    queriesAttempted: number;
    queriesSucceeded: number;
    queriesFailed: number;
    minimumSuccessfulQueries: number;
    failedQueryRatio: number;
    ePidSearchUsed: boolean;
    ePidResultCount: number;
    verifiedCandidateCount: number;
    verifiedCandidatesWithProvenance: number;
    accountingAgeMinutes: number | null;
    attackAgeMinutes: number | null;
  };
  lanes: Array<{
    key: string;
    label: string;
    attempted: boolean;
    completed: boolean;
    resultCount: number | null;
    failureCount: number | null;
  }>;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function array(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function ageMinutes(value: unknown, now: Date): number | null {
  const parsed = new Date(text(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return (now.getTime() - parsed.getTime()) / 60_000;
}

export function auditActiveMarketSourceCoverage(input: {
  attack: unknown;
  tracking?: unknown;
  diagnostics?: unknown;
  now?: Date;
  maxAgeMinutes?: number;
}): ActiveMarketSourceCoverageResult {
  const attack = record(input.attack);
  const tracking = record(input.tracking);
  const diagnostics = record(input.diagnostics);
  const accounting = record(attack.evidenceAccounting || tracking.evidenceAccounting);
  const now = input.now || new Date();
  const maxAgeMinutes = input.maxAgeMinutes ?? 15;
  const failures: string[] = [];
  const warnings: string[] = [];

  const selfListingConfirmed = attack.selfResolved === true;
  const accountingPassed = accounting.passed === true;
  const accountingReceiptPresent = Boolean(
    text(attack.evidenceAccountingReceipt || tracking.evidenceAccountingReceipt),
  );
  const queriesAttempted = number(accounting.queriesAttempted) ?? 0;
  const queriesSucceeded = number(accounting.queriesSucceeded) ?? 0;
  const queriesFailed = number(accounting.queriesFailed) ?? Math.max(0, queriesAttempted - queriesSucceeded);
  const ePidSearchUsed =
    attack.productSearchUsed === true || Boolean(text(attack.epid || diagnostics.epid));
  const ePidResultCount =
    number(attack.epidResultCount ?? diagnostics.epidResultCount) ?? 0;
  const ePidCorroboration = ePidSearchUsed && ePidResultCount > 0;
  const minimumSuccessfulQueries = ePidCorroboration
    ? 1
    : Math.max(1, Math.min(2, queriesAttempted));
  const failedQueryRatio =
    queriesAttempted > 0 ? queriesFailed / queriesAttempted : 1;
  const accountingAge = ageMinutes(accounting.checkedAt, now);
  const attackAge = ageMinutes(attack.updatedAt || tracking.updatedAt, now);

  const ledger = array(accounting.ledger);
  const verifiedLedger = ledger.filter(
    (entry) => entry.disposition === "verified_pricing",
  );
  const verifiedCandidateCount = number(attack.exactActiveCount) ?? 0;
  const verifiedCandidatesWithProvenance = verifiedLedger.filter((entry) => {
    const queries = Array.isArray(entry.seenInQueries)
      ? entry.seenInQueries.filter(Boolean)
      : [];
    const lanes = Array.isArray(entry.sourceLanes)
      ? entry.sourceLanes.filter(Boolean)
      : [];
    return queries.length > 0 || lanes.length > 0;
  }).length;

  if (!selfListingConfirmed) {
    pushUnique(failures, "seller_self_listing_not_confirmed");
  }
  if (!accountingPassed) {
    pushUnique(failures, "evidence_accounting_not_passed");
  }
  if (!accountingReceiptPresent) {
    pushUnique(failures, "evidence_accounting_receipt_missing");
  }
  if (queriesAttempted <= 0) {
    pushUnique(failures, "no_accounting_queries_attempted");
  }
  if (queriesSucceeded < minimumSuccessfulQueries) {
    pushUnique(failures, "insufficient_successful_query_coverage");
  }
  if (queriesAttempted > 1 && failedQueryRatio > 0.5) {
    pushUnique(failures, "majority_of_accounting_queries_failed");
  }
  if (accountingAge === null) {
    pushUnique(failures, "accounting_timestamp_missing_or_invalid");
  } else if (accountingAge < -2) {
    pushUnique(failures, "accounting_timestamp_is_in_the_future");
  } else if (accountingAge > maxAgeMinutes) {
    pushUnique(failures, "accounting_evidence_is_stale");
  }
  if (attackAge === null) {
    pushUnique(failures, "active_market_timestamp_missing_or_invalid");
  } else if (attackAge < -2) {
    pushUnique(failures, "active_market_timestamp_is_in_the_future");
  } else if (attackAge > maxAgeMinutes) {
    pushUnique(failures, "active_market_snapshot_is_stale");
  }
  if (verifiedLedger.length !== verifiedCandidateCount) {
    pushUnique(failures, "verified_ledger_count_does_not_match_active_competitors");
  }
  if (
    verifiedCandidateCount > 0 &&
    verifiedCandidatesWithProvenance !== verifiedCandidateCount
  ) {
    pushUnique(failures, "verified_candidate_missing_source_provenance");
  }
  if (tracking.trustedForPricing === true && failures.length > 0) {
    pushUnique(failures, "pricing_trusted_despite_incomplete_source_coverage");
  }

  if (queriesFailed > 0 && failedQueryRatio <= 0.5) {
    pushUnique(warnings, "partial_query_failure_with_usable_coverage");
  }
  if (!ePidSearchUsed) {
    pushUnique(warnings, "epid_product_search_not_available");
  } else if (ePidResultCount === 0) {
    pushUnique(warnings, "epid_product_search_returned_zero_results");
  }
  if (diagnostics.ebayTokenAvailable === false) {
    pushUnique(failures, "ebay_access_token_unavailable");
  } else if (diagnostics.ebayTokenAvailable === undefined) {
    pushUnique(warnings, "ebay_token_diagnostic_missing");
  }

  const lanes = [
    {
      key: "self_listing",
      label: "Seller listing proof",
      attempted: true,
      completed: selfListingConfirmed,
      resultCount: selfListingConfirmed ? 1 : 0,
      failureCount: selfListingConfirmed ? 0 : 1,
    },
    {
      key: "epid",
      label: "ePID product search",
      attempted: ePidSearchUsed,
      completed: ePidSearchUsed,
      resultCount: ePidSearchUsed ? ePidResultCount : null,
      failureCount: null,
    },
    {
      key: "browse_keyword",
      label: "Browse keyword search",
      attempted: array(attack.searchQueries).length > 0,
      completed: diagnostics.ebayTokenAvailable !== false,
      resultCount:
        number(attack.keywordResultCount ?? diagnostics.keywordResultCount) ?? null,
      failureCount: null,
    },
    {
      key: "unscoped_fallback",
      label: "Unscoped Browse fallback",
      attempted: attack.fallbackSearchUsed === true,
      completed:
        attack.fallbackSearchUsed === true &&
        (number(attack.fallbackSearchFailureCount) ?? 0) <
          Math.max(1, array(attack.searchQueries).length),
      resultCount: number(attack.fallbackRawCandidateCount) ?? null,
      failureCount: number(attack.fallbackSearchFailureCount) ?? null,
    },
    {
      key: "finding",
      label: "Finding external search",
      attempted: attack.findingSearchUsed === true,
      completed:
        attack.findingSearchUsed === true &&
        (number(attack.findingSearchFailureCount) ?? 0) <
          Math.max(1, array(attack.searchQueries).length),
      resultCount: number(attack.findingRawCandidateCount) ?? null,
      failureCount: number(attack.findingSearchFailureCount) ?? null,
    },
    {
      key: "accounting",
      label: "Evidence accounting rerun",
      attempted: queriesAttempted > 0,
      completed: queriesSucceeded >= minimumSuccessfulQueries,
      resultCount: number(accounting.rawUniqueCandidateCount) ?? null,
      failureCount: queriesFailed,
    },
  ];

  const summary = `Source coverage: ${queriesSucceeded}/${queriesAttempted} accounting queries succeeded${
    ePidCorroboration ? ", ePID corroborated" : ", no ePID corroboration"
  }; ${verifiedCandidatesWithProvenance}/${verifiedCandidateCount} verified candidates carry provenance; receipt age ${
    accountingAge === null ? "unknown" : `${Math.max(0, accountingAge).toFixed(1)}m`
  }.`;

  return {
    schema: "truely.activeMarketSourceCoverage.v1",
    passed: failures.length === 0,
    checkedAt: now.toISOString(),
    failures,
    warnings,
    summary,
    metrics: {
      selfListingConfirmed,
      accountingPassed,
      accountingReceiptPresent,
      queriesAttempted,
      queriesSucceeded,
      queriesFailed,
      minimumSuccessfulQueries,
      failedQueryRatio,
      ePidSearchUsed,
      ePidResultCount,
      verifiedCandidateCount,
      verifiedCandidatesWithProvenance,
      accountingAgeMinutes: accountingAge,
      attackAgeMinutes: attackAge,
    },
    lanes,
  };
}
