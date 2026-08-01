export type InstaCompMarketComp = {
  title?: string | null;
  price?: number | null;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  priceIncludesShipping?: boolean | null;
  currency?: string | null;
  url?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  sourceCategory?: string | null;
  matchScore?: number | null;
  flags?: string[] | null;
  saleId?: string | null;
  saleVerified?: boolean | null;
  finalPriceVerified?: boolean | null;
  shippingVerified?: boolean | null;
  soldAt?: string | null;
  listedAt?: string | null;
  observedAt?: string | null;
};

export type InstaCompMarketStats = {
  low: number | null;
  median: number | null;
  average: number | null;
  high: number | null;
  suggestedPrice: number | null;
};

const EMPTY_STATS: InstaCompMarketStats = {
  low: null,
  median: null,
  average: null,
  high: null,
  suggestedPrice: null,
};

const BLOCKING_FLAG_PATTERNS = [
  "excluded",
  "guidance comp",
  "not used for pricing",
  "not exact parallel",
  "mismatch",
  "asking price only",
  "unverified sold evidence",
] as const;

function rounded(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100) / 100;
}

function positiveMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizedFlags(comp: InstaCompMarketComp) {
  return (comp.flags || []).map((flag) => String(flag).trim().toLowerCase());
}

function hasFlag(comp: InstaCompMarketComp, expected: string) {
  const target = expected.toLowerCase();
  return normalizedFlags(comp).some((flag) => flag === target);
}

function hasBlockingFlag(comp: InstaCompMarketComp) {
  return normalizedFlags(comp).some((flag) =>
    BLOCKING_FLAG_PATTERNS.some((pattern) => flag.includes(pattern)),
  );
}

export function instaCompCompletedSaleKey(comp: InstaCompMarketComp) {
  const saleId = String(comp.saleId || "").trim().toLowerCase();
  if (!saleId) return null;
  const source = String(comp.source || comp.sourceLabel || "unknown")
    .trim()
    .toLowerCase();
  return `${source}:${saleId}`;
}

export function instaCompVerifiedSalePrice(comp: InstaCompMarketComp) {
  const displayedPrice = positiveMoney(comp.price);
  const itemPrice = positiveMoney(comp.itemPrice);
  const shippingPrice = nonNegativeMoney(comp.shippingPrice);

  if (comp.priceIncludesShipping === true && displayedPrice !== null) {
    return rounded(displayedPrice);
  }

  if (itemPrice !== null && shippingPrice !== null) {
    return rounded(itemPrice + shippingPrice);
  }

  const finalPriceVerified =
    comp.finalPriceVerified === true || hasFlag(comp, "final price verified");
  const shippingVerified =
    comp.shippingVerified === true || hasFlag(comp, "shipping verified");

  if (finalPriceVerified && shippingVerified && displayedPrice !== null) {
    return rounded(displayedPrice);
  }

  return null;
}

export function isVerifiedInstaCompCompletedSale(
  comp: InstaCompMarketComp,
  nowInput: Date | number = new Date(),
) {
  if (String(comp.sourceCategory || "").toLowerCase() !== "sold") return false;
  if (hasBlockingFlag(comp)) return false;
  if (!instaCompCompletedSaleKey(comp)) return false;
  if (instaCompVerifiedSalePrice(comp) === null) return false;
  if (comp.currency && String(comp.currency).toUpperCase() !== "USD") return false;
  if (!String(comp.url || "").trim()) return false;

  const saleVerified =
    comp.saleVerified === true || hasFlag(comp, "verified completed sale");
  if (!saleVerified) return false;

  const soldAt = Date.parse(String(comp.soldAt || ""));
  const now = nowInput instanceof Date ? nowInput.getTime() : Number(nowInput);
  if (!Number.isFinite(soldAt) || !Number.isFinite(now)) return false;
  if (soldAt > now + 5 * 60 * 1000) return false;

  const matchScore = Number(comp.matchScore);
  if (Number.isFinite(matchScore) && matchScore < 70) return false;

  return true;
}

