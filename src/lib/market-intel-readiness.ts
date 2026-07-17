import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelReadinessStatus = "pass" | "warn" | "fail";

export type MarketIntelReadinessCheck = {
  key: string;
  label: string;
  status: MarketIntelReadinessStatus;
  detail: string;
  count?: number | null;
};

async function tableCount(table: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  return {
    count: count ?? 0,
    error: error?.message || null,
  };
}

function envCheck(
  key: string,
  label: string,
  configured: boolean,
  required: boolean,
  detail: string,
): MarketIntelReadinessCheck {
  return {
    key,
    label,
    status: configured ? "pass" : required ? "fail" : "warn",
    detail: configured ? `${detail} Configured.` : `${detail} Missing.`,
  };
}

export async function getMarketIntelReadiness() {
  const tableNames = [
    "tcos_mi_subjects",
    "tcos_mi_marketplaces",
    "tcos_mi_collectible_identities",
    "tcos_mi_watchlist",
    "tcos_mi_sold_comps",
    "tcos_mi_market_values",
    "tcos_mi_listings",
    "tcos_mi_deal_scores",
    "tcos_mi_purchase_lots",
    "tcos_mi_inventory_sales",
    "tcos_mi_alerts",
    "tcos_mi_report_runs",
  ] as const;

  const results = await Promise.all(
    tableNames.map(async (table) => [table, await tableCount(table)] as const),
  );
  const tableResults = new Map(results);

  const coreTables = tableNames.slice(0, 10);
  const coreAccessible = coreTables.every(
    (table) => !tableResults.get(table)?.error,
  );
  const alertTablesAccessible = ["tcos_mi_alerts", "tcos_mi_report_runs"].every(
    (table) => !tableResults.get(table)?.error,
  );

  const checks: MarketIntelReadinessCheck[] = [
    envCheck(
      "supabase-url",
      "Supabase URL",
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
      true,
      "Required for every Beta One database operation.",
    ),
    envCheck(
      "service-role",
      "Supabase Service Role",
      Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      true,
      "Required for private server-only RLS access.",
    ),
    envCheck(
      "ebay-credentials",
      "eBay Browse Credentials",
      Boolean(
        process.env.EBAY_CLIENT_ID?.trim() &&
          process.env.EBAY_CLIENT_SECRET?.trim(),
      ),
      true,
      "Required for the hourly eBay active-listing scanner.",
    ),
    envCheck(
      "cron-secret",
      "Cron Secret",
      Boolean(process.env.CRON_SECRET?.trim()),
      true,
      "Required to protect hourly scans, cleanup, alerts, and daily reports.",
    ),
    envCheck(
      "ingest-secret",
      "External Ingestion Secret",
      Boolean(
        process.env.MARKET_INTEL_INGEST_SECRET?.trim() ||
          process.env.CRON_SECRET?.trim(),
      ),
      false,
      "Used by non-eBay marketplace research feeds.",
    ),
    envCheck(
      "resend",
      "Resend Delivery",
      Boolean(process.env.RESEND_API_KEY?.trim()),
      false,
      "Used by the alert and daily-report delivery center.",
    ),
    {
      key: "core-schema",
      label: "Core Market Intel Schema",
      status: coreAccessible ? "pass" : "fail",
      detail: coreAccessible
        ? "All core Beta One tables are accessible through the server client."
        : `Missing or inaccessible: ${coreTables
            .filter((table) => tableResults.get(table)?.error)
            .join(", ")}.`,
    },
    {
      key: "alert-schema",
      label: "Alert + Report Persistence",
      status: alertTablesAccessible ? "pass" : "warn",
      detail: alertTablesAccessible
        ? "Alert outbox and daily report tables are installed."
        : "Apply the alerts/reports migration to persist duplicate-suppressed alerts and daily reports.",
    },
  ];

  const dataChecks: Array<{
    table: (typeof tableNames)[number];
    label: string;
    emptyDetail: string;
    populatedDetail: string;
  }> = [
    {
      table: "tcos_mi_watchlist",
      label: "Watchlist Targets",
      emptyDetail: "No players or collectible targets are active yet.",
      populatedDetail: "Watchlist targets are stored in Beta One.",
    },
    {
      table: "tcos_mi_collectible_identities",
      label: "Exact Collectible Identities",
      emptyDetail: "No exact-card identities exist yet.",
      populatedDetail: "Exact identities are available for matching.",
    },
    {
      table: "tcos_mi_sold_comps",
      label: "Verified Sold Comps",
      emptyDetail: "No sold comps have been entered or ingested yet.",
      populatedDetail: "Sold-comp evidence is available.",
    },
    {
      table: "tcos_mi_market_values",
      label: "Market Value Snapshots",
      emptyDetail: "No market values have been calculated yet.",
      populatedDetail: "Market-value snapshots are available for scoring.",
    },
    {
      table: "tcos_mi_listings",
      label: "Marketplace Listings",
      emptyDetail: "No marketplace listings have been ingested yet.",
      populatedDetail: "Normalized marketplace listings are stored.",
    },
    {
      table: "tcos_mi_deal_scores",
      label: "Deal Scores",
      emptyDetail: "No listings have been scored yet.",
      populatedDetail: "Deal scores are available for the Shark List.",
    },
    {
      table: "tcos_mi_purchase_lots",
      label: "Tracked Purchases",
      emptyDetail: "No purchase positions are recorded.",
      populatedDetail: "Purchase positions are tracked.",
    },
  ];

  for (const dataCheck of dataChecks) {
    const result = tableResults.get(dataCheck.table);
    const count = result?.count ?? 0;
    checks.push({
      key: dataCheck.table,
      label: dataCheck.label,
      status: result?.error ? "fail" : count > 0 ? "pass" : "warn",
      detail: result?.error
        ? result.error
        : count > 0
          ? dataCheck.populatedDetail
          : dataCheck.emptyDetail,
      count,
    });
  }

  const requiredFailures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  return {
    checks,
    coreAccessible,
    alertTablesAccessible,
    ready: requiredFailures.length === 0,
    requiredFailures: requiredFailures.length,
    warnings: warnings.length,
    counts: Object.fromEntries(
      results.map(([table, result]) => [table, result.count]),
    ) as Record<string, number>,
  };
}
