import "server-only";

import { createHash } from "node:crypto";
import { getMarketIntelCompOverview } from "./market-intel-comps";
import { getMarketIntelDealWorkbench } from "./market-intel-deals";
import { getMarketIntelPurchaseLedger } from "./market-intel";
import { getMarketIntelWatchlist } from "./market-intel-watchlist";
import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelAlertRow = {
  id: string;
  listing_id: string;
  deal_score_id: string | null;
  alert_fingerprint: string;
  alert_type: string;
  status: string;
  deal_label: string | null;
  title: string;
  summary: string | null;
  direct_url: string;
  delivered_cost: number | null;
  market_value: number | null;
  expected_net_profit: number | null;
  buy_score: number | null;
  first_qualified_at: string;
  last_qualified_at: string;
  sent_at: string | null;
  dismissed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type MarketIntelReportRun = {
  id: string;
  report_date: string;
  report_type: string;
  status: string;
  headline: string | null;
  report_markdown: string;
  report_json: Record<string, unknown>;
  generated_at: string;
  delivered_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

function dealLabel(value: string | null | undefined) {
  return String(value || "watch").replaceAll("_", " ").toUpperCase();
}

function denverDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function normalizeAlert(row: Record<string, unknown>): MarketIntelAlertRow {
  return {
    id: String(row.id),
    listing_id: String(row.listing_id),
    deal_score_id: row.deal_score_id ? String(row.deal_score_id) : null,
    alert_fingerprint: String(row.alert_fingerprint),
    alert_type: String(row.alert_type),
    status: String(row.status),
    deal_label: row.deal_label ? String(row.deal_label) : null,
    title: String(row.title),
    summary: row.summary ? String(row.summary) : null,
    direct_url: String(row.direct_url),
    delivered_cost: nullableNumber(row.delivered_cost),
    market_value: nullableNumber(row.market_value),
    expected_net_profit: nullableNumber(row.expected_net_profit),
    buy_score: nullableNumber(row.buy_score),
    first_qualified_at: String(row.first_qualified_at),
    last_qualified_at: String(row.last_qualified_at),
    sent_at: row.sent_at ? String(row.sent_at) : null,
    dismissed_at: row.dismissed_at ? String(row.dismissed_at) : null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    created_at: String(row.created_at),
  };
}

function normalizeReport(row: Record<string, unknown>): MarketIntelReportRun {
  return {
    id: String(row.id),
    report_date: String(row.report_date),
    report_type: String(row.report_type),
    status: String(row.status),
    headline: row.headline ? String(row.headline) : null,
    report_markdown: String(row.report_markdown),
    report_json: (row.report_json || {}) as Record<string, unknown>,
    generated_at: String(row.generated_at),
    delivered_at: row.delivered_at ? String(row.delivered_at) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
  };
}

function alertFingerprint(input: {
  listingId: string;
  label: string;
  deliveredCost: number;
  expectedNetProfit: number | null;
  directUrl: string;
}) {
  return createHash("sha256")
    .update(
      [
        input.listingId,
        input.label,
        input.deliveredCost.toFixed(2),
        (input.expectedNetProfit || 0).toFixed(2),
        input.directUrl,
      ].join("|"),
    )
    .digest("hex");
}

function alertTypeForListing(listing: {
  listing_format: string;
  auction_end_at: string | null;
  quantity: number;
  suspected_mislisting: boolean;
  score: { deal_label: string } | null;
}) {
  if (listing.suspected_mislisting || listing.score?.deal_label === "mislisted") {
    return "mislisted";
  }
  if (
    listing.quantity > 1 ||
    listing.score?.deal_label === "wholesale_opportunity"
  ) {
    return "wholesale";
  }
  if (listing.listing_format === "auction" && listing.auction_end_at) {
    const hoursRemaining =
      (new Date(listing.auction_end_at).getTime() - Date.now()) / 3_600_000;
    if (hoursRemaining >= 0 && hoursRemaining <= 6) return "auction_ending";
  }
  return "deal";
}

export async function syncMarketIntelAlertOutbox() {
  const supabase = createSupabaseServerClient({ admin: true });
  const { listings } = await getMarketIntelDealWorkbench();
  const qualified = listings.filter(
    (listing) => listing.score?.actionable && listing.listing_status === "active",
  );

  const { data: existingData, error: existingError } = await supabase
    .from("tcos_mi_alerts")
    .select("*")
    .order("created_at", { ascending: false });
  if (existingError) throw new Error(existingError.message);

  const existing = (existingData || []).map((row) =>
    normalizeAlert(row as Record<string, unknown>),
  );
  const existingByFingerprint = new Map(
    existing.map((alert) => [alert.alert_fingerprint, alert]),
  );
  const currentFingerprints = new Set<string>();
  const now = new Date().toISOString();
  let created = 0;
  let refreshed = 0;

  for (const listing of qualified) {
    const score = listing.score!;
    const fingerprint = alertFingerprint({
      listingId: listing.id,
      label: score.deal_label,
      deliveredCost: score.delivered_cost,
      expectedNetProfit: score.expected_net_profit,
      directUrl: listing.direct_url,
    });
    currentFingerprints.add(fingerprint);

    const payload = {
      listing_id: listing.id,
      deal_score_id: score.id,
      alert_fingerprint: fingerprint,
      alert_type: alertTypeForListing(listing),
      deal_label: score.deal_label,
      title: `${dealLabel(score.deal_label)} — ${listing.original_title}`,
      summary: score.reason,
      direct_url: listing.direct_url,
      delivered_cost: score.delivered_cost,
      market_value:
        listing.identity?.latest_value?.conservative_value || null,
      expected_net_profit: score.expected_net_profit,
      buy_score: score.buy_score,
      last_qualified_at: now,
      metadata: {
        marketplace: listing.marketplace?.name || null,
        quantity: listing.quantity,
        discount_pct: score.discount_pct,
        confidence_score: score.confidence_score,
        liquidity_score: score.liquidity_score,
        risk_score: score.risk_score,
        suspected_mislisting: listing.suspected_mislisting,
        mislisting_reason: listing.mislisting_reason,
      },
    };

    const prior = existingByFingerprint.get(fingerprint);
    if (prior) {
      const updatePayload: Record<string, unknown> = payload;
      if (prior.status === "expired") {
        updatePayload.status = "pending";
        updatePayload.first_qualified_at = now;
      }
      const { error } = await supabase
        .from("tcos_mi_alerts")
        .update(updatePayload)
        .eq("id", prior.id);
      if (error) throw new Error(error.message);
      refreshed += 1;
    } else {
      const { error } = await supabase.from("tcos_mi_alerts").insert({
        ...payload,
        status: "pending",
        first_qualified_at: now,
      });
      if (error) throw new Error(error.message);
      created += 1;
    }
  }

  const pendingToExpire = existing.filter(
    (alert) =>
      alert.status === "pending" &&
      !currentFingerprints.has(alert.alert_fingerprint),
  );
  let expired = 0;
  if (pendingToExpire.length > 0) {
    const { error } = await supabase
      .from("tcos_mi_alerts")
      .update({ status: "expired" })
      .in(
        "id",
        pendingToExpire.map((alert) => alert.id),
      );
    if (error) throw new Error(error.message);
    expired = pendingToExpire.length;
  }

  const { data: pendingData, error: pendingError } = await supabase
    .from("tcos_mi_alerts")
    .select("*")
    .eq("status", "pending")
    .order("buy_score", { ascending: false })
    .order("created_at", { ascending: false });
  if (pendingError) throw new Error(pendingError.message);

  return {
    qualified: qualified.length,
    created,
    refreshed,
    expired,
    pending: (pendingData || []).map((row) =>
      normalizeAlert(row as Record<string, unknown>),
    ),
  };
}

export async function generateDailyMarketIntelReport() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [dealData, purchaseRows, watchlist, compData, alertSync] =
    await Promise.all([
      getMarketIntelDealWorkbench(),
      getMarketIntelPurchaseLedger(),
      getMarketIntelWatchlist(),
      getMarketIntelCompOverview(),
      syncMarketIntelAlertOutbox(),
    ]);

  const actionable = dealData.listings
    .filter((listing) => listing.score?.actionable)
    .sort(
      (left, right) =>
        numberValue(right.score?.buy_score) -
        numberValue(left.score?.buy_score),
    );
  const topDeals = actionable.slice(0, 10).map((listing, index) => ({
    rank: index + 1,
    listingId: listing.id,
    title: listing.original_title,
    exactIdentity: listing.identity?.display_name || null,
    marketplace: listing.marketplace?.name || null,
    directUrl: listing.direct_url,
    dealLabel: listing.score?.deal_label || "watch",
    deliveredCost: numberValue(listing.score?.delivered_cost),
    marketValue:
      nullableNumber(listing.identity?.latest_value?.conservative_value) || null,
    discountPct: nullableNumber(listing.score?.discount_pct),
    expectedNetProfit: nullableNumber(listing.score?.expected_net_profit),
    buyScore: numberValue(listing.score?.buy_score),
    confidence: numberValue(listing.score?.confidence_score),
    liquidity: numberValue(listing.score?.liquidity_score),
    risk: numberValue(listing.score?.risk_score),
  }));

  const movers = compData.identities
    .filter(
      (identity) =>
        identity.latestValue &&
        (identity.latestValue.seven_day_change_pct !== null ||
          identity.latestValue.thirty_day_change_pct !== null),
    )
    .map((identity) => ({
      identityId: identity.id,
      title: identity.display_name,
      marketValue: identity.latestValue?.conservative_value || null,
      sevenDayChangePct:
        identity.latestValue?.seven_day_change_pct || null,
      thirtyDayChangePct:
        identity.latestValue?.thirty_day_change_pct || null,
      sampleSize: identity.latestValue?.sample_size || 0,
      confidence: identity.latestValue?.confidence_score || 0,
    }))
    .sort(
      (left, right) =>
        Math.abs(numberValue(right.sevenDayChangePct)) -
        Math.abs(numberValue(left.sevenDayChangePct)),
    )
    .slice(0, 10);

  const portfolio = purchaseRows.reduce(
    (summary, row) => {
      summary.purchaseLots += 1;
      summary.capitalDeployed += numberValue(
        row.lot.total_acquisition_cost,
      );
      summary.unitsRemaining += numberValue(
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
      );
      summary.realizedNetProceeds += numberValue(
        row.performance?.realized_net_proceeds,
      );
      summary.realizedGrossProfit += numberValue(
        row.performance?.realized_gross_profit,
      );
      return summary;
    },
    {
      purchaseLots: 0,
      capitalDeployed: 0,
      unitsRemaining: 0,
      realizedNetProceeds: 0,
      realizedGrossProfit: 0,
    },
  );

  const activeWatchlist = watchlist.filter((row) => row.active);
  const reportDate = denverDate();
  const headline =
    topDeals.length > 0
      ? `${topDeals.length} actionable buy${topDeals.length === 1 ? "" : "s"}; top score ${topDeals[0].buyScore.toFixed(0)}`
      : "No qualified buys cleared Beta One thresholds";

  const markdownLines = [
    `# TCOS Market Intel™ Beta One — Daily Intelligence`,
    `**Report date:** ${reportDate}`,
    ``,
    `## Executive Summary`,
    `- ${headline}`,
    `- ${activeWatchlist.length} active research targets`,
    `- ${alertSync.pending.length} pending alert${alertSync.pending.length === 1 ? "" : "s"}`,
    `- ${portfolio.purchaseLots} purchase lot${portfolio.purchaseLots === 1 ? "" : "s"}; ${portfolio.unitsRemaining} units remaining`,
    `- Capital deployed: ${money(portfolio.capitalDeployed)}`,
    `- Realized GP: ${money(portfolio.realizedGrossProfit)}`,
    ``,
    `## Shark List™ — Top Actionable Buys`,
  ];

  if (topDeals.length === 0) {
    markdownLines.push(`No listings currently qualify as actionable.`);
  } else {
    for (const deal of topDeals) {
      markdownLines.push(
        `${deal.rank}. **${dealLabel(deal.dealLabel)} — ${deal.title}**`,
        `   - Marketplace: ${deal.marketplace || "Unknown"}`,
        `   - Delivered: ${money(deal.deliveredCost)} | Market: ${money(deal.marketValue)} | Discount: ${percent(deal.discountPct)}`,
        `   - Expected net profit: ${money(deal.expectedNetProfit)} | Buy Score: ${deal.buyScore.toFixed(0)} | Confidence: ${deal.confidence.toFixed(0)} | Liquidity: ${deal.liquidity.toFixed(0)} | Risk: ${deal.risk.toFixed(0)}`,
        `   - OPEN LISTING: ${deal.directUrl}`,
      );
    }
  }

  markdownLines.push(``, `## Market Movers`);
  if (movers.length === 0) {
    markdownLines.push(`No card market has enough comparison history for movement analysis.`);
  } else {
    for (const mover of movers) {
      markdownLines.push(
        `- **${mover.title}** — ${money(mover.marketValue)} | 7-day ${percent(mover.sevenDayChangePct)} | 30-day ${percent(mover.thirtyDayChangePct)} | ${mover.sampleSize} comps | confidence ${mover.confidence.toFixed(0)}%`,
      );
    }
  }

  markdownLines.push(
    ``,
    `## Portfolio`,
    `- Capital deployed: ${money(portfolio.capitalDeployed)}`,
    `- Realized net proceeds: ${money(portfolio.realizedNetProceeds)}`,
    `- Realized gross profit: ${money(portfolio.realizedGrossProfit)}`,
    `- Units remaining: ${portfolio.unitsRemaining}`,
    ``,
    `## Alert Outbox`,
    `- New alerts created this run: ${alertSync.created}`,
    `- Existing alerts refreshed: ${alertSync.refreshed}`,
    `- Old pending alerts expired: ${alertSync.expired}`,
    `- Pending alerts: ${alertSync.pending.length}`,
  );

  const report = {
    reportDate,
    generatedAt: new Date().toISOString(),
    headline,
    activeWatchlistCount: activeWatchlist.length,
    topDeals,
    movers,
    portfolio,
    alertSummary: {
      created: alertSync.created,
      refreshed: alertSync.refreshed,
      expired: alertSync.expired,
      pending: alertSync.pending.length,
    },
  };
  const reportMarkdown = markdownLines.join("\n");

  const { data: saved, error } = await supabase
    .from("tcos_mi_report_runs")
    .upsert(
      {
        report_date: reportDate,
        report_type: "daily_intelligence",
        status: "generated",
        headline,
        report_markdown: reportMarkdown,
        report_json: report,
        generated_at: new Date().toISOString(),
        error_message: null,
        metadata: {
          generator: "market-intel-beta-one",
          version: "beta-one-v1",
        },
      },
      { onConflict: "report_date,report_type" },
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return {
    report: normalizeReport(saved as Record<string, unknown>),
    pendingAlerts: alertSync.pending,
  };
}

export async function getMarketIntelReportsAndAlerts() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [reportResult, alertResult] = await Promise.all([
    supabase
      .from("tcos_mi_report_runs")
      .select("*")
      .order("generated_at", { ascending: false })
      .limit(30),
    supabase
      .from("tcos_mi_alerts")
      .select("*")
      .order("status", { ascending: true })
      .order("buy_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (reportResult.error) throw new Error(reportResult.error.message);
  if (alertResult.error) throw new Error(alertResult.error.message);

  return {
    reports: (reportResult.data || []).map((row) =>
      normalizeReport(row as Record<string, unknown>),
    ),
    alerts: (alertResult.data || []).map((row) =>
      normalizeAlert(row as Record<string, unknown>),
    ),
  };
}
