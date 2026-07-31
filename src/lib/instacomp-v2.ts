export type InstaCompV2Stats = {
  low?: number | null;
  median?: number | null;
  average?: number | null;
  high?: number | null;
  suggestedPrice?: number | null;
};

export type InstaCompV2Comp = {
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
  soldAt?: string | null;
  listedAt?: string | null;
  observedAt?: string | null;
};

export type InstaCompV2Provider = {
  source?: string | null;
  label?: string | null;
  status?: string | null;
  results?: InstaCompV2Comp[] | null;
};

export type InstaCompV2ScanInput = {
  ai?: {
    confidence?: number | null;
    conditionGuess?: string | null;
    gradingCompany?: string | null;
    gradeValue?: string | null;
  } | null;
  stats?: InstaCompV2Stats | null;
  soldStats?: InstaCompV2Stats | null;
  soldComps?: InstaCompV2Comp[] | null;
  activeComps?: InstaCompV2Comp[] | null;
  marketValueComps?: InstaCompV2Comp[] | null;
  remainingCards?: InstaCompV2Comp[] | null;
  providers?: InstaCompV2Provider[] | null;
  sourceCoverage?: Array<{
    label?: string | null;
    status?: string | null;
    includedInMarketValue?: boolean | null;
    resultCount?: number | null;
  }> | null;
  review?: {
    trustedForPricing?: boolean | null;
    reviewReasons?: string[] | null;
    identityReviewReasons?: string[] | null;
    pricingReviewReasons?: string[] | null;
  } | null;
};

export type InstaCompV2EconomicsInput = {
  purchasePrice?: number | null;
  purchaseShipping?: number | null;
  salesTax?: number | null;
  sellingFeeRate?: number | null;
  fixedSellingFee?: number | null;
  outboundShipping?: number | null;
  supplies?: number | null;
  gradingCost?: number | null;
};

type Economics = {
  purchasePrice: number | null;
  purchaseShipping: number;
  salesTax: number;
  sellingFeeRate: number;
  fixedSellingFee: number;
  outboundShipping: number;
  supplies: number;
  gradingCost: number;
};
type Action =
  | "BUY_NOW"
  | "BUY"
  | "MAKE_OFFER"
  | "PASS"
  | "REVIEW"
  | "ENTER_BUY_PRICE"
  | "NO_MARKET_DATA";

const DEFAULTS: Economics = {
  purchasePrice: null,
  purchaseShipping: 0,
  salesTax: 0,
  sellingFeeRate: 0.1325,
  fixedSellingFee: 0.3,
  outboundShipping: 5.99,
  supplies: 0.5,
  gradingCost: 24.99,
};

const money = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 100) / 100
    : null;
};
const nonNegative = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));
const score = (value: number) => Math.round(clamp(value));
const rounded = (value: number | null) =>
  value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100) / 100;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values: number[]) =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
const dateValue = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};
const confidence = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? score(number <= 1 ? number * 100 : number) : 0;
};

function compPrice(comp: InstaCompV2Comp) {
  const displayed = money(comp.price);
  if (displayed !== null) return displayed;
  const item = money(comp.itemPrice);
  if (item === null) return null;
  return comp.priceIncludesShipping
    ? item
    : rounded(item + nonNegative(comp.shippingPrice));
}

