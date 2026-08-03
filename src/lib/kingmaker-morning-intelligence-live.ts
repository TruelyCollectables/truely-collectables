import "server-only";

import { getMarketIntelDealWorkbench } from "./market-intel-deals";
import { getPurchaseLedgerIntelligence } from "./market-intel-purchase-intelligence";
import { getMarketIntelReadiness } from "./market-intel-readiness";
import { getKingmakerTruthHealth } from "./kingmaker-truth-server";
import {
  buildKingmakerMorningIntelligence,
  type KingmakerIntelItem,
  type KingmakerMorningIntelligencePayload,
  type KingmakerPortfolioMovement,
} from "./kingmaker-morning-intelligence";

const MIN_ACTIONABLE_CONFIDENCE = 0.55;
const MAX_OPPORTUNITY_AGE_HOURS = 72;

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidence(value: unknown) {
  const parsed = number(value);
  if (parsed === null) return null;
  return parsed > 1 ? Math.min(1, parsed / 100) : Math.max(0, parsed);
}

function roi(cost: unknown, profit: unknown) {
  const costValue = number(cost);
  const profitValue = number(profit);
  return costValue && profitValue !== null ? (profitValue / costValue) * 100 : null;
}

function ageHours(value: unknown, nowMs: number) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? Math.max(0, (nowMs - parsed) / 3_600_000) : null;
}

function safeSourceWarning(source: string, code: string) {
  return `${source} unavailable (${code}). Raw diagnostics were retained server-side.`;
}

function opportunityItem(rowValue: unknown, nowMs: number): KingmakerIntelItem | null {
  const row = record(rowValue);
  const score = record(row.score);
  if (score.actionable !== true) return null;

  const title = text(row.original_title || row.title || row.exact_identity);
  const deliveredCost = number(score.delivered_cost);
  const expectedProfit = number(score.expected_net_profit);
  const itemRoi = number(score.expected_net_roi_percent) ?? roi(deliveredCost, expectedProfit);
  const itemConfidence = confidence(score.comp_confidence ?? score.confidence);
  const observedAt = text(row.last_seen_at || row.updated_at) || null;
  const observedAge = ageHours(observedAt, nowMs);

  const eligible =
    Boolean(title) &&
    deliveredCost !== null && deliveredCost > 0 &&
    expectedProfit !== null && expectedProfit > 0 &&
    itemRoi !== null && itemRoi > 0 &&
    itemConfidence !== null && itemConfidence >= MIN_ACTIONABLE_CONFIDENCE &&
    (observedAge === null || observedAge <= MAX_OPPORTUNITY_AGE_HOURS);
  if (!eligible) return null;

  const directUrl = text(row.direct_url || row.url) || null;
  return {
    key: `opportunity:${text(row.id || directUrl || title)}`,
    title,
    detail: [
      `Delivered cost $${deliveredCost.toFixed(2)}`,
      `Expected net profit $${expectedProfit.toFixed(2)}`,
      `Expected ROI ${itemRoi.toFixed(1)}%`,
      `Confidence ${(itemConfidence * 100).toFixed(0)}%`,
      score.buy_score === undefined ? null : `Buy score ${score.buy_score}`,
    ].filter(Boolean).join(" · "),
    href: directUrl,
    severity: "action",
    expectedProfit,
    roiPercent: itemRoi,
    confidence: itemConfidence,
    observedAt,
  };
}

function ledgerMovement(rowValue: unknown): KingmakerPortfolioMovement | null {
  const row = record(rowValue);
  const lot = record(row.lot);
  const signal = record(row.signal);
  const performance = record(row.performance);
  const collectible = record(lot.collectible);
  const signalKey = text(signal.key);
  const title = text(collectible.display_name || lot.title || `Purchase #${lot.purchase_number || "unknown"}`);
  if (!title) return null;

  const movementType = signalKey === "cooling"
    ? "cooling_signal"
    : ["sell_window", "take_profit_watch"].includes(signalKey)
      ? "sell_signal"
      : ["needs_comps", "low_confidence"].includes(signalKey)
        ? "research_debt"
        : null;
  if (!movementType) return null;

  const quantityRemaining = number(performance.quantity_remaining ?? lot.quantity_purchased);
  const amount = number(performance.realized_gross_profit ?? performance.unrealized_gross_profit);
  return {
    key: `position:${text(lot.id || lot.purchase_number || title)}:${signalKey}`,
    title,
    detail: [
      text(signal.label || signalKey.replaceAll("_", " ")),
      quantityRemaining === null ? null : `${quantityRemaining} unit${quantityRemaining === 1 ? "" : "s"} remaining`,
      text(signal.reason),
    ].filter(Boolean).join(" · "),
    href: lot.id ? `/admin/market-intel/purchases/${lot.id}` : "/admin/market-intel/purchases",
    movementType,
    amount,
    observedAt: text(lot.updated_at || lot.purchased_at) || null,
  };
}

