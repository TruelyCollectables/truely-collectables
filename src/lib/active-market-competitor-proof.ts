import { classifyActiveMarketPackagingState } from "./active-market-integrity-audit";

type Json = Record<string, any>;

export type ActiveMarketDirectCompetitorProof = {
  itemId: string;
  confirmed: boolean;
  source: "browse_direct" | "shopping_direct" | "none";
  checkedAt: string;
  title: string | null;
  evidenceText: string | null;
  price: number | null;
  shippingCost: number | null;
  shippingKnown: boolean;
  shippingCostType: string | null;
  landedPrice: number | null;
  url: string | null;
  listingStatus: string | null;
  fixedPrice: boolean | null;
  failureCode: string | null;
  failureMessage: string | null;
};

export type ActiveMarketTargetIdentity = {
  player?: string | null;
  year?: string | null;
  setName?: string | null;
  parallel?: string | null;
  cardNumber?: string | null;
  printRun?: number | null;
  isAuto?: boolean;
  isRelic?: boolean;
  isGraded?: boolean;
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
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9#/+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.map((value) => text(value)).filter(Boolean)),
  );
}

function year(value: unknown): string | null {
  return normalize(value).match(/\b(?:19|20)\d{2}(?:[-/]\d{2,4})?\b/)?.[0] || null;
}

function cardNumber(value: unknown): string | null {
  return normalize(value).match(/#([a-z0-9][a-z0-9-]{0,15})\b/)?.[1] || null;
}

function printRun(value: unknown): number | null {
  const input = normalize(value);
  const match =
    input.match(/(?:\d{1,4}\s*\/\s*|\/\s*|numbered\s+(?:to|\/)?\s*)(\d{1,4})(?!\d)/) ||
    input.match(/\bof\s+(\d{1,4})(?!\d)/);
  const result = match ? Number(match[1]) : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}

function hasAuto(value: unknown): boolean {
  return /\b(auto|autograph|autographs|autographed|signed|au)\b/.test(
    normalize(value),
  );
}

function hasRelic(value: unknown): boolean {
  return /\b(relic|patch|jersey|memorabilia|swatch|game used|game worn|player worn|rpa)\b/.test(
    normalize(value),
  );
}

function hasGrade(value: unknown): boolean {
  return /\b(psa|bgs|sgc|cgc|tag|graded|gem mint|slab)\b/.test(
    normalize(value),
  );
}

function badListing(value: unknown): boolean {
  return /\b(lot of|pick your|choose your|custom|reprint|digital|break|case break|box break|team lot|player lot|facsimile|proxy|replica)\b/.test(
    normalize(value),
  );
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "card",
  "cards",
  "trading",
  "sports",
  "hockey",
  "baseball",
  "basketball",
  "football",
  "upper",
  "deck",
  "panini",
  "topps",
  "base",
  "sealed",
  "factory",
  "unopened",
  "opened",
  "open",
  "unsealed",
  "ripped",
  "unripped",
]);

function words(value: unknown): string[] {
  return normalize(value)
    .split(" ")
    .filter(
      (word) =>
        word.length > 1 && !STOP_WORDS.has(word) && !/^\d+$/.test(word),
    );
}

function containsCard(candidate: string, target: string): boolean {
  const padded = ` ${candidate} `;
  return [
    `#${target}`,
    ` ${target} `,
    `-${target} `,
    `/${target} `,
    ` card ${target} `,
    ` no ${target} `,
    ` card number ${target} `,
  ].some((needle) => padded.includes(needle));
}

export function canonicalActiveMarketProofItemId(value: unknown): string {
  const candidate = record(value);
  const legacy = text(candidate.legacyItemId);
  if (/^\d{8,}$/.test(legacy)) return legacy;
  const itemId = text(candidate.itemId);
  const browse = itemId.match(/^v1\|(\d{8,})\|/i);
  if (browse) return browse[1];
  if (/^\d{8,}$/.test(itemId)) return itemId;
  const url = text(candidate.url || candidate.itemWebUrl || candidate.viewItemURL);
  return url.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/i)?.[1] || "";
}

