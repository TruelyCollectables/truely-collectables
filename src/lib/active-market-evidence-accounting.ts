import { classifyActiveMarketPackagingState } from "./active-market-integrity-audit";

type Json = Record<string, unknown>;

export type ActiveMarketEvidenceDisposition =
  | "verified_pricing"
  | "scouting"
  | "packaging_rejected"
  | "identity_rejected"
  | "auction_only"
  | "self_listing"
  | "unclassified";

export type ActiveMarketEvidenceLedgerEntry = {
  id: string;
  title: string;
  url: string | null;
  price: number | null;
  shippingCost: number | null;
  landedPrice: number | null;
  disposition: ActiveMarketEvidenceDisposition;
  reasons: string[];
  packagingState: "sealed" | "opened" | "unknown";
  fixedPrice: boolean | null;
  seenInQueries: string[];
  sourceLanes: string[];
};

export type ActiveMarketEvidenceAccounting = {
  schema: "truely.activeMarketEvidenceAccounting.v1";
  passed: boolean;
  checkedAt: string;
  targetPackagingState: "sealed" | "opened" | "unknown";
  queriesAttempted: number;
  queriesSucceeded: number;
  queriesFailed: number;
  rawUniqueCandidateCount: number;
  externalCandidateCount: number;
  accountedExternalCount: number;
  counts: {
    verifiedPricing: number;
    scouting: number;
    packagingRejected: number;
    identityRejected: number;
    auctionOnly: number;
    selfListing: number;
    unclassified: number;
  };
  warnings: string[];
  failures: string[];
  summary: string;
  ledger: ActiveMarketEvidenceLedgerEntry[];
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
  return Number.isFinite(result) ? result : null;
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

function isBadListing(value: unknown): boolean {
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
  ].some((needle) => padded.includes(needle));
}

export function canonicalActiveMarketCandidateId(value: unknown): string {
  const candidate = record(value);
  const legacy = text(candidate.legacyItemId);
  if (legacy) return legacy;

  const itemId = text(candidate.itemId);
  const browseMatch = itemId.match(/^v1\|(\d+)\|/i);
  if (browseMatch) return browseMatch[1];
  if (/^\d+$/.test(itemId)) return itemId;

  const url = text(candidate.url || candidate.itemWebUrl || candidate.viewItemURL);
  const urlMatch = url.match(/\/itm\/(?:[^/]+\/)?(\d{8,})/i);
  if (urlMatch) return urlMatch[1];

  return itemId || url || normalize(candidate.title) || JSON.stringify(candidate);
}

function candidateReasons(
  candidate: Json,
  targetTitle: string,
  identity: ActiveMarketTargetIdentity,
): string[] {
  const reasons: string[] = [];
  const title = normalize(candidate.title);
  if (!title) return ["missing_listing_title"];
  if (isBadListing(title)) reasons.push("excluded_listing_format");

  const playerWords = words(identity.player);
  if (playerWords.length && !playerWords.every((word) => title.includes(word))) {
    reasons.push("player_mismatch");
  }

  const targetYear = year(targetTitle) || text(identity.year) || null;
  const candidateYear = year(title);
  if (targetYear && candidateYear && targetYear !== candidateYear) {
    reasons.push("year_mismatch");
  } else if (targetYear && !candidateYear) {
    reasons.push("missing_year_evidence");
  }

  const targetCard = normalize(identity.cardNumber || cardNumber(targetTitle));
  const candidateCard = cardNumber(title);
  if (targetCard) {
    if (candidateCard && candidateCard !== targetCard) {
      reasons.push("card_number_mismatch");
    } else if (!candidateCard && !containsCard(title, targetCard)) {
      reasons.push("missing_card_number_evidence");
    }
  }

  const targetRun = identity.printRun || printRun(targetTitle);
  const candidateRun = printRun(title);
  if (targetRun !== candidateRun && (targetRun !== null || candidateRun !== null)) {
    reasons.push(
      targetRun === null
        ? "numbered_variant_conflicts_with_unnumbered_target"
        : candidateRun === null
          ? "missing_print_run_evidence"
          : "print_run_mismatch",
    );
  }

  if (Boolean(identity.isAuto) !== hasAuto(title)) reasons.push("autograph_state_mismatch");
  if (Boolean(identity.isRelic) !== hasRelic(title)) reasons.push("relic_state_mismatch");
  if (Boolean(identity.isGraded) !== hasGrade(title)) reasons.push("graded_raw_state_mismatch");

  for (const [label, value] of [
    ["set", identity.setName],
    ["parallel", identity.parallel],
  ] as const) {
    const targetWords = words(value);
    if (targetWords.length && !targetWords.some((word) => title.includes(word))) {
      reasons.push(`${label}_mismatch`);
    }
  }

  return uniqueStrings(reasons);
}