export function uniqueInstaCompComps(rows: InstaCompMarketComp[]) {
  const seen = new Set<string>();
  const unique: InstaCompMarketComp[] = [];

  for (const comp of rows) {
    const saleKey = instaCompCompletedSaleKey(comp);
    const price =
      instaCompVerifiedSalePrice(comp) ??
      positiveMoney(comp.price) ??
      positiveMoney(comp.itemPrice);
    if (price === null) continue;

    const fallbackKey = [
      String(comp.url || "").trim().toLowerCase(),
      String(comp.title || "").trim().toLowerCase(),
      rounded(price),
    ].join("|");
    const key = saleKey || fallbackKey;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(comp);
  }

  return unique;
}

export function verifiedInstaCompCompletedSales(
  rows: InstaCompMarketComp[],
  nowInput: Date | number = new Date(),
) {
  return uniqueInstaCompComps(rows).filter((comp) =>
    isVerifiedInstaCompCompletedSale(comp, nowInput),
  );
}

export function independentVerifiedInstaCompSaleCount(
  rows: InstaCompMarketComp[],
  nowInput: Date | number = new Date(),
) {
  return new Set(
    verifiedInstaCompCompletedSales(rows, nowInput)
      .map(instaCompCompletedSaleKey)
      .filter((value): value is string => Boolean(value)),
  ).size;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function robustInstaCompPrices(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (sorted.length < 4) return sorted;

  const center = median(sorted);
  if (center === null) return [];
  const deviations = sorted.map((value) => Math.abs(value - center));
  const mad = median(deviations) || 0;

  if (mad > 0) {
    const maximumDeviation = Math.max(mad * 3.5, center * 0.35);
    const filtered = sorted.filter(
      (value) => Math.abs(value - center) <= maximumDeviation,
    );
    if (filtered.length >= 2) return filtered;
  }

  const lower = sorted[Math.floor((sorted.length - 1) * 0.25)];
  const upper = sorted[Math.ceil((sorted.length - 1) * 0.75)];
  const iqr = upper - lower;
  if (iqr <= 0) return sorted;
  const minimum = lower - iqr * 1.5;
  const maximum = upper + iqr * 1.5;
  const filtered = sorted.filter((value) => value >= minimum && value <= maximum);
  return filtered.length >= 2 ? filtered : sorted;
}

export function calculateInstaCompMarketStats(
  rows: InstaCompMarketComp[],
  options: { verifiedSalesOnly?: boolean; now?: Date | number } = {},
): InstaCompMarketStats {
  const sourceRows = options.verifiedSalesOnly
    ? verifiedInstaCompCompletedSales(rows, options.now)
    : uniqueInstaCompComps(rows);
  const prices = robustInstaCompPrices(
    sourceRows
      .map((comp) =>
        options.verifiedSalesOnly
          ? instaCompVerifiedSalePrice(comp)
          : positiveMoney(comp.price) ?? positiveMoney(comp.itemPrice),
      )
      .filter((value): value is number => value !== null),
  );

  if (!prices.length) return { ...EMPTY_STATS };
  const average = prices.reduce((total, value) => total + value, 0) / prices.length;
  const middle = median(prices);

  return {
    low: rounded(prices[0]),
    median: rounded(middle),
    average: rounded(average),
    high: rounded(prices[prices.length - 1]),
    suggestedPrice: rounded(middle ?? average),
  };
}

function annotateComp(
  comp: InstaCompMarketComp,
  nowInput: Date | number,
): InstaCompMarketComp {
  const flags = new Set((comp.flags || []).map((flag) => String(flag)));
  const category = String(comp.sourceCategory || "").toLowerCase();

  if (isVerifiedInstaCompCompletedSale(comp, nowInput)) {
    flags.add("verified completed sale");
    flags.add("final price verified");
    flags.add("shipping verified");
  } else if (category === "sold") {
    flags.add("unverified sold evidence");
    flags.add("not used for pricing");
  } else if (category === "marketplace" || category === "auction" || category === "broad") {
    flags.add("asking price only");
    flags.add("not used for pricing");
  } else {
    flags.add("not used for pricing");
  }

  return { ...comp, flags: Array.from(flags) };
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function hardenInstaCompMarketPayload(
  payloadInput: Record<string, any>,
  nowInput: Date | number = new Date(),
) {
  const payload = record(payloadInput);
  const providers = array(payload.providers).map((providerValue) => {
    const provider = record(providerValue);
    return {
      ...provider,
      results: array(provider.results).map((comp) =>
        annotateComp(record(comp), nowInput),
      ),
    };
  });
  const allProviderComps = providers.flatMap((provider) => provider.results);
  const submittedComps = [
    ...array(payload.soldComps),
    ...array(payload.marketValueComps),
    ...array(payload.activeComps),
    ...array(payload.remainingCards),
  ].map((comp) => annotateComp(record(comp), nowInput));
  const allComps = uniqueInstaCompComps([...submittedComps, ...allProviderComps]);
  const verifiedSales = verifiedInstaCompCompletedSales(allComps, nowInput);
  const activeAsks = allComps.filter((comp) => {
    const category = String(comp.sourceCategory || "").toLowerCase();
    return category === "marketplace" || category === "auction" || category === "broad";
  });
  const guidePrices = allComps.filter(
    (comp) => String(comp.sourceCategory || "").toLowerCase() === "pricing",
  );
  const internalInventory = allComps.filter(
    (comp) => String(comp.source || "").toLowerCase() === "tcos_inventory",
  );
  const soldStats = calculateInstaCompMarketStats(verifiedSales, {
    verifiedSalesOnly: true,
    now: nowInput,
  });
  const verifiedSaleCount = independentVerifiedInstaCompSaleCount(
    verifiedSales,
    nowInput,
  );
  const originalReview = record(payload.review);
  const identityReviewReasons = Array.from(
    new Set(array(originalReview.identityReviewReasons).map(String).filter(Boolean)),
  );
  const pricingReviewReasons: string[] = [];

  if (!verifiedSales.length) {
    pricingReviewReasons.push("missing_verified_completed_sales");
  }
  if (verifiedSaleCount < 2) {
    pricingReviewReasons.push("insufficient_independent_verified_sales");
  }

  const reviewReasons = Array.from(
    new Set([...identityReviewReasons, ...pricingReviewReasons]),
  );
  const trustedForPricing = reviewReasons.length === 0;

  return {
    ...payload,
    providers,
    activeComps: activeAsks,
    marketValueComps: verifiedSales,
    soldComps: verifiedSales,
    soldStats,
    stats: soldStats,
    remainingCards: activeAsks,
    review: {
      ...originalReview,
      status: trustedForPricing ? "trusted_for_pricing" : "review_required",
      trustedForPricing,
      identityReviewReasons,
      pricingReviewReasons,
      reviewReasons,
    },
    sourceCoverage: array(payload.sourceCoverage).map((sourceValue) => {
      const source = record(sourceValue);
      const category = String(source.category || "").toLowerCase();
      return {
        ...source,
        includedInMarketValue:
          category === "sold" && verifiedSales.some((comp) =>
            String(comp.sourceLabel || "").toLowerCase() ===
            String(source.label || "").toLowerCase(),
          ),
      };
    }),
    marketEvidence: {
      schema: "tcos.instacomp.marketEvidence.v2",
      transactionBasis: verifiedSaleCount >= 2 ? "verified_completed_sales" : "none",
      verifiedSaleCount,
      verifiedSoldComps: verifiedSales,
      activeAskCount: activeAsks.length,
      activeAskStats: calculateInstaCompMarketStats(activeAsks),
      activeAsks,
      guidePriceCount: guidePrices.length,
      guidePriceStats: calculateInstaCompMarketStats(guidePrices),
      guidePrices,
      internalInventoryCount: internalInventory.length,
      internalInventory,
      sampledMarketCounts: true,
      generatedAt: new Date(
        nowInput instanceof Date ? nowInput.getTime() : Number(nowInput),
      ).toISOString(),
    },
    note: [
      String(payload.note || "").trim(),
      verifiedSaleCount >= 2
        ? "Transactional value is based only on independently verified completed sales with explicit final-price and shipping semantics."
        : "Current listings, guide prices, internal inventory, and unverified sold snippets are display-only. They cannot create buy, offer, pass, ROI, or auto-price decisions.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
