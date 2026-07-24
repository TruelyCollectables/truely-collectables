export type ActiveMarketConsensusLevel =
  | "no_verified_prices"
  | "single_seller"
  | "two_seller_limited"
  | "three_plus_strong"
  | "wide_spread_blocked";

type Json = Record<string, any>;

export type ActiveMarketConsensusResult = {
  attack: Json;
  passed: boolean;
  level: ActiveMarketConsensusLevel;
  independentSellerCount: number;
  medianLandedPrice: number | null;
  spreadPercent: number | null;
  duplicateSellerCount: number;
  outlierCount: number;
  excludedCount: number;
};

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function array(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : null;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalize(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => text(value)).filter(Boolean)),
  );
}

function candidateKey(candidate: Json): string {
  return text(
    candidate.legacyItemId ||
      candidate.itemId ||
      candidate.url ||
      candidate.title ||
      JSON.stringify(candidate),
  );
}

function uniqueCandidates(values: Json[]): Json[] {
  const map = new Map<string, Json>();
  for (const value of values) {
    const key = candidateKey(value);
    const current = map.get(key);
    if (!current || Number(value.matchScore || 0) > Number(current.matchScore || 0)) {
      map.set(key, value);
    }
  }
  return Array.from(map.values());
}

function sellerName(candidate: Json): string | null {
  const directProof = record(candidate.directProof);
  const result = text(
    candidate.sellerUsername ||
      candidate.sellerUserName ||
      record(candidate.seller).username ||
      directProof.sellerUsername,
  );
  return result || null;
}

function sellerKey(candidate: Json): string | null {
  const result = sellerName(candidate);
  return result ? normalize(result) : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : round((sorted[middle - 1] + sorted[middle]) / 2);
}

function charm(maximum: number): number {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, round(Math.floor(maximum - 0.99) + 0.99));
}

function strategy(
  key: string,
  label: string,
  targetLanded: number,
  shipping: number,
  profitFloor: number | null,
) {
  const itemPrice = charm(Math.max(0.99, targetLanded - shipping));
  return {
    key,
    label,
    itemPrice,
    shipping,
    landedPrice: round(itemPrice + shipping),
    profitFloor,
    meetsProfitFloor: profitFloor === null ? null : itemPrice >= profitFloor,
  };
}

function scoutingCandidate(candidate: Json, reasons: string[]): Json {
  return {
    ...candidate,
    matchLevel: "scouting",
    marketConsensusEligible: false,
    marketConsensusReasons: uniqueStrings(reasons),
    flags: uniqueStrings([
      ...(Array.isArray(candidate.flags) ? candidate.flags : []),
      ...reasons,
      "excluded from market consensus pricing",
    ]),
  };
}

function outlierReason(input: {
  landedPrice: number;
  medianPrice: number;
  mad: number;
}): string | null {
  const { landedPrice, medianPrice, mad } = input;
  if (medianPrice <= 0) return null;
  const modifiedZ = mad > 0
    ? (0.6745 * Math.abs(landedPrice - medianPrice)) / mad
    : 0;
  if (landedPrice < medianPrice * 0.7 && modifiedZ > 3.5) {
    return "isolated low-price outlier";
  }
  if (landedPrice > medianPrice * 1.6 && modifiedZ > 3.5) {
    return "isolated high-price outlier";
  }
  return null;
}