function candidateIds(values: Json[]): Set<string> {
  return new Set(values.map(canonicalActiveMarketCandidateId));
}

function ledgerEntry(
  candidate: Json,
  disposition: ActiveMarketEvidenceDisposition,
  reasons: string[],
): ActiveMarketEvidenceLedgerEntry {
  return {
    id: canonicalActiveMarketCandidateId(candidate),
    title: text(candidate.title) || "Untitled eBay listing",
    url: text(candidate.url || candidate.itemWebUrl || candidate.viewItemURL) || null,
    price: number(candidate.price),
    shippingCost: number(candidate.shippingCost),
    landedPrice: number(candidate.landedPrice),
    disposition,
    reasons: uniqueStrings(reasons),
    packagingState: classifyActiveMarketPackagingState(candidate.title),
    fixedPrice:
      typeof candidate.fixedPrice === "boolean" ? candidate.fixedPrice : null,
    seenInQueries: uniqueStrings(
      Array.isArray(candidate.seenInQueries)
        ? candidate.seenInQueries
        : [candidate.queryUsed],
    ),
    sourceLanes: uniqueStrings(
      Array.isArray(candidate.sourceLanes)
        ? candidate.sourceLanes
        : [candidate.discoveryLane || candidate.source],
    ),
  };
}

