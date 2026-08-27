import {
  inspectActiveMarketScanLease,
  readActiveMarketScanLease,
} from "./active-market-scan-lease";

type Json = Record<string, unknown>;

export type ActiveMarketReadFreshnessStatus =
  | "not_applicable"
  | "fresh"
  | "refresh_required"
  | "scan_running"
  | "scan_lease_expired";

export type ActiveMarketReadFreshness = {
  schema: "truely.activeMarketReadFreshness.v1";
  status: ActiveMarketReadFreshnessStatus;
  usableForPricing: boolean;
  checkedAt: string;
  maxAgeMinutes: number;
  ageMinutes: number | null;
  basisTimestamps: string[];
  reasons: string[];
  message: string;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => text(value)).filter(Boolean)),
  );
}

function parsedMs(value: unknown): number | null {
  const parsed = new Date(text(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function stripReadFreshnessNote(value: unknown): string {
  return String(value || "")
    .replace(/\s*ACTIVE MARKET (?:REFRESH REQUIRED|SCAN RUNNING):[\s\S]*$/i, "")
    .trim();
}

function quarantine(input: {
  tracking: Json;
  attack: Json;
  freshness: ActiveMarketReadFreshness;
}) {
  const baseTax =
    stripReadFreshnessNote(input.attack.taxNote) ||
    "Sales tax is excluded because it varies by buyer location and is not controlled by the seller.";
  const marketLabel = String(record(input.attack.marketLocation).label || "US estimate")
    .replace(/\s*·\s*(?:REFRESH REQUIRED|SCAN RUNNING).*$/i, "")
    .trim();
  const mode =
    input.freshness.status === "scan_running"
      ? "active_market_scan_running"
      : "active_market_refresh_required";
  const reason =
    input.freshness.status === "scan_running"
      ? "active_market_scan_running"
      : input.freshness.status === "scan_lease_expired"
        ? "active_market_scan_lease_expired"
        : "active_market_snapshot_stale";
  const nextAttack = {
    ...input.attack,
    readFreshness: input.freshness,
    readFreshnessStatus: input.freshness.status,
    readFreshnessCheckedAt: input.freshness.checkedAt,
    suggestions: [],
    lowestCompetitor: null,
    lowestCompetitorLanded: null,
    gapToLowest: null,
    position:
      input.freshness.status === "scan_running"
        ? "scan_running"
        : "refresh_required",
    taxNote: `${baseTax} ${
      input.freshness.status === "scan_running"
        ? "ACTIVE MARKET SCAN RUNNING"
        : "ACTIVE MARKET REFRESH REQUIRED"
    }: ${input.freshness.message}`,
    marketLocation: {
      ...record(input.attack.marketLocation),
      label: `${marketLabel} · ${
        input.freshness.status === "scan_running"
          ? "SCAN RUNNING"
          : "REFRESH REQUIRED"
      }`,
    },
  };

  return {
    ...input.tracking,
    trustedForPricing: false,
    marketPrice: null,
    deltaAmount: null,
    deltaPercent: null,
    pricingEvidenceMode: mode,
    reviewReasons: uniqueStrings([
      ...(Array.isArray(input.tracking.reviewReasons)
        ? input.tracking.reviewReasons
        : []),
      reason,
    ]),
    activeMarketAttack: nextAttack,
    readFreshness: input.freshness,
  };
}

export function quarantineActiveMarketTrackingForRead(input: {
  metadata: unknown;
  tracking: unknown;
  now?: Date;
  maxAgeMs?: number;
}): {
  tracking: Json | null;
  freshness: ActiveMarketReadFreshness;
} {
  const now = input.now || new Date();
  const maxAgeMs = Math.max(60_000, input.maxAgeMs ?? 15 * 60_000);
  const maxAgeMinutes = maxAgeMs / 60_000;
  const tracking = record(input.tracking);
  const attack = record(tracking.activeMarketAttack);
  const notApplicable =
    !Object.keys(tracking).length ||
    Number(tracking.soldCompCount || 0) > 0 ||
    !Object.keys(attack).length;
  if (notApplicable) {
    const freshness: ActiveMarketReadFreshness = {
      schema: "truely.activeMarketReadFreshness.v1",
      status: "not_applicable",
      usableForPricing: tracking.trustedForPricing === true,
      checkedAt: now.toISOString(),
      maxAgeMinutes,
      ageMinutes: null,
      basisTimestamps: [],
      reasons: [],
      message: "Active-market freshness does not apply to this saved evidence.",
    };
    return {
      tracking: Object.keys(tracking).length ? tracking : null,
      freshness,
    };
  }

  const lease = readActiveMarketScanLease(input.metadata);
  const leaseState = inspectActiveMarketScanLease({
    metadata: input.metadata,
    now,
  });
  if (lease?.status === "running" && !leaseState.canAcquire) {
    const seconds = Math.max(1, Math.ceil(leaseState.remainingMs / 1000));
    const freshness: ActiveMarketReadFreshness = {
      schema: "truely.activeMarketReadFreshness.v1",
      status: "scan_running",
      usableForPricing: false,
      checkedAt: now.toISOString(),
      maxAgeMinutes,
      ageMinutes: null,
      basisTimestamps: [lease.startedAt, lease.expiresAt],
      reasons: ["active_market_scan_running"],
      message: `A newer market scan is still running. Wait about ${seconds} seconds for it to finish. Saved recommendations are temporarily disabled.`,
    };
    return {
      tracking: quarantine({ tracking, attack, freshness }),
      freshness,
    };
  }
  if (lease?.status === "running" && leaseState.canAcquire) {
    const freshness: ActiveMarketReadFreshness = {
      schema: "truely.activeMarketReadFreshness.v1",
      status: "scan_lease_expired",
      usableForPricing: false,
      checkedAt: now.toISOString(),
      maxAgeMinutes,
      ageMinutes: null,
      basisTimestamps: [lease.startedAt, lease.expiresAt],
      reasons: ["active_market_scan_lease_expired"],
      message:
        "The previous market scan did not finish before its safety lease expired. Refresh InstaComp™ before using any active-market recommendation.",
    };
    return {
      tracking: quarantine({ tracking, attack, freshness }),
      freshness,
    };
  }

  const coverage = record(attack.sourceCoverage || tracking.sourceCoverage);
  const accounting = record(
    attack.evidenceAccounting || tracking.evidenceAccounting,
  );
  const timestampValues = [
    coverage.checkedAt,
    accounting.checkedAt,
    attack.updatedAt,
    tracking.updatedAt,
  ];
  const basisTimestamps = uniqueStrings(timestampValues);
  const reasons: string[] = [];
  if (!text(coverage.checkedAt)) reasons.push("source_coverage_timestamp_missing");
  if (!text(accounting.checkedAt)) reasons.push("evidence_accounting_timestamp_missing");
  if (!text(attack.updatedAt || tracking.updatedAt)) {
    reasons.push("active_market_timestamp_missing");
  }

  const parsed = basisTimestamps
    .map((value) => ({ value, ms: parsedMs(value) }))
    .filter((entry): entry is { value: string; ms: number } => entry.ms !== null);
  if (parsed.length !== basisTimestamps.length) {
    reasons.push("active_market_timestamp_invalid");
  }
  if (parsed.some((entry) => entry.ms > now.getTime() + 2 * 60_000)) {
    reasons.push("active_market_timestamp_in_future");
  }
  const ages = parsed.map((entry) => now.getTime() - entry.ms);
  const oldestAgeMs = ages.length ? Math.max(...ages) : null;
  if (oldestAgeMs !== null && oldestAgeMs > maxAgeMs) {
    reasons.push("active_market_snapshot_stale");
  }
  if (coverage.passed !== true) reasons.push("source_coverage_not_passed");
  if (accounting.passed !== true) reasons.push("evidence_accounting_not_passed");
  if (!text(attack.evidenceAccountingReceipt || tracking.evidenceAccountingReceipt)) {
    reasons.push("evidence_accounting_receipt_missing");
  }

  const ageMinutes =
    oldestAgeMs === null ? null : Math.max(0, oldestAgeMs / 60_000);
  if (reasons.length) {
    const ageText =
      ageMinutes === null
        ? "The saved evidence age could not be verified"
        : `The oldest required evidence is ${ageMinutes.toFixed(1)} minutes old`;
    const freshness: ActiveMarketReadFreshness = {
      schema: "truely.activeMarketReadFreshness.v1",
      status: "refresh_required",
      usableForPricing: false,
      checkedAt: now.toISOString(),
      maxAgeMinutes,
      ageMinutes,
      basisTimestamps,
      reasons: uniqueStrings(reasons),
      message: `${ageText}. Active-market pricing is disabled until InstaComp™ is refreshed.`,
    };
    return {
      tracking: quarantine({ tracking, attack, freshness }),
      freshness,
    };
  }

  const freshness: ActiveMarketReadFreshness = {
    schema: "truely.activeMarketReadFreshness.v1",
    status: "fresh",
    usableForPricing: tracking.trustedForPricing === true,
    checkedAt: now.toISOString(),
    maxAgeMinutes,
    ageMinutes,
    basisTimestamps,
    reasons: [],
    message: `Saved active-market evidence is fresh (${ageMinutes?.toFixed(1) || "0.0"} minutes old).`,
  };
  return {
    tracking: {
      ...tracking,
      readFreshness: freshness,
      activeMarketAttack: {
        ...attack,
        readFreshness: freshness,
        readFreshnessStatus: freshness.status,
        readFreshnessCheckedAt: freshness.checkedAt,
      },
    },
    freshness,
  };
}
