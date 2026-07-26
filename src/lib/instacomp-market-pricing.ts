export type InstaCompMarketEvidence = {
  price: number;
  soldAt?: string | null;
  listedAt?: string | null;
  observedAt?: string | null;
};

type PriceStats = {
  count: number;
  usedCount: number;
  outliersRemoved: number;
  low: number | null;
  q1: number | null;
  median: number | null;
  average: number | null;
  q3: number | null;
  high: number | null;
};

export type InstaCompMarketPricing = {
  schema: "tcos.instacompMarketPricing.v1";
  strategy:
    | "seller_price_required"
    | "sold_only_market_anchor"
    | "active_competitive_sweet_spot"
    | "active_market_compression"
    | "single_active_outlier_guard"
    | "sold_value_below_active_market";
  confidence: "low" | "medium" | "high";
  suggestedPrice: number;
  marketValue: number;
  quickSalePrice: number;
  stretchPrice: number;
  activeInfluenceApplied: boolean;
  sold: PriceStats & {
    recencyWeightedMedian: number | null;
  };
  active: PriceStats & {
    competitiveEntryPrice: number | null;
    competitiveTargetPrice: number | null;
  };
  rationale: string[];
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function positivePrice(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : null;
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const remainder = position - base;
  const next = sorted[base + 1];
  return roundMoney(next === undefined ? sorted[base] : sorted[base] + remainder * (next - sorted[base]));
}

function summarize(prices: number[], originalCount = prices.length): PriceStats {
  const sorted = [...prices].sort((left, right) => left - right);
  if (!sorted.length) {
    return {
      count: originalCount,
      usedCount: 0,
      outliersRemoved: originalCount,
      low: null,
      q1: null,
      median: null,
      average: null,
      q3: null,
      high: null,
    };
  }
  const average = sorted.reduce((sum, price) => sum + price, 0) / sorted.length;
  return {
    count: originalCount,
    usedCount: sorted.length,
    outliersRemoved: Math.max(0, originalCount - sorted.length),
    low: roundMoney(sorted[0]),
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    average: roundMoney(average),
    q3: quantile(sorted, 0.75),
    high: roundMoney(sorted[sorted.length - 1]),
  };
}

function removeOutliers<T extends InstaCompMarketEvidence>(rows: T[]) {
  const valid = rows
    .map((row) => ({ ...row, price: positivePrice(row.price) || 0 }))
    .filter((row) => row.price > 0);
  if (valid.length < 4) return valid;
  const sorted = valid.map((row) => row.price).sort((left, right) => left - right);
  const q1 = quantile(sorted, 0.25) || sorted[0];
  const q3 = quantile(sorted, 0.75) || sorted[sorted.length - 1];
  const iqr = q3 - q1;
  if (iqr <= 0) return valid;
  const lowFence = Math.max(0.01, q1 - 1.5 * iqr);
  const highFence = q3 + 1.5 * iqr;
  const filtered = valid.filter((row) => row.price >= lowFence && row.price <= highFence);
  return filtered.length >= Math.min(3, valid.length) ? filtered : valid;
}

function evidenceDate(row: InstaCompMarketEvidence) {
  const value = row.soldAt || row.listedAt || row.observedAt;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function recencyWeight(row: InstaCompMarketEvidence, now: Date) {
  const date = evidenceDate(row);
  if (!date) return 1;
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  if (ageDays <= 30) return 1.5;
  if (ageDays <= 90) return 1.25;
  if (ageDays <= 180) return 1;
  return 0.75;
}

function weightedMedian(rows: InstaCompMarketEvidence[], now: Date) {
  if (!rows.length) return null;
  const weighted = rows
    .map((row) => ({ price: row.price, weight: recencyWeight(row, now) }))
    .sort((left, right) => left.price - right.price);
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0);
  let running = 0;
  for (const row of weighted) {
    running += row.weight;
    if (running >= totalWeight / 2) return roundMoney(row.price);
  }
  return roundMoney(weighted[weighted.length - 1].price);
}

function undercutTick(price: number) {
  if (price < 10) return 0.01;
  if (price < 50) return 0.05;
  if (price < 100) return 0.25;
  if (price < 500) return 1;
  return 5;
}

function marketEnding(value: number, ceiling?: number | null) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = value < 20 ? 0.25 : value < 100 ? 0.5 : value < 500 ? 1 : 5;
  const nearest = Math.max(0.01, Math.round((value + 0.01) / step) * step - 0.01);
  if (!ceiling || nearest <= ceiling + 0.0001) return roundMoney(nearest);
  const below = Math.max(0.01, Math.floor((ceiling + 0.01) / step) * step - 0.01);
  return roundMoney(below);
}

function confidenceLevel(soldCount: number, activeCount: number) {
  if (soldCount >= 8 && activeCount >= 3) return "high" as const;
  if (soldCount >= 4 || (soldCount >= 3 && activeCount >= 2)) return "medium" as const;
  return "low" as const;
}

