import "server-only";

import { getMarketIntelCompOverview } from "./market-intel-comps";
import { getMarketIntelDealWorkbench } from "./market-intel-deals";
import {
  getMarketIntelObservations,
  type MarketIntelMarketObservation,
} from "./market-intel-observations";
import { getMarketIntelPortfolio } from "./market-intel-portfolio";
import { getMarketIntelReportsAndAlerts } from "./market-intel-reporting";
import { getMarketIntelWatchlist } from "./market-intel-watchlist";

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value || "Unknown error");
}

function isResearchOnlyObservation(row: MarketIntelMarketObservation) {
  const metadata = row.metadata || {};
  return (
    metadata.research_evidence_class === "external_item_price_guide" ||
    (metadata.price_basis === "item_only" &&
      metadata.sold_comp_valuation_allowed === false)
  );
}

export async function getMarketIntelWatchCenter() {
  const [watchResult, compResult, dealResult, portfolioResult, reportResult] =
    await Promise.allSettled([
      getMarketIntelWatchlist(),
      getMarketIntelCompOverview(),
      getMarketIntelDealWorkbench(),
      getMarketIntelPortfolio(),
      getMarketIntelReportsAndAlerts(),
    ]);

  const watchlist = watchResult.status === "fulfilled" ? watchResult.value : [];
  const subjectIds = Array.from(
    new Set(
      watchlist
        .filter((row) => row.active && row.subject_id)
        .map((row) => String(row.subject_id)),
    ),
  );
  const observationResult = await getMarketIntelObservations({
    subjectIds,
    limit: 5000,
  }).catch((error) => ({
    available: false as const,
    migrationRequired: false as const,
    rows: [],
    error: errorMessage(error),
  }));
  const researchObservations = observationResult.rows.filter(
    isResearchOnlyObservation,
  );
  const valuationObservations = observationResult.rows.filter(
    (row) => !isResearchOnlyObservation(row),
  );

  const errors = [
    watchResult.status === "rejected"
      ? `Watchlist: ${errorMessage(watchResult.reason)}`
      : null,
    compResult.status === "rejected"
      ? `Exact markets: ${errorMessage(compResult.reason)}`
      : null,
    dealResult.status === "rejected"
      ? `Live prices: ${errorMessage(dealResult.reason)}`
      : null,
    portfolioResult.status === "rejected"
      ? `Portfolio: ${errorMessage(portfolioResult.reason)}`
      : null,
    reportResult.status === "rejected"
      ? `Alerts: ${errorMessage(reportResult.reason)}`
      : null,
    observationResult.error
      ? `Market observations: ${observationResult.error}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    watchlist,
    identities:
      compResult.status === "fulfilled" ? compResult.value.identities : [],
    listings:
      dealResult.status === "fulfilled" ? dealResult.value.listings : [],
    positions:
      portfolioResult.status === "fulfilled" ? portfolioResult.value.positions : [],
    alerts:
      reportResult.status === "fulfilled" ? reportResult.value.alerts : [],
    observations: valuationObservations,
    researchObservations,
    observationsAvailable: observationResult.available,
    observationMigrationRequired: observationResult.migrationRequired,
    alertsAvailable: reportResult.status === "fulfilled",
    errors,
  };
}
