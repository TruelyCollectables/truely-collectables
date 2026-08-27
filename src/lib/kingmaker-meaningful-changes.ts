import { createHash } from "node:crypto";

export type KingmakerSignalSnapshot = {
  entityKey: string;
  signalFingerprint: string;
  status: "candidate" | "verified" | "withheld" | "expired" | "dismissed" | "acted_on";
  score: number;
  confidence: number;
  expectedProfit: number | null;
  roiPercent: number | null;
  deliveredCost: number | null;
  marketValue: number | null;
  sellerKey?: string | null;
  sourceDiversity: number;
  observedAt: string;
};

export type KingmakerMeaningfulChange = {
  entityKey: string;
  type:
    | "new_opportunity"
    | "opportunity_lost"
    | "price_drop"
    | "market_value_rise"
    | "confidence_gain"
    | "confidence_loss"
    | "profit_gain"
    | "profit_loss"
    | "status_change"
    | "seller_change"
    | "reactivated"
    | "cooling";
  severity: "info" | "watch" | "important" | "critical";
  summary: string;
  before: number | string | null;
  after: number | string | null;
  fingerprint: string;
};

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function change(input: Omit<KingmakerMeaningfulChange, "fingerprint">): KingmakerMeaningfulChange {
  return {
    ...input,
    fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
  };
}

export function detectKingmakerMeaningfulChanges(input: {
  previous: KingmakerSignalSnapshot[];
  current: KingmakerSignalSnapshot[];
  minimumPriceMovePercent?: number;
  minimumConfidenceMove?: number;
  minimumProfitMove?: number;
}) {
  const minimumPriceMovePercent = input.minimumPriceMovePercent ?? 10;
  const minimumConfidenceMove = input.minimumConfidenceMove ?? 0.1;
  const minimumProfitMove = input.minimumProfitMove ?? 5;
  const previousByEntity = new Map(input.previous.map((snapshot) => [snapshot.entityKey, snapshot]));
  const currentByEntity = new Map(input.current.map((snapshot) => [snapshot.entityKey, snapshot]));
  const changes: KingmakerMeaningfulChange[] = [];

  for (const current of input.current) {
    const previous = previousByEntity.get(current.entityKey);
    if (!previous) {
      if (current.status === "verified") {
        changes.push(change({ entityKey: current.entityKey, type: "new_opportunity", severity: "important", summary: "New verified opportunity entered KINGMAKER.", before: null, after: current.score }));
      }
      continue;
    }

    if (previous.status !== current.status) {
      const reactivated = previous.status !== "verified" && current.status === "verified";
      changes.push(change({
        entityKey: current.entityKey,
        type: reactivated ? "reactivated" : "status_change",
        severity: current.status === "verified" ? "important" : "watch",
        summary: reactivated ? "Opportunity returned to verified status." : `Signal status changed from ${previous.status} to ${current.status}.`,
        before: previous.status,
        after: current.status,
      }));
    }

    const previousCost = finite(previous.deliveredCost);
    const currentCost = finite(current.deliveredCost);
    if (previousCost && currentCost && currentCost < previousCost) {
      const move = ((previousCost - currentCost) / previousCost) * 100;
      if (move >= minimumPriceMovePercent) {
        changes.push(change({ entityKey: current.entityKey, type: "price_drop", severity: move >= 20 ? "critical" : "important", summary: `Delivered cost dropped ${move.toFixed(1)}%.`, before: previousCost, after: currentCost }));
      }
    }

    const previousMarket = finite(previous.marketValue);
    const currentMarket = finite(current.marketValue);
    if (previousMarket && currentMarket && currentMarket > previousMarket) {
      const move = ((currentMarket - previousMarket) / previousMarket) * 100;
      if (move >= minimumPriceMovePercent) {
        changes.push(change({ entityKey: current.entityKey, type: "market_value_rise", severity: move >= 20 ? "important" : "watch", summary: `Market value increased ${move.toFixed(1)}%.`, before: previousMarket, after: currentMarket }));
      }
    }

    const confidenceMove = current.confidence - previous.confidence;
    if (Math.abs(confidenceMove) >= minimumConfidenceMove) {
      changes.push(change({ entityKey: current.entityKey, type: confidenceMove > 0 ? "confidence_gain" : "confidence_loss", severity: confidenceMove < -0.2 ? "important" : "watch", summary: `Confidence ${confidenceMove > 0 ? "improved" : "declined"} by ${Math.abs(confidenceMove).toFixed(2)}.`, before: previous.confidence, after: current.confidence }));
    }

    const previousProfit = finite(previous.expectedProfit);
    const currentProfit = finite(current.expectedProfit);
    if (previousProfit !== null && currentProfit !== null && Math.abs(currentProfit - previousProfit) >= minimumProfitMove) {
      const improved = currentProfit > previousProfit;
      changes.push(change({ entityKey: current.entityKey, type: improved ? "profit_gain" : "profit_loss", severity: improved ? "important" : "watch", summary: `Expected profit ${improved ? "increased" : "decreased"} by $${Math.abs(currentProfit - previousProfit).toFixed(2)}.`, before: previousProfit, after: currentProfit }));
    }

    if ((previous.sellerKey ?? null) !== (current.sellerKey ?? null)) {
      changes.push(change({ entityKey: current.entityKey, type: "seller_change", severity: "info", summary: "Best available seller changed.", before: previous.sellerKey ?? null, after: current.sellerKey ?? null }));
    }

    if (current.score <= previous.score - 15 || current.roiPercent !== null && previous.roiPercent !== null && current.roiPercent <= previous.roiPercent - 20) {
      changes.push(change({ entityKey: current.entityKey, type: "cooling", severity: "watch", summary: "Opportunity is materially cooling.", before: previous.score, after: current.score }));
    }
  }

  for (const previous of input.previous) {
    if (!currentByEntity.has(previous.entityKey) && previous.status === "verified") {
      changes.push(change({ entityKey: previous.entityKey, type: "opportunity_lost", severity: "important", summary: "Previously verified opportunity disappeared from the current evidence set.", before: previous.score, after: null }));
    }
  }

  return changes.sort((left, right) => {
    const weight = { critical: 4, important: 3, watch: 2, info: 1 };
    return weight[right.severity] - weight[left.severity] || left.entityKey.localeCompare(right.entityKey);
  });
}
