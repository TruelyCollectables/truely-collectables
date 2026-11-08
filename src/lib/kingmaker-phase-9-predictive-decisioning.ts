import { createHash } from "node:crypto";

export type PredictionTrend = "improving" | "stable" | "deteriorating";
export type ReadinessBand = "excellent" | "ready" | "caution" | "blocked";
export type SimulationScenario = "conservative" | "expected" | "optimistic";

export type MetricPoint = { at: string; value: number };
export type MarketplaceSignal = {
  marketplace: string;
  identityKey: string;
  observedAt: string;
  askingPrice: number;
  availableQuantity: number;
  sellerScore: number;
  confidence: number;
};

export type PortfolioCandidate = {
  identityKey: string;
  cost: number;
  expectedSalePrice: number;
  fees: number;
  shipping: number;
  confidence: number;
  risk: number;
  expectedHoldDays: number;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function finite(value: number, code: string) {
  if (!Number.isFinite(value)) throw new Error(code);
  return value;
}

function bounded(value: number, min: number, max: number, code: string) {
  finite(value, code);
  if (value < min || value > max) throw new Error(code);
  return value;
}

function assertDate(value: string, code: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
}

function round(value: number, places = 4) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export function forecastKingmakerMetric(input: {
  metric: string;
  points: MetricPoint[];
  horizonPeriods: number;
  warningThreshold?: number;
}) {
  if (!input.metric.trim()) throw new Error("missing_metric");
  if (!Number.isInteger(input.horizonPeriods) || input.horizonPeriods < 1 || input.horizonPeriods > 365) throw new Error("invalid_horizon");
  if (input.points.length < 3) throw new Error("insufficient_history");
  const points = [...input.points].map((point) => {
    assertDate(point.at, "invalid_metric_time");
    finite(point.value, "invalid_metric_value");
    return point;
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].at === points[i - 1].at) throw new Error("duplicate_metric_time");
  }
  const n = points.length;
  const xs = points.map((_, index) => index);
  const xMean = (n - 1) / 2;
  const yMean = points.reduce((sum, point) => sum + point.value, 0) / n;
  const numerator = xs.reduce((sum, x, index) => sum + (x - xMean) * (points[index].value - yMean), 0);
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const predicted = intercept + slope * (n - 1 + input.horizonPeriods);
  const residuals = points.map((point, index) => point.value - (intercept + slope * index));
  const rmse = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / n);
  const confidence = round(Math.max(0, Math.min(1, 1 - rmse / Math.max(1, Math.abs(yMean)))));
  const trend: PredictionTrend = slope > 0.01 ? "deteriorating" : slope < -0.01 ? "improving" : "stable";
  const warningInPeriods = input.warningThreshold == null || slope <= 0
    ? null
    : Math.max(0, Math.ceil((input.warningThreshold - points[n - 1].value) / slope));
  const canonical = {
    metric: input.metric.trim(),
    lastObserved: points[n - 1].value,
    predicted: round(predicted),
    lowerBound: round(predicted - 1.96 * rmse),
    upperBound: round(predicted + 1.96 * rmse),
    slope: round(slope),
    rmse: round(rmse),
    confidence,
    trend,
    warningInPeriods,
    horizonPeriods: input.horizonPeriods,
  };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function correlateKingmakerMarkets(input: { signals: MarketplaceSignal[]; now: string; maxAgeHours?: number }) {
  assertDate(input.now, "invalid_correlation_time");
  const maxAgeHours = bounded(input.maxAgeHours ?? 24, 1, 720, "invalid_max_age");
  const nowMs = Date.parse(input.now);
  const valid = input.signals.map((signal) => {
    assertDate(signal.observedAt, "invalid_signal_time");
    if (!signal.marketplace.trim() || !signal.identityKey.trim()) throw new Error("invalid_signal_identity");
    bounded(signal.askingPrice, 0.01, 10_000_000, "invalid_signal_price");
    bounded(signal.availableQuantity, 0, 1_000_000, "invalid_signal_quantity");
    bounded(signal.sellerScore, 0, 100, "invalid_seller_score");
    bounded(signal.confidence, 0, 1, "invalid_signal_confidence");
    const ageHours = (nowMs - Date.parse(signal.observedAt)) / 3_600_000;
    if (ageHours < 0 || ageHours > maxAgeHours) return null;
    return signal;
  }).filter((value): value is MarketplaceSignal => value !== null);
  const groups = new Map<string, MarketplaceSignal[]>();
  for (const signal of valid) groups.set(signal.identityKey, [...(groups.get(signal.identityKey) ?? []), signal]);
  const correlations = [...groups.entries()].map(([identityKey, signals]) => {
    const marketplaces = [...new Set(signals.map((signal) => signal.marketplace))].sort();
    const prices = signals.map((signal) => signal.askingPrice);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const spread = maxPrice - minPrice;
    const spreadPct = minPrice === 0 ? 0 : spread / minPrice;
    const weightedConfidence = signals.reduce((sum, signal) => sum + signal.confidence * signal.sellerScore, 0) /
      Math.max(1, signals.reduce((sum, signal) => sum + signal.sellerScore, 0));
    const totalQuantity = signals.reduce((sum, signal) => sum + signal.availableQuantity, 0);
    const canonical = {
      identityKey,
      marketplaces,
      signalCount: signals.length,
      minPrice: round(minPrice, 2),
      maxPrice: round(maxPrice, 2),
      spread: round(spread, 2),
      spreadPct: round(spreadPct),
      weightedConfidence: round(weightedConfidence),
      totalQuantity,
      arbitrageCandidate: marketplaces.length >= 2 && spreadPct >= 0.15 && weightedConfidence >= 0.7,
    };
    return { ...canonical, fingerprint: hash(canonical) };
  }).sort((a, b) => b.spreadPct - a.spreadPct || a.identityKey.localeCompare(b.identityKey));
  return { correlations, fingerprint: hash(correlations.map((value) => value.fingerprint)) };
}