export function buildActiveMarketEvidenceAccounting(input: {
  rawCandidates: unknown[];
  attack: unknown;
  targetTitle: string;
  identity: ActiveMarketTargetIdentity;
  selfListingIds?: string[];
  queriesAttempted: number;
  queriesSucceeded: number;
  sourceFailures?: unknown[];
}): ActiveMarketEvidenceAccounting {
  const attack = record(input.attack);
  const competitors = array(attack.competitors);
  const scouts = array(attack.scoutingCandidates);
  const packagingRejected = array(attack.packagingRejectedCandidates);
  const raw = input.rawCandidates.map(record);
  const competitorIds = candidateIds(competitors);
  const scoutIds = candidateIds(scouts);
  const packagingRejectedIds = candidateIds(packagingRejected);
  const selfIds = new Set((input.selfListingIds || []).map(text).filter(Boolean));
  const targetPackagingState = classifyActiveMarketPackagingState(
    attack.packagingState === "sealed" || attack.packagingState === "opened"
      ? attack.packagingState
      : input.targetTitle,
  );

  const universe = new Map<string, Json>();
  for (const candidate of [
    ...raw,
    ...competitors,
    ...scouts,
    ...packagingRejected,
  ]) {
    const id = canonicalActiveMarketCandidateId(candidate);
    const current = universe.get(id);
    if (!current) {
      universe.set(id, candidate);
      continue;
    }
    universe.set(id, {
      ...current,
      ...candidate,
      seenInQueries: uniqueStrings([
        ...(Array.isArray(current.seenInQueries) ? current.seenInQueries : [current.queryUsed]),
        ...(Array.isArray(candidate.seenInQueries)
          ? candidate.seenInQueries
          : [candidate.queryUsed]),
      ]),
      sourceLanes: uniqueStrings([
        ...(Array.isArray(current.sourceLanes)
          ? current.sourceLanes
          : [current.discoveryLane || current.source]),
        ...(Array.isArray(candidate.sourceLanes)
          ? candidate.sourceLanes
          : [candidate.discoveryLane || candidate.source]),
      ]),
    });
  }

  const ledger: ActiveMarketEvidenceLedgerEntry[] = [];
  for (const [id, candidate] of universe) {
    const identifiers = uniqueStrings([
      id,
      candidate.legacyItemId,
      candidate.itemId,
      candidate.url,
    ]);
    const isSelf = identifiers.some((identifier) =>
      Array.from(selfIds).some(
        (selfId) =>
          identifier === selfId ||
          identifier.includes(selfId) ||
          selfId.includes(identifier),
      ),
    );
    if (isSelf) {
      ledger.push(
        ledgerEntry(candidate, "self_listing", [
          "seller_listing_excluded_from_competitor_pricing",
        ]),
      );
      continue;
    }
    if (competitorIds.has(id)) {
      ledger.push(
        ledgerEntry(candidate, "verified_pricing", [
          ...(Array.isArray(candidate.flags) ? candidate.flags.map(text) : []),
          "passed_exact_market_rules",
        ]),
      );
      continue;
    }
    if (scoutIds.has(id)) {
      ledger.push(
        ledgerEntry(candidate, "scouting", [
          ...(Array.isArray(candidate.flags) ? candidate.flags.map(text) : []),
          "review_only_not_used_for_pricing",
        ]),
      );
      continue;
    }
    if (packagingRejectedIds.has(id)) {
      ledger.push(
        ledgerEntry(candidate, "packaging_rejected", [
          text(candidate.rejectionReason) || "packaging_state_conflict",
        ]),
      );
      continue;
    }

    const packagingState = classifyActiveMarketPackagingState(candidate.title);
    if (
      targetPackagingState !== "unknown" &&
      packagingState !== "unknown" &&
      packagingState !== targetPackagingState
    ) {
      ledger.push(
        ledgerEntry(candidate, "packaging_rejected", [
          `${packagingState}_listing_conflicts_with_${targetPackagingState}_target`,
        ]),
      );
      continue;
    }

    if (candidate.fixedPrice === false) {
      ledger.push(ledgerEntry(candidate, "auction_only", ["auction_not_used_for_pricing"]));
      continue;
    }

    const reasons = candidateReasons(candidate, input.targetTitle, input.identity);
    ledger.push(
      ledgerEntry(
        candidate,
        "identity_rejected",
        reasons.length ? reasons : ["insufficient_exact_identity_evidence"],
      ),
    );
  }

  ledger.sort((left, right) => {
    const order: Record<ActiveMarketEvidenceDisposition, number> = {
      verified_pricing: 0,
      scouting: 1,
      packaging_rejected: 2,
      identity_rejected: 3,
      auction_only: 4,
      self_listing: 5,
      unclassified: 6,
    };
    return order[left.disposition] - order[right.disposition] || left.title.localeCompare(right.title);
  });

  const counts = {
    verifiedPricing: ledger.filter((entry) => entry.disposition === "verified_pricing").length,
    scouting: ledger.filter((entry) => entry.disposition === "scouting").length,
    packagingRejected: ledger.filter((entry) => entry.disposition === "packaging_rejected").length,
    identityRejected: ledger.filter((entry) => entry.disposition === "identity_rejected").length,
    auctionOnly: ledger.filter((entry) => entry.disposition === "auction_only").length,
    selfListing: ledger.filter((entry) => entry.disposition === "self_listing").length,
    unclassified: ledger.filter((entry) => entry.disposition === "unclassified").length,
  };
  const externalCandidateCount = ledger.length - counts.selfListing;
  const accountedExternalCount =
    counts.verifiedPricing +
    counts.scouting +
    counts.packagingRejected +
    counts.identityRejected +
    counts.auctionOnly +
    counts.unclassified;
  const failures: string[] = [];
  const warnings: string[] = [];
  if (input.queriesSucceeded <= 0) failures.push("no_external_search_query_completed_successfully");
  if (counts.unclassified > 0) failures.push("unclassified_external_candidates_present");
  if (accountedExternalCount !== externalCandidateCount) {
    failures.push("external_candidate_accounting_does_not_reconcile");
  }
  if ((input.sourceFailures || []).length > 0) {
    warnings.push("one_or_more_external_search_queries_failed");
  }
  const rawIds = new Set(raw.map(canonicalActiveMarketCandidateId));
  const finalIds = uniqueStrings([
    ...competitors.map(canonicalActiveMarketCandidateId),
    ...scouts.map(canonicalActiveMarketCandidateId),
    ...packagingRejected.map(canonicalActiveMarketCandidateId),
  ]);
  if (finalIds.some((id) => !rawIds.has(id))) {
    warnings.push("final_candidates_included_from_non_finding_search_lanes");
  }

  const queriesFailed = Math.max(0, input.queriesAttempted - input.queriesSucceeded);
  const summary = `Evidence accounted: ${externalCandidateCount} external = ${counts.verifiedPricing} verified + ${counts.scouting} scouting + ${counts.packagingRejected} packaging rejected + ${counts.identityRejected} identity rejected + ${counts.auctionOnly} auction-only; ${counts.selfListing} seller listing separated.`;

  return {
    schema: "truely.activeMarketEvidenceAccounting.v1",
    passed: failures.length === 0,
    checkedAt: new Date().toISOString(),
    targetPackagingState,
    queriesAttempted: input.queriesAttempted,
    queriesSucceeded: input.queriesSucceeded,
    queriesFailed,
    rawUniqueCandidateCount: new Set(raw.map(canonicalActiveMarketCandidateId)).size,
    externalCandidateCount,
    accountedExternalCount,
    counts,
    warnings: uniqueStrings(warnings),
    failures: uniqueStrings(failures),
    summary,
    ledger,
  };
}
