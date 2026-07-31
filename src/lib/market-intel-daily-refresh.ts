import "server-only";

import { scanEbayForMarketIntel } from "./market-intel-ebay";
import { cleanupStaleMarketIntelListings } from "./market-intel-ingestion";
import {
  generateDailyMarketIntelReport,
  type MarketIntelReportRun,
} from "./market-intel-reporting";
import { createSupabaseServerClient } from "./supabase-server";

type ActiveIdentityRow = {
  id: string;
  display_name: string;
  created_at: string;
};

export type MarketIntelDailySourceRefresh = {
  status: "complete" | "partial";
  refreshedAt: string;
  activeIdentityCount: number;
  targetCount: number;
  successfulTargetCount: number;
  failedTargetCount: number;
  skippedIdentityCount: number;
  candidatesAccepted: number;
  listingsCreated: number;
  listingsUpdated: number;
  priceChanges: number;
  listingsScored: number;
  cleanup: {
    staleAfterHours: number;
    endedAuctions: number;
    markedStale: number;
  };
  errors: string[];
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function chunks<T>(rows: T[], size: number) {
  const grouped: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    grouped.push(rows.slice(index, index + size));
  }
  return grouped;
}

function denverTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export async function getAllActiveMarketIntelIdentityIds() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id,display_name,created_at")
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);

  return ((data || []) as ActiveIdentityRow[]).map((row) => String(row.id));
}

export async function getRotatingMarketIntelIdentityIds(
  maxTargets = 10,
  now = Date.now(),
) {
  const allIds = await getAllActiveMarketIntelIdentityIds();
  if (allIds.length === 0) return [];

  const safeMaximum = clamp(Math.round(maxTargets || 10), 1, 25);
  if (allIds.length <= safeMaximum) return allIds;

  const rotationSlot = Math.floor(now / SIX_HOURS_MS);
  const offset = (rotationSlot * safeMaximum) % allIds.length;
  const selected: string[] = [];

  for (let index = 0; index < safeMaximum; index += 1) {
    selected.push(allIds[(offset + index) % allIds.length]);
  }

  return selected;
}

export async function refreshMarketIntelSourcesForDailyReport(options?: {
  resultsPerTarget?: number;
  minimumConfidence?: number;
  batchSize?: number;
  staleAfterHours?: number;
}) {
  const resultsPerTarget = clamp(
    Math.round(options?.resultsPerTarget || 6),
    1,
    10,
  );
  const minimumConfidence = clamp(
    Number(options?.minimumConfidence ?? 70),
    0,
    100,
  );
  const batchSize = clamp(Math.round(options?.batchSize || 10), 1, 25);
  const staleAfterHours = clamp(
    Number(options?.staleAfterHours ?? 26),
    1,
    168,
  );

  const identityIds = await getAllActiveMarketIntelIdentityIds();
  if (identityIds.length === 0) {
    throw new Error(
      "No active exact-card identities are available for the daily Market Intel refresh.",
    );
  }

  const cleanup = await cleanupStaleMarketIntelListings(staleAfterHours);
  const scanResults: Array<Awaited<ReturnType<typeof scanEbayForMarketIntel>>> = [];

  for (const identityBatch of chunks(identityIds, batchSize)) {
    scanResults.push(
      await scanEbayForMarketIntel({
        identityIds: identityBatch,
        maxTargets: identityBatch.length,
        resultsPerTarget,
        minimumConfidence,
      }),
    );
  }

  const targetResults = scanResults.flatMap((result) => result.targetResults);
  const errors = targetResults
    .filter((result) => Boolean(result.error))
    .map(
      (result) =>
        `${result.displayName}: ${result.error || "Unknown source refresh error."}`,
    );
  const targetCount = scanResults.reduce(
    (sum, result) => sum + result.targetCount,
    0,
  );
  const failedTargetCount = errors.length;
  const successfulTargetCount = Math.max(0, targetCount - failedTargetCount);
  const skippedIdentityCount = Math.max(0, identityIds.length - targetCount);

  if (successfulTargetCount === 0) {
    throw new Error(
      errors[0] ||
        "The daily Market Intel source refresh did not complete any exact-card targets.",
    );
  }

  const refresh: MarketIntelDailySourceRefresh = {
    status:
      failedTargetCount === 0 && skippedIdentityCount === 0
        ? "complete"
        : "partial",
    refreshedAt: new Date().toISOString(),
    activeIdentityCount: identityIds.length,
    targetCount,
    successfulTargetCount,
    failedTargetCount,
    skippedIdentityCount,
    candidatesAccepted: scanResults.reduce(
      (sum, result) => sum + result.candidatesAccepted,
      0,
    ),
    listingsCreated: scanResults.reduce(
      (sum, result) => sum + result.ingest.created,
      0,
    ),
    listingsUpdated: scanResults.reduce(
      (sum, result) => sum + result.ingest.updated,
      0,
    ),
    priceChanges: scanResults.reduce(
      (sum, result) => sum + result.ingest.priceChanges,
      0,
    ),
    listingsScored: scanResults.reduce(
      (sum, result) => sum + result.ingest.scored,
      0,
    ),
    cleanup: {
      staleAfterHours: cleanup.staleAfterHours,
      endedAuctions: cleanup.endedAuctions,
      markedStale: cleanup.markedStale,
    },
    errors: errors.slice(0, 20),
  };

  return refresh;
}