export type BuildLiveKingmakerMorningIntelligenceOptions = {
  generatedAt?: string;
  previousFingerprint?: string | null;
  forceFull?: boolean;
};

export async function buildLiveKingmakerMorningIntelligence(
  options: BuildLiveKingmakerMorningIntelligenceOptions = {},
): Promise<KingmakerMorningIntelligencePayload> {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const nowMs = Date.parse(generatedAt) || Date.now();
  const [dealResult, ledgerResult, readinessResult, truthResult] = await Promise.allSettled([
    getMarketIntelDealWorkbench(),
    getPurchaseLedgerIntelligence(),
    getMarketIntelReadiness(),
    getKingmakerTruthHealth(),
  ]);

  const truthWarnings: string[] = [];
  const systemWarnings: string[] = [];
  const truthHealth = truthResult.status === "fulfilled" ? record(truthResult.value) : null;
  const readiness = readinessResult.status === "fulfilled" ? record(readinessResult.value) : null;

  if (truthResult.status === "rejected") truthWarnings.push(safeSourceWarning("Truth Engine", "truth_source_failed"));
  if (ledgerResult.status === "rejected") truthWarnings.push(safeSourceWarning("Purchase Ledger", "ledger_source_failed"));
  if (dealResult.status === "rejected") systemWarnings.push(safeSourceWarning("Opportunity workbench", "opportunity_source_failed"));
  if (readinessResult.status === "rejected") systemWarnings.push(safeSourceWarning("Market Intel readiness", "readiness_source_failed"));
  if (truthHealth && truthHealth.ready !== true) truthWarnings.push(`${number(truthHealth.inconsistent) ?? 0} KINGMAKER lifecycle record(s) require reconciliation.`);
  if (readiness && readiness.ready !== true) systemWarnings.push("Market Intel readiness is restricted or incomplete.");

  const dealWorkbench = dealResult.status === "fulfilled" ? record(dealResult.value) : {};
  const listings = Array.isArray(dealWorkbench.listings) ? dealWorkbench.listings : [];
  const actionableDeals = listings
    .map((row) => opportunityItem(row, nowMs))
    .filter((item): item is KingmakerIntelItem => Boolean(item))
    .sort((a, b) => (b.expectedProfit ?? 0) - (a.expectedProfit ?? 0))
    .slice(0, 20);

  const upstreamActionableCount = listings.filter((value) => record(record(value).score).actionable === true).length;
  const rejectedActionableCount = Math.max(0, upstreamActionableCount - actionableDeals.length);
  if (rejectedActionableCount > 0) {
    systemWarnings.push(`${rejectedActionableCount} upstream actionable candidate(s) were withheld by KINGMAKER eligibility guards.`);
  }

  const ledgerRows = ledgerResult.status === "fulfilled" && Array.isArray(ledgerResult.value)
    ? ledgerResult.value
    : [];
  const portfolioMovements = ledgerRows
    .map(ledgerMovement)
    .filter((item): item is KingmakerPortfolioMovement => Boolean(item))
    .slice(0, 30);

  const truthReady =
    truthResult.status === "fulfilled" &&
    ledgerResult.status === "fulfilled" &&
    truthHealth?.ready === true;

  return buildKingmakerMorningIntelligence({
    generatedAt,
    truthReady,
    truthWarnings,
    actionableDeals,
    meaningfulChanges: [],
    portfolioMovements,
    systemWarnings,
    previousFingerprint: options.previousFingerprint,
    forceFull: options.forceFull,
  });
}
