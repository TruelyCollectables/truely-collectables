export type ActiveMarketPackagingState = "sealed" | "opened" | "unknown";

export type ActiveMarketIntegrityResult = {
  passed: boolean;
  failures: string[];
  warnings: string[];
  checkedAt: string;
  metrics: {
    exactActiveCount: number;
    competitorArrayCount: number;
    scoutingCount: number;
    scoutingArrayCount: number;
    rejectedCount: number;
    rejectedArrayCount: number;
    selfListingConfirmed: boolean;
    trustedForPricing: boolean;
  };
};

type Json = Record<string, unknown>;

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
  return Number.isFinite(result) ? result : null;
}

function normalize(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyActiveMarketPackagingState(
  value: unknown,
): ActiveMarketPackagingState {
  const input = normalize(value);
  if (!input) return "unknown";

  // Check sealed forms first because "unripped" contains "ripped".
  if (
    /\b(unripped|un ripped|not ripped|never ripped|unopened|not opened|never opened|factory sealed|still sealed|sealed|seal intact|intact seal|still in wrapper|wrapper intact)\b/.test(
      input,
    )
  ) {
    return "sealed";
  }

  if (
    /\b(ripped|rip card|rip revealed|opened|open card|unsealed|seal broken|broken seal|cracked open|revealed|removed from sealed|removed from wrapper|pulled from wrapper)\b/.test(
      input,
    )
  ) {
    return "opened";
  }

  return "unknown";
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

function candidateIdentifiers(candidate: Json): string[] {
  return [candidate.legacyItemId, candidate.itemId, candidate.url]
    .map(text)
    .filter(Boolean);
}

function uniqueCandidates(values: Json[]): Json[] {
  const map = new Map<string, Json>();
  for (const value of values) {
    const key = candidateKey(value);
    if (!map.has(key)) map.set(key, value);
  }
  return Array.from(map.values());
}

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function sameMoney(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= 0.011;
}

export function auditActiveMarketIntegrity(input: {
  attack: unknown;
  tracking?: unknown;
  selfListingId?: string | null;
}): ActiveMarketIntegrityResult {
  const attack = record(input.attack);
  const tracking = record(input.tracking);
  const failures: string[] = [];
  const warnings: string[] = [];
  const competitors = array(attack.competitors);
  const scouts = array(attack.scoutingCandidates);
  const rejected = array(attack.packagingRejectedCandidates);
  const exactActiveCount = number(attack.exactActiveCount) ?? 0;
  const scoutingCount = number(attack.scoutingCount) ?? 0;
  const rejectedCount = number(attack.packagingRejectedCount) ?? 0;
  const targetState =
    attack.packagingState === "sealed" || attack.packagingState === "opened"
      ? (attack.packagingState as ActiveMarketPackagingState)
      : "unknown";
  const oppositeState =
    targetState === "sealed"
      ? "opened"
      : targetState === "opened"
        ? "sealed"
        : null;
  const selfListing = record(attack.selfListing);
  const selfIds = Array.from(
    new Set(
      [
        input.selfListingId,
        selfListing.legacyItemId,
        selfListing.itemId,
        selfListing.url,
      ]
        .map(text)
        .filter(Boolean),
    ),
  );
  const selfListingConfirmed = attack.selfResolved === true;
  const trustedForPricing = tracking.trustedForPricing === true;

  if (exactActiveCount !== competitors.length) {
    pushUnique(failures, "exact_active_count_does_not_match_competitor_array");
  }
  if (scoutingCount !== scouts.length) {
    pushUnique(failures, "scouting_count_does_not_match_scouting_array");
  }
  if (rejectedCount !== rejected.length) {
    pushUnique(failures, "packaging_rejected_count_does_not_match_rejected_array");
  }

  const competitorKeys = competitors.map(candidateKey);
  const scoutKeys = scouts.map(candidateKey);
  if (new Set(competitorKeys).size !== competitorKeys.length) {
    pushUnique(failures, "duplicate_competitor_candidates_present");
  }
  if (new Set(scoutKeys).size !== scoutKeys.length) {
    pushUnique(failures, "duplicate_scouting_candidates_present");
  }

  for (const candidate of competitors) {
    const title = text(candidate.title);
    const state = classifyActiveMarketPackagingState(title);
    const matchLevel = text(candidate.matchLevel || "scouting");
    const identifiers = candidateIdentifiers(candidate);

    if (candidate.directProofConfirmed !== true) {
      pushUnique(failures, "verified_competitor_missing_direct_item_proof");
    }

    if (targetState !== "unknown" && state !== targetState) {
      pushUnique(
        failures,
        state === "unknown"
          ? "unknown_packaging_candidate_used_for_pricing"
          : "opposite_packaging_candidate_used_for_pricing",
      );
    }
    if (candidate.fixedPrice === false) {
      pushUnique(failures, "auction_candidate_used_for_pricing");
    }
    if (matchLevel !== "exact" && matchLevel !== "strong") {
      pushUnique(failures, "non_verified_match_level_used_for_pricing");
    }
    if (
      selfIds.some((selfId) =>
        identifiers.some(
          (identifier) =>
            identifier.includes(selfId) || selfId.includes(identifier),
        ),
      )
    ) {
      pushUnique(failures, "seller_own_listing_present_in_competitors");
    }
  }

  for (const candidate of scouts) {
    const state = classifyActiveMarketPackagingState(candidate.title);
    const identifiers = candidateIdentifiers(candidate);
    if (oppositeState && state === oppositeState) {
      pushUnique(failures, "opposite_packaging_candidate_left_in_scouting");
    }
    if (
      selfIds.some((selfId) =>
        identifiers.some(
          (identifier) =>
            identifier.includes(selfId) || selfId.includes(identifier),
        ),
      )
    ) {
      pushUnique(failures, "seller_own_listing_present_in_scouting");
    }
  }

  const knownCompetitors = competitors
    .map((candidate) => ({ candidate, landed: number(candidate.landedPrice) }))
    .filter(
      (entry): entry is { candidate: Json; landed: number } =>
        entry.landed !== null,
    )
    .sort((left, right) => left.landed - right.landed);
  const expectedLowest = knownCompetitors[0] || null;
  const storedLowestLanded = number(attack.lowestCompetitorLanded);
  const storedLowest = record(attack.lowestCompetitor);

  if (!expectedLowest) {
    if (storedLowestLanded !== null || Object.keys(storedLowest).length > 0) {
      pushUnique(
        failures,
        "stale_lowest_competitor_present_without_landed_candidate",
      );
    }
    if (array(attack.suggestions).length > 0) {
      pushUnique(
        failures,
        "pricing_suggestions_present_without_landed_candidate",
      );
    }
    if (number(attack.gapToLowest) !== null) {
      pushUnique(
        failures,
        "stale_gap_to_lowest_present_without_landed_candidate",
      );
    }
  } else {
    if (!sameMoney(storedLowestLanded, expectedLowest.landed)) {
      pushUnique(failures, "lowest_competitor_landed_price_mismatch");
    }
    if (
      Object.keys(storedLowest).length === 0 ||
      candidateKey(storedLowest) !== candidateKey(expectedLowest.candidate)
    ) {
      pushUnique(failures, "lowest_competitor_object_mismatch");
    }
  }

  if (number(tracking.marketCompCount) !== exactActiveCount) {
    pushUnique(failures, "tracking_market_comp_count_mismatch");
  }
  if (trustedForPricing && !selfListingConfirmed) {
    pushUnique(failures, "pricing_trusted_without_confirmed_self_listing");
  }
  if (trustedForPricing && exactActiveCount === 0) {
    pushUnique(failures, "pricing_trusted_without_verified_competitor");
  }
  if (attack.marketIntegrityStatus === "complete" && !selfListingConfirmed) {
    pushUnique(
      failures,
      "market_marked_complete_without_confirmed_self_listing",
    );
  }
  if (
    exactActiveCount === 0 &&
    (number(tracking.marketPrice) !== null ||
      number(tracking.deltaAmount) !== null ||
      number(tracking.deltaPercent) !== null)
  ) {
    pushUnique(
      failures,
      "stale_market_value_or_delta_present_without_verified_competitor",
    );
  }

  const topMarketComps = array(tracking.topMarketComps);
  if (topMarketComps.length !== competitors.length) {
    pushUnique(failures, "top_market_comps_do_not_match_competitor_array");
  } else {
    const expectedKeys = uniqueCandidates(competitors).map(candidateKey).sort();
    const actualKeys = uniqueCandidates(topMarketComps).map(candidateKey).sort();
    if (expectedKeys.join("|") !== actualKeys.join("|")) {
      pushUnique(failures, "top_market_comps_content_mismatch");
    }
  }

  if (targetState === "unknown") {
    pushUnique(warnings, "target_packaging_state_unknown");
  }
  if (!selfListingConfirmed) {
    pushUnique(warnings, "seller_self_listing_not_confirmed");
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    checkedAt: new Date().toISOString(),
    metrics: {
      exactActiveCount,
      competitorArrayCount: competitors.length,
      scoutingCount,
      scoutingArrayCount: scouts.length,
      rejectedCount,
      rejectedArrayCount: rejected.length,
      selfListingConfirmed,
      trustedForPricing,
    },
  };
}
