// InstaComp sold-market plus active-competition pricing model.
export type InstaCompPriceEvidence = {
  price: number;
  soldAt?: string | null;
};

export type InstaCompSweetSpot = {
  suggestedPrice: number;
  soldCount: number;
  activeCount: number;
  soldLow: number | null;
  soldMedian: number | null;
  soldAverage: number | null;
  soldHigh: number | null;
  activeLow: number | null;
  activeMedian: number | null;
  activeAverage: number | null;
  activeHigh: number | null;
  soldListTarget: number | null;
  competitiveTarget: number | null;
  strategy: "sold_and_active" | "sold_only" | "active_only" | "no_market";
  explanation: string;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function robustPrices(values: InstaCompPriceEvidence[]) {
  const prices = values
    .map((value) => Number(value.price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  if (prices.length < 4) return prices;
  const q1 = percentile(prices, 0.25)!;
  const q3 = percentile(prices, 0.75)!;
  const iqr = q3 - q1;
  const lowFence = Math.max(0.01, q1 - 1.5 * iqr);
  const highFence = q3 + 1.5 * iqr;
  const filtered = prices.filter((price) => price >= lowFence && price <= highFence);
  return filtered.length >= Math.ceil(prices.length / 2) ? filtered : prices;
}

function stats(values: InstaCompPriceEvidence[]) {
  const prices = robustPrices(values);
  if (!prices.length) {
    return { count: 0, low: null, median: null, average: null, high: null };
  }
  const middle = Math.floor(prices.length / 2);
  const median = prices.length % 2
    ? prices[middle]
    : (prices[middle - 1] + prices[middle]) / 2;
  return {
    count: prices.length,
    low: roundMoney(prices[0]),
    median: roundMoney(median),
    average: roundMoney(prices.reduce((sum, price) => sum + price, 0) / prices.length),
    high: roundMoney(prices[prices.length - 1]),
  };
}

function psychologicalPrice(value: number) {
  if (value < 5) return roundMoney(Math.max(0.99, Math.floor(value) + 0.99));
  if (value < 25) return roundMoney(Math.floor(value) + 0.99);
  if (value < 100) return roundMoney(Math.floor(value) + 0.99);
  return roundMoney(Math.round(value / 5) * 5 - 0.01);
}

export function calculateInstaCompSweetSpot(params: {
  sold: InstaCompPriceEvidence[];
  active: InstaCompPriceEvidence[];
}): InstaCompSweetSpot {
  const sold = stats(params.sold);
  const active = stats(params.active);

  if (sold.median !== null && active.low !== null) {
    const soldListTarget = roundMoney(sold.median * 1.1);
    const activeGuard = active.count >= 3 && active.median !== null
      ? Math.max(active.low, active.median * 0.85)
      : active.low;
    const competitiveTarget = roundMoney(activeGuard * 0.99);
    const raw = Math.max(sold.median, Math.min(soldListTarget, competitiveTarget));
    const suggestedPrice = psychologicalPrice(raw);
    return {
      suggestedPrice,
      soldCount: sold.count,
      activeCount: active.count,
      soldLow: sold.low,
      soldMedian: sold.median,
      soldAverage: sold.average,
      soldHigh: sold.high,
      activeLow: active.low,
      activeMedian: active.median,
      activeAverage: active.average,
      activeHigh: active.high,
      soldListTarget,
      competitiveTarget,
      strategy: "sold_and_active",
      explanation: `${sold.count} exact sold comps established a ${sold.median.toFixed(2)} market anchor. ${active.count} exact active listings established the current competitive band. InstaComp targeted about 10% above the sold median, then capped the recommendation against credible active competition.`,
    };
  }

  if (sold.median !== null) {
    const soldListTarget = roundMoney(sold.median * 1.1);
    return {
      suggestedPrice: psychologicalPrice(soldListTarget),
      soldCount: sold.count,
      activeCount: active.count,
      soldLow: sold.low,
      soldMedian: sold.median,
      soldAverage: sold.average,
      soldHigh: sold.high,
      activeLow: active.low,
      activeMedian: active.median,
      activeAverage: active.average,
      activeHigh: active.high,
      soldListTarget,
      competitiveTarget: null,
      strategy: "sold_only",
      explanation: `${sold.count} exact sold comps established a ${sold.median.toFixed(2)} market anchor. No reliable exact active competition was available, so InstaComp used a 10% listing cushion above sold value.`,
    };
  }

  if (active.low !== null) {
    const raw = active.count >= 3 && active.median !== null
      ? Math.min(active.median, Math.max(active.low, active.median * 0.9))
      : active.low;
    return {
      suggestedPrice: psychologicalPrice(raw),
      soldCount: sold.count,
      activeCount: active.count,
      soldLow: sold.low,
      soldMedian: sold.median,
      soldAverage: sold.average,
      soldHigh: sold.high,
      activeLow: active.low,
      activeMedian: active.median,
      activeAverage: active.average,
      activeHigh: active.high,
      soldListTarget: null,
      competitiveTarget: roundMoney(raw),
      strategy: "active_only",
      explanation: `No reliable exact sold comp was available. ${active.count} exact active listings provide a competition-only estimate, so seller review is required before publishing.`,
    };
  }

  return {
    suggestedPrice: 0,
    soldCount: 0,
    activeCount: 0,
    soldLow: null,
    soldMedian: null,
    soldAverage: null,
    soldHigh: null,
    activeLow: null,
    activeMedian: null,
    activeAverage: null,
    activeHigh: null,
    soldListTarget: null,
    competitiveTarget: null,
    strategy: "no_market",
    explanation: "No reliable exact sold comps or active competition passed verification. Seller pricing is required.",
  };
}
