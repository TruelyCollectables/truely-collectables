import { createHash } from "node:crypto";

export type KingmakerLiveSource = "ebay" | "mercari" | "poshmark" | "facebook" | "comc" | "whatnot" | "fanatics" | "manual";
export type KingmakerExecutiveAction = "buy_now" | "make_offer" | "watch" | "research" | "reject";

export type KingmakerLiveObservation = {
  source: KingmakerLiveSource;
  sourceRecordId: string;
  entityKey: string;
  observedAt: string;
  askingPrice: number;
  shipping: number;
  fees: number;
  marketValue: number;
  confidence: number;
  sellerReliability: number;
  riskScore: number;
  momentumScore: number;
  sourceUrl?: string;
};

export type KingmakerLiveDecision = {
  entityKey: string;
  source: KingmakerLiveSource;
  action: KingmakerExecutiveAction;
  deliveredCost: number;
  expectedProfit: number;
  expectedRoiPercent: number;
  recommendedOffer: number | null;
  walkAwayPrice: number | null;
  confidence: number;
  riskScore: number;
  reasons: string[];
  fingerprint: string;
};

export type KingmakerSourceHealth = {
  source: KingmakerLiveSource;
  accepted: number;
  rejected: number;
  lastObservedAt: string | null;
  status: "healthy" | "degraded" | "offline";
};