function addFreshnessToMarkdown(
  report: MarketIntelReportRun,
  refresh: MarketIntelDailySourceRefresh,
) {
  const reportDateLine = `**Report date:** ${report.report_date}`;
  const freshnessHeader = [
    reportDateLine,
    `**Data refreshed:** ${denverTime(refresh.refreshedAt)}`,
    `**Source status:** ${refresh.status.toUpperCase()} — ${refresh.successfulTargetCount}/${refresh.activeIdentityCount} active exact-card identities refreshed`,
  ].join("\n");
  const body = report.report_markdown.includes(reportDateLine)
    ? report.report_markdown.replace(reportDateLine, freshnessHeader)
    : `${freshnessHeader}\n\n${report.report_markdown}`;

  return [
    body,
    "",
    "## Data Freshness",
    `- Source refresh: ${refresh.status.toUpperCase()}`,
    `- Active exact-card identities: ${refresh.activeIdentityCount}`,
    `- Successfully refreshed immediately before this report: ${refresh.successfulTargetCount}`,
    `- Failed targets: ${refresh.failedTargetCount}`,
    `- Skipped identities: ${refresh.skippedIdentityCount}`,
    `- eBay candidates accepted: ${refresh.candidatesAccepted}`,
    `- Listings created: ${refresh.listingsCreated}`,
    `- Listings updated: ${refresh.listingsUpdated}`,
    `- Price changes detected: ${refresh.priceChanges}`,
    `- Listings rescored: ${refresh.listingsScored}`,
    `- Ended auctions closed: ${refresh.cleanup.endedAuctions}`,
    `- Old listings marked stale: ${refresh.cleanup.markedStale}`,
    ...(refresh.errors.length
      ? ["", "### Source Refresh Warnings", ...refresh.errors.map((error) => `- ${error}`)]
      : []),
  ].join("\n");
}

export async function generateFreshDailyMarketIntelReport() {
  const refresh = await refreshMarketIntelSourcesForDailyReport();
  const generated = await generateDailyMarketIntelReport();
  const supabase = createSupabaseServerClient({ admin: true });
  const reportMarkdown = addFreshnessToMarkdown(generated.report, refresh);
  const headline =
    refresh.status === "complete"
      ? generated.report.headline
      : `PARTIAL SOURCE REFRESH — ${generated.report.headline || "Daily intelligence generated"}`;
  const reportJson = {
    ...generated.report.report_json,
    headline,
    sourceFreshness: refresh,
  };
  const metadata = {
    ...generated.report.metadata,
    source_freshness: refresh,
    source_refresh_required: true,
  };

  const { error } = await supabase
    .from("tcos_mi_report_runs")
    .update({
      headline,
      report_markdown: reportMarkdown,
      report_json: reportJson,
      metadata,
    })
    .eq("id", generated.report.id);
  if (error) throw new Error(error.message);

  return {
    report: {
      ...generated.report,
      headline,
      report_markdown: reportMarkdown,
      report_json: reportJson,
      metadata,
    },
    pendingAlerts: generated.pendingAlerts,
    refresh,
  };
}