export function directCompetitorIdentityFailures(input: {
  targetTitle: string;
  identity: ActiveMarketTargetIdentity;
  evidenceText: string;
}): string[] {
  const candidate = normalize(input.evidenceText);
  const failures: string[] = [];
  if (!candidate) return ["direct_item_evidence_missing"];
  if (badListing(candidate)) failures.push("direct_item_excluded_listing_format");

  const playerWords = words(input.identity.player);
  if (
    playerWords.length &&
    !playerWords.every((word) => candidate.includes(word))
  ) {
    failures.push("direct_item_player_mismatch");
  }

  const targetYear = year(input.targetTitle) || text(input.identity.year) || null;
  const candidateYear = year(candidate);
  if (targetYear && candidateYear !== targetYear) {
    failures.push(
      candidateYear ? "direct_item_year_mismatch" : "direct_item_year_missing",
    );
  }

  const targetCard = normalize(
    input.identity.cardNumber || cardNumber(input.targetTitle),
  );
  const candidateCard = cardNumber(candidate);
  if (targetCard) {
    if (candidateCard && candidateCard !== targetCard) {
      failures.push("direct_item_card_number_mismatch");
    } else if (!candidateCard && !containsCard(candidate, targetCard)) {
      failures.push("direct_item_card_number_missing");
    }
  }

  const targetRun = input.identity.printRun || printRun(input.targetTitle);
  const candidateRun = printRun(candidate);
  if (targetRun !== candidateRun && (targetRun !== null || candidateRun !== null)) {
    failures.push(
      targetRun === null
        ? "direct_item_numbered_variant_conflict"
        : candidateRun === null
          ? "direct_item_print_run_missing"
          : "direct_item_print_run_mismatch",
    );
  }

  if (Boolean(input.identity.isAuto) !== hasAuto(candidate)) {
    failures.push("direct_item_autograph_state_mismatch");
  }
  if (Boolean(input.identity.isRelic) !== hasRelic(candidate)) {
    failures.push("direct_item_relic_state_mismatch");
  }
  if (Boolean(input.identity.isGraded) !== hasGrade(candidate)) {
    failures.push("direct_item_graded_raw_state_mismatch");
  }

  for (const [label, value] of [
    ["set", input.identity.setName],
    ["parallel", input.identity.parallel],
  ] as const) {
    const required = words(value);
    if (required.length && !required.some((word) => candidate.includes(word))) {
      failures.push(`direct_item_${label}_mismatch`);
    }
  }

  return uniqueStrings(failures);
}

function candidateKey(value: Json): string {
  return canonicalActiveMarketProofItemId(value) || text(value.url || value.title);
}