export type KingmakerCommandCenterSnapshot = {
  generatedAt: string;
  availableCapital: number;
  deployableCapital: number;
  liveOpportunities: KingmakerLiveDecision[];
  buyQueue: KingmakerLiveDecision[];
  offerQueue: KingmakerLiveDecision[];
  watchQueue: KingmakerLiveDecision[];
  researchQueue: KingmakerLiveDecision[];
  rejectedQueue: KingmakerLiveDecision[];
  sourceHealth: KingmakerSourceHealth[];
  morningIntelligence: {
    headline: string;
    topActions: KingmakerLiveDecision[];
    warnings: string[];
  };
  tcosApi: {
    version: "v1";
    generatedAt: string;
    decisionCount: number;
    snapshotFingerprint: string;
  };
  fingerprint: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function money(value: number) {
  return Number(value.toFixed(2));
}

function validHttpUrl(value?: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function evaluateKingmakerLiveObservation(input: KingmakerLiveObservation): KingmakerLiveDecision {
  const reasons: string[] = [];
  const deliveredCost = money(input.askingPrice + input.shipping + input.fees);
  const expectedProfit = money(input.marketValue - deliveredCost);
  const expectedRoiPercent = deliveredCost > 0 ? money((expectedProfit / deliveredCost) * 100) : -100;
  const confidence = clamp(input.confidence, 0, 1);
  const riskScore = clamp(input.riskScore, 0, 100);
  const sellerReliability = clamp(input.sellerReliability, 0, 100);
  const momentumScore = clamp(input.momentumScore, -100, 100);

  let action: KingmakerExecutiveAction = "reject";
  let recommendedOffer: number | null = null;
  let walkAwayPrice: number | null = null;

  if (!input.entityKey || !input.sourceRecordId) reasons.push("missing_identity");
  if (!Number.isFinite(deliveredCost) || deliveredCost <= 0) reasons.push("invalid_delivered_cost");
  if (!Number.isFinite(input.marketValue) || input.marketValue <= 0) reasons.push("invalid_market_value");
  if (!validHttpUrl(input.sourceUrl)) reasons.push("unsafe_source_url");
  if (riskScore >= 75) reasons.push("risk_above_tolerance");
  if (confidence < 0.6) reasons.push("confidence_below_action_threshold");
  if (sellerReliability < 40) reasons.push("seller_reliability_below_threshold");
  if (expectedProfit < 5) reasons.push("profit_below_floor");
  if (expectedRoiPercent < 20) reasons.push("roi_below_floor");

  const blocked = reasons.some((reason) => [
    "missing_identity",
    "invalid_delivered_cost",
    "invalid_market_value",
    "unsafe_source_url",
    "risk_above_tolerance",
  ].includes(reason));

  if (!blocked && confidence >= 0.8 && sellerReliability >= 75 && expectedProfit >= 12 && expectedRoiPercent >= 35 && momentumScore >= -10) {
    action = "buy_now";
    reasons.push("verified_high_conviction_opportunity");
  } else if (!blocked && confidence >= 0.68 && sellerReliability >= 55 && expectedProfit >= 7 && expectedRoiPercent >= 25) {
    const targetDeliveredCost = input.marketValue / 1.35;
    walkAwayPrice = money(Math.max(0, targetDeliveredCost - input.shipping - input.fees));
    recommendedOffer = money(Math.max(0, Math.min(input.askingPrice, walkAwayPrice * 0.9)));
    action = "make_offer";
    reasons.push("economics_support_negotiated_entry");
  } else if (!blocked && confidence >= 0.55 && expectedProfit > 0) {
    action = momentumScore >= 0 ? "watch" : "research";
    reasons.push(action === "watch" ? "positive_but_not_actionable" : "cooling_market_requires_research");
  }

  const canonical = {
    entityKey: input.entityKey,
    source: input.source,
    sourceRecordId: input.sourceRecordId,
    observedAt: input.observedAt,
    action,
    deliveredCost,
    expectedProfit,
    expectedRoiPercent,
    recommendedOffer,
    walkAwayPrice,
    confidence,
    riskScore,
    reasons,
  };

  return {
    entityKey: input.entityKey,
    source: input.source,
    action,
    deliveredCost,
    expectedProfit,
    expectedRoiPercent,
    recommendedOffer,
    walkAwayPrice,
    confidence,
    riskScore,
    reasons,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}

export function runKingmakerPhase5LiveExecution(input: {
  generatedAt: string;
  availableCapital: number;
  reservePercent?: number;
  observations: KingmakerLiveObservation[];
  offlineSources?: KingmakerLiveSource[];
}): KingmakerCommandCenterSnapshot {
  const reservePercent = clamp(input.reservePercent ?? 0.2, 0, 0.9);
  const deployableCapital = money(Math.max(0, input.availableCapital * (1 - reservePercent)));
  const decisions = input.observations.map(evaluateKingmakerLiveObservation)
    .sort((left, right) => {
      const priority: Record<KingmakerExecutiveAction, number> = { buy_now: 5, make_offer: 4, watch: 3, research: 2, reject: 1 };
      return priority[right.action] - priority[left.action] || right.expectedProfit - left.expectedProfit;
    });

  const sourceHealth = Array.from(new Set(input.observations.map((observation) => observation.source)))
    .map((source): KingmakerSourceHealth => {
      const rows = input.observations.filter((observation) => observation.source === source);
      const accepted = rows.filter((row) => evaluateKingmakerLiveObservation(row).action !== "reject").length;
      const rejected = rows.length - accepted;
      const offline = input.offlineSources?.includes(source) ?? false;
      return {
        source,
        accepted,
        rejected,
        lastObservedAt: rows.map((row) => row.observedAt).sort().at(-1) ?? null,
        status: offline ? "offline" : rejected > accepted ? "degraded" : "healthy",
      };
    });

  for (const source of input.offlineSources ?? []) {
    if (!sourceHealth.some((entry) => entry.source === source)) {
      sourceHealth.push({ source, accepted: 0, rejected: 0, lastObservedAt: null, status: "offline" });
    }
  }

  const warnings: string[] = [];
  if (deployableCapital <= 0) warnings.push("no_deployable_capital");
  if (sourceHealth.some((source) => source.status === "offline")) warnings.push("one_or_more_sources_offline");
  if (!decisions.some((decision) => decision.action === "buy_now" || decision.action === "make_offer")) warnings.push("no_actionable_opportunities");

  const preliminary = {
    generatedAt: input.generatedAt,
    availableCapital: money(input.availableCapital),
    deployableCapital,
    liveOpportunities: decisions,
    buyQueue: decisions.filter((decision) => decision.action === "buy_now"),
    offerQueue: decisions.filter((decision) => decision.action === "make_offer"),
    watchQueue: decisions.filter((decision) => decision.action === "watch"),
    researchQueue: decisions.filter((decision) => decision.action === "research"),
    rejectedQueue: decisions.filter((decision) => decision.action === "reject"),
    sourceHealth: sourceHealth.sort((left, right) => left.source.localeCompare(right.source)),
    morningIntelligence: {
      headline: decisions.some((decision) => decision.action === "buy_now")
        ? "KINGMAKER found immediate buy opportunities."
        : decisions.some((decision) => decision.action === "make_offer")
          ? "KINGMAKER found negotiable opportunities."
          : "KINGMAKER is monitoring the market; no immediate deployment recommended.",
      topActions: decisions.filter((decision) => decision.action === "buy_now" || decision.action === "make_offer").slice(0, 10),
      warnings,
    },
  };

  const fingerprint = createHash("sha256").update(JSON.stringify(preliminary)).digest("hex");
  return {
    ...preliminary,
    tcosApi: {
      version: "v1",
      generatedAt: input.generatedAt,
      decisionCount: decisions.length,
      snapshotFingerprint: fingerprint,
    },
    fingerprint,
  };
}