export function simulateKingmakerPortfolio(input: {
  availableCapital: number;
  candidates: PortfolioCandidate[];
  maxSingleExposurePct?: number;
}) {
  bounded(input.availableCapital, 0, 100_000_000, "invalid_available_capital");
  const maxSingleExposurePct = bounded(input.maxSingleExposurePct ?? 0.25, 0.01, 1, "invalid_single_exposure");
  const normalized = input.candidates.map((candidate) => {
    if (!candidate.identityKey.trim()) throw new Error("missing_candidate_identity");
    bounded(candidate.cost, 0.01, 10_000_000, "invalid_candidate_cost");
    bounded(candidate.expectedSalePrice, 0, 10_000_000, "invalid_sale_price");
    bounded(candidate.fees, 0, 10_000_000, "invalid_fees");
    bounded(candidate.shipping, 0, 10_000_000, "invalid_shipping");
    bounded(candidate.confidence, 0, 1, "invalid_candidate_confidence");
    bounded(candidate.risk, 0, 100, "invalid_candidate_risk");
    bounded(candidate.expectedHoldDays, 0, 3650, "invalid_hold_days");
    const net = candidate.expectedSalePrice - candidate.fees - candidate.shipping - candidate.cost;
    const roi = net / candidate.cost;
    const score = roi * candidate.confidence * (1 - candidate.risk / 100) / Math.max(1, candidate.expectedHoldDays / 30);
    return { ...candidate, expectedProfit: round(net, 2), expectedRoi: round(roi), score: round(score, 8) };
  }).filter((candidate) => candidate.expectedProfit > 0).sort((a, b) => b.score - a.score || a.identityKey.localeCompare(b.identityKey));
  let remaining = input.availableCapital;
  const selected: typeof normalized = [];
  for (const candidate of normalized) {
    if (candidate.cost > input.availableCapital * maxSingleExposurePct || candidate.cost > remaining) continue;
    selected.push(candidate);
    remaining -= candidate.cost;
  }
  const scenarioMultipliers: Record<SimulationScenario, number> = { conservative: 0.65, expected: 1, optimistic: 1.25 };
  const scenarios = (Object.keys(scenarioMultipliers) as SimulationScenario[]).map((scenario) => {
    const multiplier = scenarioMultipliers[scenario];
    const profit = selected.reduce((sum, candidate) => sum + candidate.expectedProfit * multiplier, 0);
    const deployed = selected.reduce((sum, candidate) => sum + candidate.cost, 0);
    const canonical = { scenario, deployed: round(deployed, 2), projectedProfit: round(profit, 2), projectedRoi: deployed ? round(profit / deployed) : 0 };
    return { ...canonical, fingerprint: hash(canonical) };
  });
  const canonical = {
    availableCapital: round(input.availableCapital, 2),
    deployedCapital: round(input.availableCapital - remaining, 2),
    remainingCapital: round(remaining, 2),
    selected,
    rejectedCount: normalized.length - selected.length,
    scenarios,
  };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function scoreKingmakerReadiness(input: {
  serviceHealth: number;
  dataFreshness: number;
  capitalAvailability: number;
  queuePressure: number;
  portfolioRisk: number;
  unresolvedCriticalIncidents: number;
  authorizationIntegrity: boolean;
}) {
  const serviceHealth = bounded(input.serviceHealth, 0, 100, "invalid_service_health");
  const dataFreshness = bounded(input.dataFreshness, 0, 100, "invalid_data_freshness");
  const capitalAvailability = bounded(input.capitalAvailability, 0, 100, "invalid_capital_availability");
  const queuePressure = bounded(input.queuePressure, 0, 100, "invalid_queue_pressure");
  const portfolioRisk = bounded(input.portfolioRisk, 0, 100, "invalid_portfolio_risk");
  if (!Number.isInteger(input.unresolvedCriticalIncidents) || input.unresolvedCriticalIncidents < 0) throw new Error("invalid_incident_count");
  const score = round(
    serviceHealth * 0.28 + dataFreshness * 0.22 + capitalAvailability * 0.18 +
    (100 - queuePressure) * 0.14 + (100 - portfolioRisk) * 0.18 - input.unresolvedCriticalIncidents * 20,
    2,
  );
  const blocked = !input.authorizationIntegrity || input.unresolvedCriticalIncidents > 0;
  const band: ReadinessBand = blocked ? "blocked" : score >= 90 ? "excellent" : score >= 75 ? "ready" : score >= 55 ? "caution" : "blocked";
  const reasons = [
    !input.authorizationIntegrity ? "authorization_integrity_failed" : null,
    input.unresolvedCriticalIncidents > 0 ? "critical_incident_open" : null,
    serviceHealth < 75 ? "service_health_low" : null,
    dataFreshness < 75 ? "data_freshness_low" : null,
    queuePressure > 75 ? "queue_pressure_high" : null,
    portfolioRisk > 70 ? "portfolio_risk_high" : null,
  ].filter((value): value is string => value !== null);
  const canonical = { score: Math.max(0, Math.min(100, score)), band, reasons, authorizationIntegrity: input.authorizationIntegrity };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function explainKingmakerDecision(input: {
  identityKey: string;
  action: "buy" | "offer" | "watch" | "research" | "reject";
  price: number;
  marketplace: string;
  sellerScore: number;
  confidence: number;
  expectedRoi: number;
  risk: number;
  changedSignals: string[];
  invalidators: string[];
}) {
  if (!input.identityKey.trim() || !input.marketplace.trim()) throw new Error("invalid_explanation_identity");
  bounded(input.price, 0, 10_000_000, "invalid_explanation_price");
  bounded(input.sellerScore, 0, 100, "invalid_explanation_seller");
  bounded(input.confidence, 0, 1, "invalid_explanation_confidence");
  bounded(input.risk, 0, 100, "invalid_explanation_risk");
  finite(input.expectedRoi, "invalid_explanation_roi");
  const whyNow = input.changedSignals.length ? [...new Set(input.changedSignals.map((value) => value.trim()).filter(Boolean))].sort() : ["no_material_change_recorded"];
  const invalidators = [...new Set(input.invalidators.map((value) => value.trim()).filter(Boolean))].sort();
  const canonical = {
    identityKey: input.identityKey.trim(),
    action: input.action,
    whyNow,
    whyMarketplace: `${input.marketplace.trim()} currently provides the evaluated price and evidence set.`,
    whySeller: `Seller reliability score is ${round(input.sellerScore, 2)}.`,
    whyPrice: `Evaluated price is ${round(input.price, 2)} with expected ROI ${round(input.expectedRoi * 100, 2)}%.`,
    confidence: round(input.confidence),
    risk: round(input.risk, 2),
    invalidators,
  };
  return { ...canonical, fingerprint: hash(canonical) };
}