function uniqueComps(rows: InstaCompV2Comp[]) {
  const seen = new Set<string>();
  return rows.filter((comp) => {
    const price = compPrice(comp);
    if (price === null) return false;
    if (comp.currency && String(comp.currency).toUpperCase() !== "USD") return false;
    const key = `${String(comp.url || "").toLowerCase()}|${String(comp.title || "").toLowerCase()}|${price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function gradeFromTitle(title: string | null | undefined) {
  const match = String(title || "")
    .toUpperCase()
    .match(/\b(PSA|BGS|CGC|SGC|TAG|HGA|CSG)\s*(?:GEM\s*MINT\s*|PRISTINE\s*|MINT\s*)?(10|9(?:\.5|\.0)?|8(?:\.5|\.0)?)\b/);
  return match
    ? { company: match[1], grade: Number(match[2]), label: `${match[1]} ${Number(match[2])}` }
    : null;
}

function gradeComparable(comp: InstaCompV2Comp) {
  const matchScore = Number(comp.matchScore);
  if (Number.isFinite(matchScore) && matchScore < 70) return false;
  return !(comp.flags || []).some((rawFlag) => {
    const flag = String(rawFlag).toLowerCase();
    return (
      flag.includes("mismatch") &&
      !flag.includes("grade") &&
      !flag.includes("graded") &&
      !flag.includes("slab")
    );
  });
}

function priceStats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    low: rounded(sorted[0] ?? null),
    median: rounded(median(sorted)),
    average: rounded(mean(sorted)),
    high: rounded(sorted.at(-1) ?? null),
  };
}

function maxBuy(salePrice: number | null, targetRoi: number, economics: Economics) {
  if (salePrice === null) return null;
  const proceeds =
    salePrice * (1 - economics.sellingFeeRate) -
    economics.fixedSellingFee -
    economics.outboundShipping -
    economics.supplies;
  return rounded(
    Math.max(
      0,
      proceeds / (1 + targetRoi) -
        economics.purchaseShipping -
        economics.salesTax,
    ),
  );
}

function conditionPoints(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();
  if (!normalized) return null;
  if (/gem|pristine|mint/.test(normalized)) return 80;
  if (/near mint|nm/.test(normalized)) return 55;
  if (/excellent|ex\b/.test(normalized)) return 25;
  if (/very good|good|played|poor|damaged/.test(normalized)) return 5;
  return 35;
}

function actionLabel(action: Action) {
  return {
    BUY_NOW: "BUY NOW",
    BUY: "GOOD BUY",
    MAKE_OFFER: "MAKE OFFER",
    PASS: "PASS",
    REVIEW: "VERIFY FIRST",
    ENTER_BUY_PRICE: "ENTER BUY PRICE",
    NO_MARKET_DATA: "NO MARKET DATA",
  }[action];
}

export function buildInstaCompV2Decision(
  scan: InstaCompV2ScanInput,
  input: InstaCompV2EconomicsInput = {},
  nowInput: Date | number = new Date(),
) {
  const economics: Economics = {
    purchasePrice: money(input.purchasePrice),
    purchaseShipping: nonNegative(input.purchaseShipping, DEFAULTS.purchaseShipping),
    salesTax: nonNegative(input.salesTax, DEFAULTS.salesTax),
    sellingFeeRate: clamp(
      nonNegative(input.sellingFeeRate, DEFAULTS.sellingFeeRate),
      0,
      0.5,
    ),
    fixedSellingFee: nonNegative(input.fixedSellingFee, DEFAULTS.fixedSellingFee),
    outboundShipping: nonNegative(input.outboundShipping, DEFAULTS.outboundShipping),
    supplies: nonNegative(input.supplies, DEFAULTS.supplies),
    gradingCost: nonNegative(input.gradingCost, DEFAULTS.gradingCost),
  };
  const now = nowInput instanceof Date ? nowInput.getTime() : Number(nowInput);
  const allProviderComps = (scan.providers || []).flatMap(
    (provider) => provider.results || [],
  );
  const sold = uniqueComps([
    ...(scan.soldComps || []),
    ...allProviderComps.filter((comp) => comp.sourceCategory === "sold"),
  ]);
  const market = uniqueComps([
    ...(scan.marketValueComps || []),
    ...allProviderComps.filter((comp) => comp.sourceCategory !== "sold"),
  ]);
  const active = uniqueComps([
    ...(scan.activeComps || []),
    ...(scan.remainingCards || []),
    ...market,
  ]).filter((comp) => comp.sourceCategory !== "sold");
  const subjectIsGraded = Boolean(
    scan.ai?.gradingCompany && scan.ai?.gradeValue,
  );
  const rawSold = sold.filter((comp) => !gradeFromTitle(comp.title));
  const rawMarket = market.filter((comp) => !gradeFromTitle(comp.title));
  const rawBasis = rawSold.length ? rawSold : rawMarket;
  const rawValues = rawBasis.map(compPrice).filter((value): value is number => value !== null);
  const supplied = scan.soldStats?.suggestedPrice ?? scan.stats?.suggestedPrice;
  const expectedSalePrice =
    rounded(median(rawValues)) ?? money(supplied) ?? null;
  const rawCalculated = priceStats(rawValues);
  const raw = {
    low: rawCalculated.low ?? money(scan.soldStats?.low ?? scan.stats?.low),
    median: rawCalculated.median ?? money(scan.soldStats?.median ?? scan.stats?.median),
    average: rawCalculated.average ?? money(scan.soldStats?.average ?? scan.stats?.average),
    high: rawCalculated.high ?? money(scan.soldStats?.high ?? scan.stats?.high),
    suggestedPrice: expectedSalePrice,
    sampleSize: rawValues.length,
    soldSampleSize: rawSold.length,
  };

  const graded = uniqueComps([...sold, ...market]).filter(gradeComparable);
  const gradeBuckets = new Map<string, number[]>();
  for (const comp of graded) {
    const grade = gradeFromTitle(comp.title);
    const price = compPrice(comp);
    if (!grade || price === null) continue;
    const values = gradeBuckets.get(grade.label) || [];
    values.push(price);
    gradeBuckets.set(grade.label, values);
  }
  const psa9Values = gradeBuckets.get("PSA 9") || [];
  const psa10Values = gradeBuckets.get("PSA 10") || [];
  const psa9 = rounded(median(psa9Values));
  const psa10 = rounded(median(psa10Values));
  const otherGrades = [...gradeBuckets.entries()]
    .filter(([label]) => label !== "PSA 9" && label !== "PSA 10")
    .map(([label, values]) => ({
      label,
      median: rounded(median(values)) || 0,
      sampleSize: values.length,
    }))
    .filter((row) => row.median > 0)
    .sort((a, b) => b.median - a.median);

  const datedSold = rawSold
    .map((comp) => ({ comp, date: dateValue(comp.soldAt), price: compPrice(comp) }))
    .filter((row): row is { comp: InstaCompV2Comp; date: number; price: number } =>
      row.date !== null && row.price !== null,
    );
  const days = (count: number) => count * 24 * 60 * 60 * 1000;
  const recent30 = datedSold.filter((row) => now - row.date <= days(30));
  const prior31To90 = datedSold.filter(
    (row) => now - row.date > days(30) && now - row.date <= days(90),
  );
  const sold90 = datedSold.filter((row) => now - row.date <= days(90));
  const recentMedian = rounded(median(recent30.map((row) => row.price)));
  const priorMedian = rounded(median(prior31To90.map((row) => row.price)));
  const trendChange =
    recent30.length >= 2 && prior31To90.length >= 2 && priorMedian
      ? Math.round((((recentMedian || 0) - priorMedian) / priorMedian) * 1000) / 10
      : null;
  const trendDirection =
    trendChange === null
      ? ("unknown" as const)
      : trendChange >= 5
        ? ("up" as const)
        : trendChange <= -5
          ? ("down" as const)
          : ("flat" as const);
  const activeSupply = active.length;
  const sold30Days = recent30.length;
  const sold90Days = sold90.length;
  const estimatedSalesPer30Days = datedSold.length
    ? rounded(Math.max(sold30Days, sold90Days / 3))
    : null;
  const sellThroughPercent =
    estimatedSalesPer30Days === null
      ? null
      : Math.round(
          (estimatedSalesPer30Days /
            Math.max(estimatedSalesPer30Days + activeSupply, 1)) *
            1000,
        ) / 10;
  const liquidity =
    sold30Days >= 12
      ? ("very_high" as const)
      : sold30Days >= 5
        ? ("high" as const)
        : sold30Days >= 2
          ? ("medium" as const)
          : sold90Days > 0
            ? ("low" as const)
            : ("unknown" as const);
  const liquidityScore = { very_high: 95, high: 80, medium: 60, low: 35, unknown: 15 }[liquidity];

  const identityConfidence = confidence(scan.ai?.confidence);
  const sourceLabels = new Set(
    rawBasis
      .map((comp) => String(comp.sourceLabel || comp.source || "").trim())
      .filter(Boolean),
  ).size;
  let pricingConfidence = score(
    Math.min(rawBasis.length * 8, 40) +
      Math.min(sourceLabels * 12, 24) +
      identityConfidence * 0.28 +
      (rawSold.length ? 8 : 0),
  );
  if (scan.review?.trustedForPricing === false) pricingConfidence = Math.min(pricingConfidence, 54);
  if (expectedSalePrice === null) pricingConfidence = 0;
  const reviewReasons = [
    ...(scan.review?.reviewReasons || []),
    ...(scan.review?.identityReviewReasons || []),
    ...(scan.review?.pricingReviewReasons || []),
  ];
  const trustStatus =
    expectedSalePrice === null || pricingConfidence < 40
      ? ("insufficient" as const)
      : scan.review?.trustedForPricing === false || reviewReasons.length || pricingConfidence < 70
        ? ("review" as const)
        : ("ready" as const);
  const trustReasons = [
    ...new Set([
      ...reviewReasons,
      rawBasis.length < 3 ? "Fewer than three matching raw comps." : "",
      sourceLabels < 2 ? "Pricing is not confirmed by multiple sources." : "",
      identityConfidence < 80 ? "Card identity confidence is below 80%." : "",
    ].filter(Boolean)),
  ];

  const demand = score(
    liquidityScore * 0.65 +
      (sellThroughPercent === null ? 15 : clamp(sellThroughPercent)) * 0.35,
  );
  const heat = score(
    demand * 0.55 +
      (trendDirection === "up" ? 25 : trendDirection === "down" ? 5 : 15) +
      Math.min(rawSold.length * 2, 20),
  );
  const risk = score(
    100 - pricingConfidence +
      (trustStatus === "insufficient" ? 20 : trustStatus === "review" ? 8 : 0) +
      (trendDirection === "down" ? 10 : 0) +
      (rawSold.length ? 0 : 10),
  );

  const instantBuy = maxBuy(expectedSalePrice, 0.5, economics);
  const goodBuy = maxBuy(expectedSalePrice, 0.3, economics);
  const fairBuy = maxBuy(expectedSalePrice, 0.15, economics);
  const quickSalePrice = rounded(expectedSalePrice === null ? null : expectedSalePrice * 0.9);
  const listPrice = rounded(
    expectedSalePrice === null
      ? null
      : Math.max(expectedSalePrice * 1.1, raw.high || expectedSalePrice),
  );
  const estimatedSellingFees =
    expectedSalePrice === null
      ? null
      : rounded(
          expectedSalePrice * economics.sellingFeeRate + economics.fixedSellingFee,
        );
  const netProceeds =
    expectedSalePrice === null
      ? null
      : rounded(
          expectedSalePrice -
            (estimatedSellingFees || 0) -
            economics.outboundShipping -
            economics.supplies,
        );
  const allInCost =
    economics.purchasePrice === null
      ? null
      : rounded(
          economics.purchasePrice + economics.purchaseShipping + economics.salesTax,
        );
  const projectedProfit =
    netProceeds === null || allInCost === null
      ? null
      : rounded(netProceeds - allInCost);
  const roiPercent =
    projectedProfit === null || !allInCost
      ? null
      : Math.round((projectedProfit / allInCost) * 1000) / 10;
  const marginPercent =
    projectedProfit === null || !expectedSalePrice
      ? null
      : Math.round((projectedProfit / expectedSalePrice) * 1000) / 10;

  const conditionSignal = scan.ai?.conditionGuess || null;
  const condition = conditionPoints(conditionSignal);
  const psa9Premium =
    psa9 === null || expectedSalePrice === null
      ? null
      : rounded(psa9 - expectedSalePrice - economics.gradingCost);
  const psa10Premium =
    psa10 === null || expectedSalePrice === null
      ? null
      : rounded(psa10 - expectedSalePrice - economics.gradingCost);
  const gradingScore =
    subjectIsGraded || psa10 === null || expectedSalePrice === null
      ? null
      : score(
          (condition || 20) * 0.45 +
            clamp(((psa10 - expectedSalePrice) / expectedSalePrice) * 40, 0, 40) +
            Math.min(psa10Values.length * 5, 15),
        );
  const gradingStatus = subjectIsGraded
    ? ("already_graded" as const)
    : psa9 === null && psa10 === null
      ? ("insufficient_data" as const)
      : (gradingScore || 0) >= 65 && (psa10Premium || 0) > 0
        ? ("inspect" as const)
        : ("raw_preferred" as const);
  const gradingRecommendation =
    gradingStatus === "already_graded"
      ? "This card is already graded. Use exact company-and-grade comps only."
      : gradingStatus === "insufficient_data"
        ? "Not enough matching graded sales were returned to make a grading call."
        : gradingStatus === "inspect"
          ? "Inspect centering, corners, edges, and surface closely before submitting. The premium may justify grading, but InstaComp is not claiming a grade probability."
          : "The current graded premium does not clearly beat raw sale value plus grading cost and risk.";

  const instaCompScore = score(
    pricingConfidence * 0.45 +
      heat * 0.2 +
      demand * 0.15 +
      liquidityScore * 0.15 +
      (100 - risk) * 0.05,
  );
  const opportunityScore =
    economics.purchasePrice === null || expectedSalePrice === null
      ? null
      : score(
          clamp((roiPercent || -100) + 20, 0, 55) +
            clamp(((expectedSalePrice - (allInCost || 0)) / expectedSalePrice) * 35, 0, 25) +
            pricingConfidence * 0.1 +
            heat * 0.06 +
            (100 - risk) * 0.04,
        );

  let action: Action;
  if (expectedSalePrice === null) action = "NO_MARKET_DATA";
  else if (trustStatus === "insufficient") action = "REVIEW";
  else if (economics.purchasePrice === null || allInCost === null) action = "ENTER_BUY_PRICE";
  else if (instantBuy !== null && economics.purchasePrice <= instantBuy) action = "BUY_NOW";
  else if (goodBuy !== null && economics.purchasePrice <= goodBuy) action = "BUY";
  else if (fairBuy !== null && economics.purchasePrice <= fairBuy) action = "MAKE_OFFER";
  else action = "PASS";
  if (trustStatus === "review" && ["BUY_NOW", "BUY"].includes(action)) action = "REVIEW";

  const recommendationReasons = [
    expectedSalePrice === null
      ? "No defensible market value is available yet."
      : `Expected sale value is $${expectedSalePrice.toFixed(2)} based on ${rawSold.length ? "matching sold evidence" : "current market evidence"}.`,
    economics.purchasePrice === null
      ? "Enter the listing price and buying costs to unlock profit and ROI."
      : projectedProfit === null
        ? "Profit cannot be calculated until market value is available."
        : `Projected profit is $${projectedProfit.toFixed(2)} with ${roiPercent === null ? "unknown" : `${roiPercent.toFixed(1)}%`} ROI.`,
    `${pricingConfidence}% pricing confidence with ${risk}% risk.`,
    liquidity === "unknown"
      ? "Dated sold evidence is too thin to measure sales velocity."
      : `${sold30Days} dated sale${sold30Days === 1 ? "" : "s"} in the last 30 days; liquidity is ${liquidity.replace("_", " ")}.`,
  ];
  const summary =
    action === "BUY_NOW"
      ? "The entered cost clears the aggressive 50% ROI buy line."
      : action === "BUY"
        ? "The entered cost clears the 30% ROI good-buy line."
        : action === "MAKE_OFFER"
          ? "The deal is workable, but profit protection is thin. Negotiate toward the good-buy target."
          : action === "PASS"
            ? "The entered cost is above the fair-buy ceiling after fees and shipping."
            : action === "REVIEW"
              ? "Identity or pricing evidence needs human verification before money changes hands."
              : action === "ENTER_BUY_PRICE"
                ? "Market evidence is ready. Enter the actual acquisition cost for a buy, offer, or pass call."
                : "Scan again with clearer front and back images or review broader sold results.";

  return {
    schema: "instacomp.decision.v2" as const,
    version: "2.0" as const,
    generatedAt: new Date(now).toISOString(),
    trust: {
      status: trustStatus,
      identityConfidence,
      pricingConfidence,
      label:
        trustStatus === "ready"
          ? "Pricing ready"
          : trustStatus === "review"
            ? "Verify before buying"
            : "Not enough evidence",
      reasons: trustReasons,
    },
    market: {
      basis: (rawSold.length ? "sold" : rawMarket.length ? "market" : "none") as "sold" | "market" | "none",
      raw,
      graded: {
        psa9,
        psa9SampleSize: psa9Values.length,
        psa10,
        psa10SampleSize: psa10Values.length,
        other: otherGrades,
      },
      activeSupply,
      sold30Days,
      sold90Days,
      estimatedSalesPer30Days,
      sellThroughPercent,
      trend: {
        direction: trendDirection,
        changePercent: trendChange,
        recentMedian,
        priorMedian,
        recentSampleSize: recent30.length,
        priorSampleSize: prior31To90.length,
        label:
          trendDirection === "unknown"
            ? "Not enough dated sold comps"
            : trendDirection === "up"
              ? `Up ${Math.abs(trendChange || 0).toFixed(1)}%`
              : trendDirection === "down"
                ? `Down ${Math.abs(trendChange || 0).toFixed(1)}%`
                : "Stable",
      },
      liquidity,
    },
    targets: {
      expectedSalePrice,
      quickSalePrice,
      listPrice,
      instantBuy,
      goodBuy,
      fairBuy,
      passAbove: fairBuy,
    },
    economics: {
      purchasePrice: economics.purchasePrice,
      purchaseShipping: rounded(economics.purchaseShipping) || 0,
      salesTax: rounded(economics.salesTax) || 0,
      sellingFeeRate: Math.round(economics.sellingFeeRate * 10000) / 10000,
      fixedSellingFee: rounded(economics.fixedSellingFee) || 0,
      outboundShipping: rounded(economics.outboundShipping) || 0,
      supplies: rounded(economics.supplies) || 0,
      expectedSalePrice,
      estimatedSellingFees,
      netProceeds,
      allInCost,
      projectedProfit,
      roiPercent,
      marginPercent,
    },
    scores: {
      instaComp: instaCompScore,
      opportunity: opportunityScore,
      heat,
      demand,
      liquidity: liquidityScore,
      grading: gradingScore,
      risk,
    },
    grading: {
      status: gradingStatus,
      rawValue: expectedSalePrice,
      psa9Value: psa9,
      psa10Value: psa10,
      psa9Premium,
      psa10Premium,
      conditionSignal,
      recommendation: gradingRecommendation,
    },
    recommendation: {
      action,
      label: actionLabel(action),
      headline:
        action === "BUY_NOW"
          ? "Strong flip opportunity"
          : action === "BUY"
            ? "Profitable buy zone"
            : action === "MAKE_OFFER"
              ? "Negotiate the price"
              : action === "PASS"
                ? "Protect your money"
                : action === "REVIEW"
                  ? "Evidence check required"
                  : action === "ENTER_BUY_PRICE"
                    ? "Ready for the deal math"
                    : "Market evidence is missing",
      summary,
      reasons: recommendationReasons,
    },
  };
}

export type InstaCompV2Decision = ReturnType<typeof buildInstaCompV2Decision>;