export function applyActiveMarketConsensus(input: {
  attack: unknown;
}): ActiveMarketConsensusResult {
  const attack = record(input.attack);
  const originalCompetitors = uniqueCandidates(array(attack.competitors));
  const scouts = [...array(attack.scoutingCandidates)];
  const excluded: Json[] = [];
  const sellerGroups = new Map<string, Json[]>();

  for (const candidate of originalCompetitors) {
    const landedPrice = number(candidate.landedPrice);
    if (landedPrice === null) {
      const next = scoutingCandidate(candidate, [
        "shipping or landed price is unknown",
        "landed price is required for market consensus",
      ]);
      scouts.push(next);
      excluded.push(next);
      continue;
    }

    const key = sellerKey(candidate);
    if (!key) {
      const next = scoutingCandidate(candidate, [
        "seller identity is unavailable",
        "independent seller evidence cannot be established",
      ]);
      scouts.push(next);
      excluded.push(next);
      continue;
    }

    sellerGroups.set(key, [...(sellerGroups.get(key) || []), candidate]);
  }

  const representatives: Json[] = [];
  let duplicateSellerCount = 0;
  for (const [key, values] of sellerGroups.entries()) {
    const sorted = [...values].sort(
      (left, right) =>
        Number(left.landedPrice || Number.MAX_SAFE_INTEGER) -
        Number(right.landedPrice || Number.MAX_SAFE_INTEGER),
    );
    const representative = sorted[0];
    representatives.push({
      ...representative,
      sellerUsername: sellerName(representative),
      marketConsensusSellerKey: key,
    });
    for (const duplicate of sorted.slice(1)) {
      duplicateSellerCount += 1;
      const next = scoutingCandidate(duplicate, [
        `duplicate listing from seller ${sellerName(duplicate) || key}`,
        "only one listing per seller may influence market consensus",
      ]);
      scouts.push(next);
      excluded.push(next);
    }
  }

  const representativePrices = representatives
    .map((candidate) => number(candidate.landedPrice))
    .filter((value): value is number => value !== null);
  const initialMedian = median(representativePrices);
  const deviations = initialMedian === null
    ? []
    : representativePrices.map((price) => Math.abs(price - initialMedian));
  const mad = median(deviations) || 0;
  const inliers: Json[] = [];
  let outlierCount = 0;

  for (const candidate of representatives) {
    const landedPrice = number(candidate.landedPrice);
    const reason =
      landedPrice !== null && initialMedian !== null && representatives.length >= 3
        ? outlierReason({ landedPrice, medianPrice: initialMedian, mad })
        : null;
    if (reason) {
      outlierCount += 1;
      const next = scoutingCandidate(candidate, [reason]);
      scouts.push(next);
      excluded.push(next);
    } else {
      inliers.push({
        ...candidate,
        marketConsensusEligible: true,
        marketConsensusReasons: [],
      });
    }
  }

  const competitors = uniqueCandidates(inliers).sort(
    (left, right) => Number(left.landedPrice) - Number(right.landedPrice),
  );
  const prices = competitors
    .map((candidate) => number(candidate.landedPrice))
    .filter((value): value is number => value !== null);
  const medianLandedPrice = median(prices);
  const minimum = prices.length ? Math.min(...prices) : null;
  const maximum = prices.length ? Math.max(...prices) : null;
  const spreadPercent =
    medianLandedPrice !== null && minimum !== null && maximum !== null && medianLandedPrice > 0
      ? round(((maximum - minimum) / medianLandedPrice) * 100)
      : null;
  const independentSellerCount = competitors.length;

  let level: ActiveMarketConsensusLevel = "no_verified_prices";
  let passed = false;
  if (independentSellerCount === 1) {
    level = "single_seller";
  } else if (independentSellerCount === 2) {
    if ((spreadPercent ?? Number.POSITIVE_INFINITY) <= 35) {
      level = "two_seller_limited";
      passed = true;
    } else {
      level = "wide_spread_blocked";
    }
  } else if (independentSellerCount >= 3) {
    if ((spreadPercent ?? Number.POSITIVE_INFINITY) <= 75) {
      level = "three_plus_strong";
      passed = true;
    } else {
      level = "wide_spread_blocked";
    }
  }

  const lowest = passed ? competitors[0] || null : null;
  const lowestLanded = lowest ? number(lowest.landedPrice) : null;
  const ourItemPrice = Number(attack.ourItemPrice || 0);
  const ourShipping = Number(attack.ourShipping || 0);
  const ourLanded = round(ourItemPrice + ourShipping);
  const rawFloor = Number(attack.profitFloor);
  const profitFloor = Number.isFinite(rawFloor) ? rawFloor : null;
  const gap = lowestLanded === null ? null : round(ourLanded - lowestLanded);
  const position =
    !passed
      ? "consensus_blocked"
      : lowestLanded === null
        ? "shipping_unknown"
        : ourLanded < lowestLanded
          ? "best_deal"
          : ourLanded <= lowestLanded + 1
            ? "within_striking_distance"
            : "over_market";
  const suggestions =
    lowestLanded === null
      ? []
      : [
          strategy("beat_by_cent", "Beat by $0.01", lowestLanded - 0.01, ourShipping, profitFloor),
          strategy("beat_by_dollar", "Beat by $1", lowestLanded - 1, ourShipping, profitFloor),
          strategy("undercut_5", "5% lower landed", lowestLanded * 0.95, ourShipping, profitFloor),
          strategy("undercut_10", "10% lower landed — King Price", lowestLanded * 0.9, ourShipping, profitFloor),
          strategy("undercut_15", "15% lower landed — Aggressive", lowestLanded * 0.85, ourShipping, profitFloor),
        ];

  const scoutingCandidates = uniqueCandidates(scouts)
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0))
    .slice(0, 30);
  const excludedCandidates = uniqueCandidates(excluded).slice(0, 40);
  const summary = passed
    ? `${independentSellerCount} independent sellers established ${level === "three_plus_strong" ? "strong" : "limited"} market consensus.`
    : independentSellerCount === 1
      ? "Only one independent seller remains; pricing is guidance-only."
      : independentSellerCount === 0
        ? "No directly proved listing has both a known seller and landed price."
        : `Independent seller prices are too widely spread (${spreadPercent ?? 0}%).`;

  return {
    attack: {
      ...attack,
      schema: "truely.activeMarketAttack.v15",
      marketConsensusVersion: "active-market-consensus-v1",
      marketConsensusPassed: passed,
      marketConsensusLevel: level,
      marketConsensusSummary: summary,
      marketConsensusIndependentSellerCount: independentSellerCount,
      marketConsensusMedianLandedPrice: medianLandedPrice,
      marketConsensusSpreadPercent: spreadPercent,
      marketConsensusDuplicateSellerCount: duplicateSellerCount,
      marketConsensusOutlierCount: outlierCount,
      marketConsensusExcludedCount: excludedCandidates.length,
      marketConsensusExcludedCandidates: excludedCandidates,
      exactActiveCount: competitors.length,
      strictExactCount: competitors.filter((candidate) => candidate.matchLevel === "exact").length,
      strongMatchCount: competitors.filter((candidate) => candidate.matchLevel === "strong").length,
      scoutingCount: scoutingCandidates.length,
      landedKnownCount: competitors.length,
      shippingUnknownCount: 0,
      status: passed
        ? "ready"
        : competitors.length || scoutingCandidates.length
          ? "scouting_only"
          : "no_candidates",
      lowestCompetitor: lowest,
      lowestCompetitorLanded: lowestLanded,
      ourLanded,
      gapToLowest: gap,
      position,
      suggestions,
      competitors,
      scoutingCandidates,
    },
    passed,
    level,
    independentSellerCount,
    medianLandedPrice,
    spreadPercent,
    duplicateSellerCount,
    outlierCount,
    excludedCount: excludedCandidates.length,
  };
}
