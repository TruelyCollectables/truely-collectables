import {
  calculateInstaCompMarketStats,
  independentVerifiedInstaCompSaleCount,
  instaCompVerifiedSalePrice,
  robustInstaCompPrices,
  uniqueInstaCompComps,
  verifiedInstaCompCompletedSales,
  type InstaCompMarketComp,
} from "./instacomp-market-evidence";

export type InstaCompV2Stats = {
  low?: number | null;
  median?: number | null;
  average?: number | null;
  high?: number | null;
  suggestedPrice?: number | null;
};

export type InstaCompV2Comp = InstaCompMarketComp;

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
  marketEvidence?: {
    verifiedSaleCount?: number | null;
    verifiedSoldComps?: InstaCompV2Comp[] | null;
    activeAsks?: InstaCompV2Comp[] | null;
    guidePrices?: InstaCompV2Comp[] | null;
    internalInventory?: InstaCompV2Comp[] | null;
    sampledMarketCounts?: boolean | null;
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

function rounded(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? null
    : Math.round(value * 100) / 100;
}

function positiveMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.round(number * 100) / 100
    : null;
}

function acquisitionMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100) / 100
    : null;
}

function nonNegative(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function score(value: number) {
  return Math.round(clamp(value));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function priceStats(values: number[]) {
  const sorted = robustInstaCompPrices(values);
  return {
    low: rounded(sorted[0] ?? null),
    median: rounded(median(sorted)),
    average: rounded(mean(sorted)),
    high: rounded(sorted.at(-1) ?? null),
    sampleSize: sorted.length,
  };
}

function confidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? score(number <= 1 ? number * 100 : number)
    : 0;
}

function dateValue(value: string | null | undefined) {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function normalizedGradeCompany(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizedGradeValue(value: unknown) {
  const match = String(value || "").match(/\b(10|[0-9](?:\.[0-9])?)\b/);
  return match ? String(Number(match[1])) : "";
}

function gradeFromTitle(title: string | null | undefined) {
  const match = String(title || "")
    .toUpperCase()
    .match(
      /\b(PSA|BGS|CGC|SGC|TAG|HGA|CSG)\s*(?:GEM\s*MINT\s*|PRISTINE\s*|MINT\s*)?(10|9(?:\.5|\.0)?|8(?:\.5|\.0)?|7(?:\.5|\.0)?|6(?:\.5|\.0)?)\b/,
    );
  return match
    ? {
        company: normalizedGradeCompany(match[1]),
        grade: normalizedGradeValue(match[2]),
        label: `${normalizedGradeCompany(match[1])} ${normalizedGradeValue(match[2])}`,
      }
    : null;
}

function subjectGradeLabel(scan: InstaCompV2ScanInput) {
  const company = normalizedGradeCompany(scan.ai?.gradingCompany);
  const grade = normalizedGradeValue(scan.ai?.gradeValue);
  return company && grade ? `${company} ${grade}` : null;
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

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function allScanComps(scan: InstaCompV2ScanInput) {
  const providerComps = (scan.providers || []).flatMap(
    (provider) => provider.results || [],
  );
  return uniqueInstaCompComps([
    ...(scan.soldComps || []),
    ...(scan.marketValueComps || []),
    ...(scan.activeComps || []),
    ...(scan.remainingCards || []),
    ...(scan.marketEvidence?.verifiedSoldComps || []),
    ...(scan.marketEvidence?.activeAsks || []),
    ...(scan.marketEvidence?.guidePrices || []),
    ...(scan.marketEvidence?.internalInventory || []),
    ...providerComps,
  ]);
}

export function buildInstaCompV2Decision(
  scan: InstaCompV2ScanInput,
  input: InstaCompV2EconomicsInput = {},
  nowInput: Date | number = new Date(),
) {
  const economics: Economics = {
    purchasePrice: acquisitionMoney(input.purchasePrice),
    purchaseShipping: nonNegative(
      input.purchaseShipping,
      DEFAULTS.purchaseShipping,
    ),
    salesTax: nonNegative(input.salesTax, DEFAULTS.salesTax),
    sellingFeeRate: clamp(
      nonNegative(input.sellingFeeRate, DEFAULTS.sellingFeeRate),
      0,
      0.5,
    ),
    fixedSellingFee: nonNegative(
      input.fixedSellingFee,
      DEFAULTS.fixedSellingFee,
    ),
    outboundShipping: nonNegative(
      input.outboundShipping,
      DEFAULTS.outboundShipping,
    ),
    supplies: nonNegative(input.supplies, DEFAULTS.supplies),
    gradingCost: nonNegative(input.gradingCost, DEFAULTS.gradingCost),
  };
  const now = nowInput instanceof Date ? nowInput.getTime() : Number(nowInput);
  const allComps = allScanComps(scan);
  const verifiedSales = verifiedInstaCompCompletedSales(allComps, now);
  const subjectGrade = subjectGradeLabel(scan);
  const subjectIsGraded = Boolean(subjectGrade);
  const rawVerifiedSales = verifiedSales.filter((comp) => !gradeFromTitle(comp.title));
  const subjectVerifiedSales = subjectIsGraded
    ? verifiedSales.filter((comp) => gradeFromTitle(comp.title)?.label === subjectGrade)
    : rawVerifiedSales;
  const independentSubjectSaleCount = independentVerifiedInstaCompSaleCount(
    subjectVerifiedSales,
    now,
  );
  const subjectPrices = robustInstaCompPrices(
    subjectVerifiedSales
      .map(instaCompVerifiedSalePrice)
      .filter((value): value is number => value !== null),
  );
  const hasTransactionBasis =
    independentSubjectSaleCount >= 2 && subjectPrices.length >= 2;
  const expectedSalePrice = hasTransactionBasis
    ? rounded(median(subjectPrices))
    : null;
  const subjectCalculated = priceStats(subjectPrices);
  const raw = {
    low: subjectCalculated.low,
    median: subjectCalculated.median,
    average: subjectCalculated.average,
    high: subjectCalculated.high,
    suggestedPrice: expectedSalePrice,
    sampleSize: subjectCalculated.sampleSize,
    soldSampleSize: subjectVerifiedSales.length,
  };

  const active = uniqueInstaCompComps(allComps).filter((comp) => {
    const category = String(comp.sourceCategory || "").toLowerCase();
    return category === "marketplace" || category === "auction" || category === "broad";
  });
  const guidePrices = uniqueInstaCompComps(allComps).filter(
    (comp) => String(comp.sourceCategory || "").toLowerCase() === "pricing",
  );
  const internalInventory = uniqueInstaCompComps(allComps).filter(
    (comp) => String(comp.source || "").toLowerCase() === "tcos_inventory",
  );
  const activeAskStats = calculateInstaCompMarketStats(active);
  const guidePriceStats = calculateInstaCompMarketStats(guidePrices);

  const gradeBuckets = new Map<string, number[]>();
  for (const comp of verifiedSales) {
    const grade = gradeFromTitle(comp.title);
    const price = instaCompVerifiedSalePrice(comp);
    if (!grade || price === null) continue;
    const values = gradeBuckets.get(grade.label) || [];
    values.push(price);
    gradeBuckets.set(grade.label, values);
  }
  const psa9Values = robustInstaCompPrices(gradeBuckets.get("PSA 9") || []);
  const psa10Values = robustInstaCompPrices(gradeBuckets.get("PSA 10") || []);
  const psa9 = rounded(median(psa9Values));
  const psa10 = rounded(median(psa10Values));
  const otherGrades = [...gradeBuckets.entries()]
    .filter(([label]) => label !== "PSA 9" && label !== "PSA 10")
    .map(([label, values]) => ({
      label,
      median: rounded(median(robustInstaCompPrices(values))) || 0,
      sampleSize: values.length,
    }))
    .filter((row) => row.median > 0)
    .sort((left, right) => right.median - left.median);

  const datedSold = subjectVerifiedSales
    .map((comp) => ({
      date: dateValue(comp.soldAt),
      price: instaCompVerifiedSalePrice(comp),
    }))
    .filter(
      (row): row is { date: number; price: number } =>
        row.date !== null && row.price !== null && row.date <= now,
    );
  const days = (count: number) => count * 24 * 60 * 60 * 1000;
  const recent30 = datedSold.filter(
    (row) => now - row.date >= 0 && now - row.date <= days(30),
  );
  const prior31To90 = datedSold.filter(
    (row) => now - row.date > days(30) && now - row.date <= days(90),
  );
  const sold90 = datedSold.filter(
    (row) => now - row.date >= 0 && now - row.date <= days(90),
  );
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
    independentSubjectSaleCount < 2
      ? ("unknown" as const)
      : sold30Days >= 12
        ? ("very_high" as const)
        : sold30Days >= 5
          ? ("high" as const)
          : sold30Days >= 2
            ? ("medium" as const)
            : sold90Days > 0
              ? ("low" as const)
              : ("unknown" as const);
  const liquidityScore = {
    very_high: 95,
    high: 80,
    medium: 60,
    low: 35,
    unknown: 15,
  }[liquidity];

  const identityConfidence = confidence(scan.ai?.confidence);
  const sourceLabels = new Set(
    subjectVerifiedSales
      .map((comp) => String(comp.sourceLabel || comp.source || "").trim())
      .filter(Boolean),
  ).size;
  const recentEvidenceCount = subjectVerifiedSales.filter((comp) => {
    const date = dateValue(comp.soldAt);
    return date !== null && date <= now && now - date <= days(180);
  }).length;
  let pricingConfidence = expectedSalePrice
    ? score(
        25 +
          Math.min(independentSubjectSaleCount * 10, 30) +
          Math.min(sourceLabels * 10, 20) +
          identityConfidence * 0.2 +
          Math.min(recentEvidenceCount * 3, 10),
      )
    : 0;

  const originalReviewReasons = Array.from(
    new Set([
      ...stringArray(scan.review?.reviewReasons),
      ...stringArray(scan.review?.identityReviewReasons),
      ...stringArray(scan.review?.pricingReviewReasons),
    ]),
  );
  const evidenceReviewReasons = [
    independentSubjectSaleCount < 2
      ? "At least two independent verified completed sales are required."
      : "",
    subjectIsGraded && independentSubjectSaleCount < 2
      ? `Exact ${subjectGrade} sold evidence is insufficient.`
      : "",
    identityConfidence < 92
      ? "Card identity confidence is below the 92% transaction threshold."
      : "",
  ].filter(Boolean);
  const reviewReasons = Array.from(
    new Set([...originalReviewReasons, ...evidenceReviewReasons]),
  );

  if (scan.review?.trustedForPricing === false) {
    pricingConfidence = Math.min(pricingConfidence, 54);
  }
  const trustStatus =
    expectedSalePrice === null
      ? ("insufficient" as const)
      : scan.review?.trustedForPricing !== true ||
          reviewReasons.length > 0 ||
          pricingConfidence < 70
        ? ("review" as const)
        : ("ready" as const);

  const demand = score(
    liquidityScore * 0.65 +
      (sellThroughPercent === null ? 15 : clamp(sellThroughPercent)) * 0.35,
  );
  const heat = score(
    demand * 0.55 +
      (trendDirection === "up" ? 25 : trendDirection === "down" ? 5 : 15) +
      Math.min(independentSubjectSaleCount * 3, 20),
  );
  const risk = score(
    100 - pricingConfidence +
      (trustStatus === "insufficient" ? 25 : trustStatus === "review" ? 12 : 0) +
      (trendDirection === "down" ? 10 : 0) +
      (independentSubjectSaleCount < 2 ? 15 : 0),
  );

  const transactionReady = trustStatus === "ready";
  const instantBuy = transactionReady
    ? maxBuy(expectedSalePrice, 0.5, economics)
    : null;
  const goodBuy = transactionReady
    ? maxBuy(expectedSalePrice, 0.3, economics)
    : null;
  const fairBuy = transactionReady
    ? maxBuy(expectedSalePrice, 0.15, economics)
    : null;
  const quickSalePrice = transactionReady
    ? rounded((expectedSalePrice || 0) * 0.9)
    : null;
  const listPrice = transactionReady
    ? rounded(
        Math.max(
          (expectedSalePrice || 0) * 1.1,
          raw.high || expectedSalePrice || 0,
        ),
      )
    : null;
  const estimatedSellingFees = transactionReady && expectedSalePrice !== null
    ? rounded(
        expectedSalePrice * economics.sellingFeeRate + economics.fixedSellingFee,
      )
    : null;
  const netProceeds = transactionReady && expectedSalePrice !== null
    ? rounded(
        expectedSalePrice -
          (estimatedSellingFees || 0) -
          economics.outboundShipping -
          economics.supplies,
      )
    : null;
  const allInCost =
    economics.purchasePrice === null
      ? null
      : rounded(
          economics.purchasePrice +
            economics.purchaseShipping +
            economics.salesTax,
        );
  const projectedProfit =
    netProceeds === null || allInCost === null
      ? null
      : rounded(netProceeds - allInCost);
  const roiPercent =
    projectedProfit === null || allInCost === null || allInCost === 0
      ? null
      : Math.round((projectedProfit / allInCost) * 1000) / 10;
  const marginPercent =
    projectedProfit === null || !expectedSalePrice
      ? null
      : Math.round((projectedProfit / expectedSalePrice) * 1000) / 10;

  const rawValuePrices = robustInstaCompPrices(
    rawVerifiedSales
      .map(instaCompVerifiedSalePrice)
      .filter((value): value is number => value !== null),
  );
  const rawValue =
    independentVerifiedInstaCompSaleCount(rawVerifiedSales, now) >= 2
      ? rounded(median(rawValuePrices))
      : null;
  const conditionSignal = scan.ai?.conditionGuess || null;
  const condition = conditionPoints(conditionSignal);
  const psa9Premium =
    psa9 === null || rawValue === null
      ? null
      : rounded(psa9 - rawValue - economics.gradingCost);
  const psa10Premium =
    psa10 === null || rawValue === null
      ? null
      : rounded(psa10 - rawValue - economics.gradingCost);
  const gradingScore =
    subjectIsGraded || psa10 === null || rawValue === null
      ? null
      : score(
          (condition || 20) * 0.45 +
            clamp(((psa10 - rawValue) / rawValue) * 40, 0, 40) +
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
      ? `This card is already graded. Transaction value requires at least two verified completed sales for exact ${subjectGrade}.`
      : gradingStatus === "insufficient_data"
        ? "Not enough verified matching graded sales were returned to make a grading call."
        : gradingStatus === "inspect"
          ? "Inspect centering, corners, edges, and surface closely before submitting. The verified sold premium may justify grading, but InstaComp is not claiming a grade probability."
          : "The verified graded premium does not clearly beat raw sale value plus grading cost and risk.";

  const instaCompScore = score(
    pricingConfidence * 0.45 +
      heat * 0.2 +
      demand * 0.15 +
      liquidityScore * 0.15 +
      (100 - risk) * 0.05,
  );
  const opportunityScore =
    !transactionReady ||
    economics.purchasePrice === null ||
    expectedSalePrice === null
      ? null
      : score(
          clamp((roiPercent ?? (allInCost === 0 ? 100 : -100)) + 20, 0, 55) +
            clamp(
              ((expectedSalePrice - (allInCost || 0)) / expectedSalePrice) * 35,
              0,
              25,
            ) +
            pricingConfidence * 0.1 +
            heat * 0.06 +
            (100 - risk) * 0.04,
        );

  let action: Action;
  if (expectedSalePrice === null) action = "NO_MARKET_DATA";
  else if (!transactionReady) action = "REVIEW";
  else if (economics.purchasePrice === null || allInCost === null) {
    action = "ENTER_BUY_PRICE";
  } else if (instantBuy !== null && economics.purchasePrice <= instantBuy) {
    action = "BUY_NOW";
  } else if (goodBuy !== null && economics.purchasePrice <= goodBuy) {
    action = "BUY";
  } else if (fairBuy !== null && economics.purchasePrice <= fairBuy) {
    action = "MAKE_OFFER";
  } else {
    action = "PASS";
  }

  const recommendationReasons = [
    expectedSalePrice === null
      ? subjectIsGraded
        ? `No defensible ${subjectGrade} transaction value is available yet.`
        : "No defensible transaction value is available yet."
      : `Expected sale value is $${expectedSalePrice.toFixed(2)} from ${independentSubjectSaleCount} independently verified completed sale${independentSubjectSaleCount === 1 ? "" : "s"}.`,
    !transactionReady
      ? "No buy, offer, pass, ROI, or auto-price call is permitted until trust is ready."
      : economics.purchasePrice === null
        ? "Enter the actual acquisition cost to unlock transaction math."
        : projectedProfit === null
          ? "Profit cannot be calculated until the transaction evidence is ready."
          : allInCost === 0
            ? `Projected profit is $${projectedProfit.toFixed(2)} on a zero-dollar acquisition; ROI is not expressed because cost basis is zero.`
            : `Projected profit is $${projectedProfit.toFixed(2)} with ${roiPercent === null ? "unknown" : `${roiPercent.toFixed(1)}%`} ROI.`,
    `${pricingConfidence}% pricing confidence with ${risk}% risk.`,
    "Active listing counts, guide prices, and internal inventory are sampled display evidence only.",
  ];
  const summary =
    action === "BUY_NOW"
      ? "The entered cost clears the aggressive 50% ROI buy line using verified completed sales only."
      : action === "BUY"
        ? "The entered cost clears the 30% ROI good-buy line using verified completed sales only."
        : action === "MAKE_OFFER"
          ? "The verified sold evidence supports a negotiation, but the price must move toward the good-buy target."
          : action === "PASS"
            ? "The entered cost is above the fair-buy ceiling after fees and shipping."
            : action === "REVIEW"
              ? "Identity or verified sold evidence needs human verification before money changes hands."
              : action === "ENTER_BUY_PRICE"
                ? "Verified sold evidence is ready. Enter the actual acquisition cost for a buy, offer, or pass call."
                : "No transaction decision is available. Current asks and guides remain display-only.";

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
            : "Not enough verified sales",
      reasons: reviewReasons,
    },
    market: {
      basis: (expectedSalePrice !== null ? "sold" : "none") as "sold" | "none",
      raw,
      transactionEvidence: {
        requiredVerifiedSales: 2,
        verifiedSaleCount: independentSubjectSaleCount,
        subjectGrade,
        outlierAdjustedSampleSize: subjectPrices.length,
      },
      activeAsk: {
        ...activeAskStats,
        sampleSize: active.length,
        sampled: true,
      },
      guide: {
        ...guidePriceStats,
        sampleSize: guidePrices.length,
        transactionEligible: false,
      },
      internalInventory: {
        sampleSize: internalInventory.length,
        transactionEligible: false,
      },
      graded: {
        psa9,
        psa9SampleSize: psa9Values.length,
        psa10,
        psa10SampleSize: psa10Values.length,
        other: otherGrades,
      },
      activeSupply,
      activeSupplyIsSample: true,
      sold30Days,
      sold90Days,
      estimatedSalesPer30Days,
      sellThroughPercent,
      sampledVelocity: true,
      trend: {
        direction: trendDirection,
        changePercent: trendChange,
        recentMedian,
        priorMedian,
        recentSampleSize: recent30.length,
        priorSampleSize: prior31To90.length,
        label:
          trendDirection === "unknown"
            ? "Not enough dated verified sales"
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
      expectedSalePrice: transactionReady ? expectedSalePrice : null,
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
      rawValue,
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
          ? "Strong verified flip opportunity"
          : action === "BUY"
            ? "Verified profitable buy zone"
            : action === "MAKE_OFFER"
              ? "Negotiate the price"
              : action === "PASS"
                ? "Protect your money"
                : action === "REVIEW"
                  ? "Evidence check required"
                  : action === "ENTER_BUY_PRICE"
                    ? "Ready for verified deal math"
                    : "Verified sold evidence is missing",
      summary,
      reasons: recommendationReasons,
    },
  };
}

export type InstaCompV2Decision = ReturnType<typeof buildInstaCompV2Decision>;