export function calculateInstaCompMarketPricing(params: {
  sold: InstaCompMarketEvidence[];
  active: InstaCompMarketEvidence[];
  now?: Date;
}): InstaCompMarketPricing {
  const now = params.now || new Date();
  const rawSold = params.sold.filter((row) => positivePrice(row.price));
  const rawActive = params.active.filter((row) => positivePrice(row.price));
  const soldRows = removeOutliers(rawSold);
  const activeRows = removeOutliers(rawActive);
  const soldStats = summarize(
    soldRows.map((row) => row.price),
    rawSold.length,
  );
  const activeStats = summarize(
    activeRows.map((row) => row.price),
    rawActive.length,
  );
  const soldAnchor = weightedMedian(soldRows, now) || soldStats.median || 0;
  const soldQ1 = soldStats.q1 || soldAnchor;
  const soldQ3 = soldStats.q3 || soldAnchor;
  const soldListTarget = soldAnchor + Math.max(0, soldQ3 - soldAnchor) * 0.75;
  const quickSale = Math.max(soldQ1 || soldAnchor, soldAnchor * 0.85);
  const stretch = Math.max(soldQ3 || soldAnchor, soldAnchor * 1.25);
  const activeEntry =
    activeRows.length >= 3
      ? activeStats.q1 || activeStats.low
      : activeStats.low;
  const activeTarget = activeEntry
    ? Math.max(0.01, activeEntry - undercutTick(activeEntry))
    : null;

  if (!soldAnchor || soldRows.length === 0) {
    return {
      schema: "tcos.instacompMarketPricing.v1",
      strategy: "seller_price_required",
      confidence: "low",
      suggestedPrice: 0,
      marketValue: 0,
      quickSalePrice: 0,
      stretchPrice: 0,
      activeInfluenceApplied: false,
      sold: { ...soldStats, recencyWeightedMedian: null },
      active: {
        ...activeStats,
        competitiveEntryPrice: activeEntry ? roundMoney(activeEntry) : null,
        competitiveTargetPrice: activeTarget ? roundMoney(activeTarget) : null,
      },
      rationale: [
        "No accepted exact sold comp survived identity and outlier checks, so TCOS will not invent a market value.",
        activeRows.length
          ? `${activeRows.length} exact active listing${activeRows.length === 1 ? " is" : "s are"} shown as competition, but active asking prices alone cannot prove value.`
          : "No exact active competition was available either.",
      ],
    };
  }

  let strategy: InstaCompMarketPricing["strategy"] = "sold_only_market_anchor";
  let rawSuggestion = soldListTarget;
  let activeInfluenceApplied = false;
  const rationale = [
    `${soldRows.length} of ${rawSold.length} exact sold comp${rawSold.length === 1 ? "" : "s"} were used after outlier control.`,
    `Recent sales produced a ${roundMoney(soldAnchor).toFixed(2)} market-value anchor; the sold fair range is ${roundMoney(soldQ1).toFixed(2)} to ${roundMoney(soldQ3).toFixed(2)}.`,
  ];

  if (activeTarget && activeEntry) {
    activeInfluenceApplied = true;
    if (activeRows.length === 1 && activeTarget < soldQ1 * 0.9) {
      strategy = "single_active_outlier_guard";
      rawSuggestion = quickSale;
      rationale.push(
        `The lone active listing at ${roundMoney(activeEntry).toFixed(2)} sits materially below the sold fair range, so TCOS did not chase one possible underpriced outlier.`,
      );
    } else {
      rawSuggestion = Math.min(soldListTarget, activeTarget);
      if (activeTarget < soldQ1) {
        strategy = "active_market_compression";
        rationale.push(
          `Exact active competition is below the historical sold fair range, so the suggestion follows the competitive market instead of pretending the older sales still control.`,
        );
      } else if (activeTarget > soldListTarget) {
        strategy = "sold_value_below_active_market";
        rationale.push(
          `Active sellers are asking above proven sold value, so TCOS stays near the sold market rather than copying optimistic asks.`,
        );
      } else {
        strategy = "active_competitive_sweet_spot";
        rationale.push(
          `The suggestion is positioned just below the lower competitive tier while remaining inside the sold fair-value range.`,
        );
      }
    }
  } else {
    rationale.push(
      "No exact active listing was available, so the suggestion uses the recency-weighted sold market and leaves modest room above the market-value anchor.",
    );
  }

  const competitiveCeiling =
    strategy === "single_active_outlier_guard" ? null : activeTarget;
  const suggestedPrice = marketEnding(rawSuggestion, competitiveCeiling);
  const marketValue = marketEnding(soldAnchor);
  const quickSalePrice = marketEnding(quickSale);
  const stretchPrice = marketEnding(stretch);
  rationale.push(
    `Final positions: quick sale ${quickSalePrice.toFixed(2)}, market value ${marketValue.toFixed(2)}, suggested list ${suggestedPrice.toFixed(2)}, stretch ${stretchPrice.toFixed(2)}.`,
  );

  return {
    schema: "tcos.instacompMarketPricing.v1",
    strategy,
    confidence: confidenceLevel(soldRows.length, activeRows.length),
    suggestedPrice,
    marketValue,
    quickSalePrice,
    stretchPrice,
    activeInfluenceApplied,
    sold: {
      ...soldStats,
      recencyWeightedMedian: roundMoney(soldAnchor),
    },
    active: {
      ...activeStats,
      competitiveEntryPrice: activeEntry ? roundMoney(activeEntry) : null,
      competitiveTargetPrice: activeTarget ? roundMoney(activeTarget) : null,
    },
    rationale,
  };
}