function dedupe(values: Json[]): Json[] {
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

export function reconcileActiveMarketDirectProofs(input: {
  attack: unknown;
  targetTitle: string;
  identity: ActiveMarketTargetIdentity;
  proofs: ActiveMarketDirectCompetitorProof[];
}) {
  const attack = record(input.attack);
  const proofById = new Map(input.proofs.map((proof) => [proof.itemId, proof]));
  const verified: Json[] = [];
  const scouts: Json[] = [...array(attack.scoutingCandidates)];
  const rejected: Json[] = [...array(attack.packagingRejectedCandidates)];
  const proofFailures: Json[] = [];
  const targetPackaging = classifyActiveMarketPackagingState(
    attack.packagingState === "sealed" || attack.packagingState === "opened"
      ? attack.packagingState
      : input.targetTitle,
  );

  for (const candidate of array(attack.competitors)) {
    const itemId = canonicalActiveMarketProofItemId(candidate);
    const proof = itemId ? proofById.get(itemId) : null;
    if (!itemId || !proof || !proof.confirmed) {
      const failureCode =
        proof?.failureCode ||
        (itemId ? "direct_item_proof_missing" : "direct_item_id_missing");
      const next = {
        ...candidate,
        matchLevel: "scouting",
        directProof: proof || null,
        directProofConfirmed: false,
        flags: uniqueStrings([
          ...(Array.isArray(candidate.flags) ? candidate.flags : []),
          failureCode,
          "direct item proof required before pricing",
        ]),
      };
      scouts.push(next);
      proofFailures.push(next);
      continue;
    }

    const proofPackaging = classifyActiveMarketPackagingState(
      proof.evidenceText || proof.title,
    );
    if (
      targetPackaging !== "unknown" &&
      proofPackaging !== "unknown" &&
      proofPackaging !== targetPackaging
    ) {
      const next = {
        ...candidate,
        title: proof.title || candidate.title,
        price: proof.price ?? candidate.price,
        shippingCost: proof.shippingCost,
        shippingKnown: proof.shippingKnown,
        shippingCostType: proof.shippingCostType,
        landedPrice: proof.landedPrice,
        url: proof.url || candidate.url,
        packagingState: proofPackaging,
        directProof: proof,
        directProofConfirmed: true,
        rejectionReason: `${proofPackaging.toUpperCase()} direct item proof conflicts with ${targetPackaging.toUpperCase()} target`,
      };
      rejected.push(next);
      proofFailures.push(next);
      continue;
    }

    const identityFailures = directCompetitorIdentityFailures({
      targetTitle: input.targetTitle,
      identity: input.identity,
      evidenceText: proof.evidenceText || proof.title || "",
    });
    if (identityFailures.length) {
      const next = {
        ...candidate,
        title: proof.title || candidate.title,
        price: proof.price ?? candidate.price,
        shippingCost: proof.shippingCost,
        shippingKnown: proof.shippingKnown,
        shippingCostType: proof.shippingCostType,
        landedPrice: proof.landedPrice,
        url: proof.url || candidate.url,
        matchLevel: "scouting",
        directProof: proof,
        directProofConfirmed: true,
        flags: uniqueStrings([
          ...(Array.isArray(candidate.flags) ? candidate.flags : []),
          ...identityFailures,
          "direct item identity proof did not pass",
        ]),
      };
      scouts.push(next);
      proofFailures.push(next);
      continue;
    }

    if (proof.fixedPrice !== true) {
      const next = {
        ...candidate,
        title: proof.title || candidate.title,
        price: proof.price ?? candidate.price,
        shippingCost: proof.shippingCost,
        shippingKnown: proof.shippingKnown,
        shippingCostType: proof.shippingCostType,
        landedPrice: proof.landedPrice,
        url: proof.url || candidate.url,
        matchLevel: "scouting",
        directProof: proof,
        directProofConfirmed: true,
        flags: uniqueStrings([
          ...(Array.isArray(candidate.flags) ? candidate.flags : []),
          "direct item is not fixed price",
        ]),
      };
      scouts.push(next);
      proofFailures.push(next);
      continue;
    }

    verified.push({
      ...candidate,
      legacyItemId: itemId,
      title: proof.title || candidate.title,
      price: proof.price ?? candidate.price,
      shippingCost: proof.shippingCost,
      shippingKnown: proof.shippingKnown,
      shippingCostType: proof.shippingCostType,
      landedPrice: proof.landedPrice,
      url: proof.url || candidate.url,
      packagingState: proofPackaging,
      directProof: proof,
      directProofConfirmed: true,
      directProofCheckedAt: proof.checkedAt,
      directProofSource: proof.source,
      flags: uniqueStrings([
        ...(Array.isArray(candidate.flags) ? candidate.flags : []),
        "direct eBay item proof confirmed",
      ]),
    });
  }

  const competitors = dedupe(verified).sort((left, right) => {
    const leftLanded = number(left.landedPrice);
    const rightLanded = number(right.landedPrice);
    if (leftLanded !== null && rightLanded !== null) return leftLanded - rightLanded;
    if (leftLanded !== null) return -1;
    if (rightLanded !== null) return 1;
    return Number(right.matchScore || 0) - Number(left.matchScore || 0);
  });
  const scoutingCandidates = dedupe(scouts)
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0))
    .slice(0, 20);
  const packagingRejectedCandidates = dedupe(rejected).slice(0, 30);
  const known = competitors.filter((candidate) => number(candidate.landedPrice) !== null);
  const lowest = known[0] || null;
  const lowestLanded = lowest ? number(lowest.landedPrice) : null;
  const ourItemPrice = Number(attack.ourItemPrice || 0);
  const ourShipping = Number(attack.ourShipping || 0);
  const ourLanded = round(ourItemPrice + ourShipping);
  const rawFloor = Number(attack.profitFloor);
  const profitFloor = Number.isFinite(rawFloor) ? rawFloor : null;
  const gap = lowestLanded === null ? null : round(ourLanded - lowestLanded);
  const position =
    lowestLanded === null
      ? competitors.length
        ? "shipping_unknown"
        : "no_verified_matches"
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

  const directConfirmedCount = competitors.length;
  const directAttemptedCount = array(attack.competitors).length;
  return {
    attack: {
      ...attack,
      schema: "truely.activeMarketAttack.v14",
      competitorDirectProofVersion: "active-market-direct-competitor-proof-v1",
      competitorDirectProofAttemptedCount: directAttemptedCount,
      competitorDirectProofConfirmedCount: directConfirmedCount,
      competitorDirectProofFailedCount: Math.max(
        0,
        directAttemptedCount - directConfirmedCount,
      ),
      competitorDirectProofs: input.proofs,
      competitorDirectProofFailures: proofFailures,
      exactActiveCount: competitors.length,
      strictExactCount: competitors.filter((candidate) => candidate.matchLevel === "exact").length,
      strongMatchCount: competitors.filter((candidate) => candidate.matchLevel === "strong").length,
      scoutingCount: scoutingCandidates.length,
      packagingExactCount: competitors.length,
      packagingUnknownCount: scoutingCandidates.filter(
        (candidate) =>
          classifyActiveMarketPackagingState(candidate.title) === "unknown",
      ).length,
      packagingRejectedCount: packagingRejectedCandidates.length,
      landedKnownCount: known.length,
      shippingUnknownCount: competitors.length - known.length,
      status: competitors.length
        ? "ready"
        : scoutingCandidates.length
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
      packagingRejectedCandidates,
    },
    proofs: input.proofs,
    proofFailures,
    directAttemptedCount,
    directConfirmedCount,
  };
}
