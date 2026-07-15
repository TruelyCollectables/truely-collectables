export type InstaCompCatalogIdentityInput = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  variation?: string | null;
  serialNumber?: string | null;
  serialRun?: string | null;
  team?: string | null;
  sport?: string | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
};

export type InstaCompCatalogCandidate = {
  catalogId: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceUsageAllowed: boolean;
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  variation?: string | null;
  serialRun?: string | null;
  team?: string | null;
  sport?: string | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
};

export type InstaCompCatalogVariationCoverage = {
  baseCards: boolean;
  parallels: boolean;
  refractors: boolean;
  shortPrints: boolean;
  imageVariations: boolean;
  autographs: boolean;
  relics: boolean;
  serialNumberedRuns: boolean;
};

export type InstaCompCatalogSourcePolicy = {
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  apiAvailable: boolean;
  sourceUsageAllowed: boolean;
  commercialUseAllowed: boolean;
  storageAllowed: boolean;
  displayAllowed: boolean;
  cachingAllowed: boolean;
  attributionRequired: boolean;
  termsReviewedAt?: string | null;
  variationCoverage: InstaCompCatalogVariationCoverage;
};

export type InstaCompCatalogSourcePolicyResult = {
  source: InstaCompCatalogSourcePolicy;
  status: "approved" | "rejected";
  reasons: string[];
};

export type InstaCompCatalogLookupPlan = {
  status: "ready" | "review_required";
  catalogBeforeCompsRequired: true;
  compSearchBlockedUntilCatalogResolved: true;
  queryIdentity: InstaCompCatalogIdentityInput;
  queryHints: string[];
  approvedSources: InstaCompCatalogSourcePolicyResult[];
  rejectedSources: InstaCompCatalogSourcePolicyResult[];
  reviewReasons: string[];
};

export type InstaCompCatalogCandidateIdentity = Omit<
  InstaCompCatalogCandidate,
  "source" | "sourceLabel" | "sourceUrl" | "sourceUsageAllowed"
> & {
  sourceUrl?: string | null;
};

export type InstaCompCatalogCandidateScore = {
  candidate: InstaCompCatalogCandidate;
  score: number;
  matchedEvidence: string[];
  mismatchedEvidence: string[];
  missingEvidence: string[];
  criticalMismatch: boolean;
  sourceAllowed: boolean;
};

export type InstaCompCatalogIdentityResolution = {
  status: "catalog_confirmed" | "review_required";
  selectedMatch: InstaCompCatalogCandidateScore | null;
  alternateMatches: InstaCompCatalogCandidateScore[];
  reviewReasons: string[];
  suggestedQuestion: string | null;
  matchExplanation: string;
};

export type InstaCompCatalogCompIdentity = InstaCompCatalogIdentityInput & {
  catalogId: string;
  catalogSource: string;
  catalogSourceLabel: string;
  catalogSourceUrl: string;
  catalogMatchExplanation: string;
};

export type InstaCompCatalogCompGate = {
  status: "catalog_confirmed" | "review_required";
  exactCompSearchAllowed: boolean;
  trustedForExactComps: boolean;
  compIdentity: InstaCompCatalogCompIdentity | null;
  fallbackInput: InstaCompCatalogIdentityInput;
  reviewReasons: string[];
  suggestedQuestion: string | null;
  resolution: InstaCompCatalogIdentityResolution;
};

const FIELD_WEIGHTS = {
  player: 20,
  year: 14,
  brand: 10,
  setName: 12,
  cardNumber: 18,
  parallel: 12,
  variation: 10,
  serialRun: 8,
  team: 4,
  sport: 2,
  isAuto: 8,
  isRelic: 8,
} as const;

const CONFIRMED_SCORE_THRESHOLD = 88;
const CONFIRMED_GAP_THRESHOLD = 12;

const CATALOG_LOOKUP_IDENTITY_FIELDS = [
  "year",
  "brand",
  "setName",
  "cardNumber",
  "player",
  "team",
  "parallel",
  "variation",
  "serialRun",
  "sport",
] as const;

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCardNumber(value: string | null | undefined) {
  return normalizeText(value).replace(/[\s-]/g, "");
}

function normalizeSerialRun(value: string | null | undefined) {
  const raw = normalizeText(value)
    .replace(/\bone of one\b/g, "1/1")
    .replace(/\b1 of 1\b/g, "1/1")
    .replace(/\s+/g, "");
  const match = raw.match(/(?:^|\/)(\d{1,6})$/);

  if (raw === "1/1") return "/1";
  if (raw.startsWith("/")) return raw;
  if (match && raw.includes("/")) return `/${match[1]}`;

  return raw;
}

function booleanKnown(value: boolean | null | undefined) {
  return typeof value === "boolean";
}

function textKnown(value: string | null | undefined) {
  return normalizeText(value).length > 0;
}

function variationCoverageSignals(coverage: InstaCompCatalogVariationCoverage) {
  return Object.values(coverage).filter(Boolean).length;
}

function sourcePolicyRejectionReasons(source: InstaCompCatalogSourcePolicy) {
  const reasons: string[] = [];

  if (!source.apiAvailable) {
    reasons.push("catalog source API is not available");
  }
  if (!source.sourceUsageAllowed) {
    reasons.push("catalog source is not approved for TCOS use");
  }
  if (!source.commercialUseAllowed) {
    reasons.push("catalog source is not approved for commercial use");
  }
  if (!source.storageAllowed) {
    reasons.push("catalog source does not allow TCOS to store match evidence");
  }
  if (!source.displayAllowed) {
    reasons.push("catalog source does not allow TCOS to display match evidence");
  }
  if (variationCoverageSignals(source.variationCoverage) === 0) {
    reasons.push("catalog source has no declared card variation coverage");
  }

  return reasons;
}

export function evaluateInstaCompCatalogSourcePolicy(
  source: InstaCompCatalogSourcePolicy,
): InstaCompCatalogSourcePolicyResult {
  const reasons = sourcePolicyRejectionReasons(source);

  return {
    source,
    status: reasons.length === 0 ? "approved" : "rejected",
    reasons,
  };
}

export function buildInstaCompCatalogLookupPlan(
  input: InstaCompCatalogIdentityInput,
  sources: InstaCompCatalogSourcePolicy[],
): InstaCompCatalogLookupPlan {
  const evaluated = sources.map(evaluateInstaCompCatalogSourcePolicy);
  const approvedSources = evaluated.filter((source) => source.status === "approved");
  const rejectedSources = evaluated.filter((source) => source.status === "rejected");
  const queryHints = CATALOG_LOOKUP_IDENTITY_FIELDS.flatMap((field) => {
    const value = input[field];
    return textKnown(value) ? [`${evidenceLabel(field)}:${value}`] : [];
  });
  const reviewReasons: string[] = [];

  if (approvedSources.length === 0) {
    reviewReasons.push("no approved online card catalog source is available");
  }
  if (queryHints.length === 0) {
    reviewReasons.push("scanner did not produce enough identity fields for catalog lookup");
  }

  return {
    status: reviewReasons.length === 0 ? "ready" : "review_required",
    catalogBeforeCompsRequired: true,
    compSearchBlockedUntilCatalogResolved: true,
    queryIdentity: input,
    queryHints,
    approvedSources,
    rejectedSources,
    reviewReasons,
  };
}

export function attachInstaCompCatalogSourcePolicy(
  source: InstaCompCatalogSourcePolicy,
  candidates: InstaCompCatalogCandidateIdentity[],
): InstaCompCatalogCandidate[] {
  const policyResult = evaluateInstaCompCatalogSourcePolicy(source);

  return candidates.map((candidate) => ({
    ...candidate,
    source: source.source,
    sourceLabel: source.sourceLabel,
    sourceUrl: candidate.sourceUrl || source.sourceUrl,
    sourceUsageAllowed: policyResult.status === "approved",
  }));
}

function valuesMatch(
  field: keyof typeof FIELD_WEIGHTS,
  inputValue: string | boolean | null | undefined,
  candidateValue: string | boolean | null | undefined,
) {
  if (field === "isAuto" || field === "isRelic") {
    if (!booleanKnown(inputValue as boolean | null | undefined)) return "unknown";
    if (!booleanKnown(candidateValue as boolean | null | undefined)) return "missing";
    return inputValue === candidateValue ? "match" : "mismatch";
  }

  if (!textKnown(inputValue as string | null | undefined)) return "unknown";
  if (!textKnown(candidateValue as string | null | undefined)) return "missing";

  if (field === "cardNumber") {
    return normalizeCardNumber(inputValue as string) ===
      normalizeCardNumber(candidateValue as string)
      ? "match"
      : "mismatch";
  }

  if (field === "serialRun") {
    return normalizeSerialRun(inputValue as string) ===
      normalizeSerialRun(candidateValue as string)
      ? "match"
      : "mismatch";
  }

  return normalizeText(inputValue as string) === normalizeText(candidateValue as string)
    ? "match"
    : "mismatch";
}

function evidenceLabel(field: keyof typeof FIELD_WEIGHTS) {
  return field
    .replace("setName", "set")
    .replace("cardNumber", "card number")
    .replace("serialRun", "serial run")
    .replace("isAuto", "autograph marker")
    .replace("isRelic", "relic marker");
}

function isCriticalMismatch(field: keyof typeof FIELD_WEIGHTS) {
  return [
    "player",
    "year",
    "brand",
    "setName",
    "cardNumber",
    "parallel",
    "variation",
    "serialRun",
    "isAuto",
    "isRelic",
  ].includes(field);
}

function candidateField(
  candidate: InstaCompCatalogCandidate,
  field: keyof typeof FIELD_WEIGHTS,
) {
  return candidate[field as keyof InstaCompCatalogCandidate] as
    | string
    | boolean
    | null
    | undefined;
}

function inputField(
  input: InstaCompCatalogIdentityInput,
  field: keyof typeof FIELD_WEIGHTS,
) {
  return input[field as keyof InstaCompCatalogIdentityInput] as
    | string
    | boolean
    | null
    | undefined;
}

export function scoreInstaCompCatalogCandidate(
  input: InstaCompCatalogIdentityInput,
  candidate: InstaCompCatalogCandidate,
): InstaCompCatalogCandidateScore {
  const matchedEvidence: string[] = [];
  const mismatchedEvidence: string[] = [];
  const missingEvidence: string[] = [];
  let earnedWeight = 0;
  let possibleWeight = 0;
  let criticalMismatch = false;

  for (const field of Object.keys(FIELD_WEIGHTS) as Array<
    keyof typeof FIELD_WEIGHTS
  >) {
    const inputValue = inputField(input, field);
    const candidateValue = candidateField(candidate, field);
    const result = valuesMatch(field, inputValue, candidateValue);

    if (result === "unknown") continue;

    possibleWeight += FIELD_WEIGHTS[field];

    if (result === "match") {
      earnedWeight += FIELD_WEIGHTS[field];
      matchedEvidence.push(`${evidenceLabel(field)} matched`);
      continue;
    }

    if (result === "missing") {
      missingEvidence.push(`${evidenceLabel(field)} missing from catalog candidate`);
      continue;
    }

    mismatchedEvidence.push(`${evidenceLabel(field)} did not match`);
    if (isCriticalMismatch(field)) criticalMismatch = true;
  }

  const score =
    possibleWeight > 0 ? Math.round((earnedWeight / possibleWeight) * 100) : 0;

  return {
    candidate,
    score,
    matchedEvidence,
    mismatchedEvidence,
    missingEvidence,
    criticalMismatch,
    sourceAllowed: candidate.sourceUsageAllowed,
  };
}

function suggestedQuestionFor(score: InstaCompCatalogCandidateScore | null) {
  if (!score) return null;

  const firstMismatch = score.mismatchedEvidence[0];
  if (firstMismatch) {
    return `Confirm the ${firstMismatch.replace(" did not match", "")} from the card image before selecting this catalog match.`;
  }

  const firstMissing = score.missingEvidence[0];
  if (firstMissing) {
    return `Confirm the ${firstMissing.replace(" missing from catalog candidate", "")} because the catalog candidate is incomplete.`;
  }

  return "Confirm the exact card variation from the front/back image before using this catalog match.";
}

export function resolveInstaCompCatalogIdentity(
  input: InstaCompCatalogIdentityInput,
  candidates: InstaCompCatalogCandidate[],
): InstaCompCatalogIdentityResolution {
  const ranked = candidates
    .map((candidate) => scoreInstaCompCatalogCandidate(input, candidate))
    .sort((left, right) => right.score - left.score);
  const selectedMatch = ranked[0] || null;
  const alternateMatches = ranked.slice(1, 4);
  const reviewReasons: string[] = [];

  if (!selectedMatch) {
    reviewReasons.push("no catalog candidates were available");
  } else {
    const nextBestScore = alternateMatches[0]?.score ?? 0;
    const scoreGap = selectedMatch.score - nextBestScore;

    if (!selectedMatch.sourceAllowed) {
      reviewReasons.push("selected catalog source is not approved for TCOS use");
    }
    if (selectedMatch.criticalMismatch) {
      reviewReasons.push("selected catalog candidate has a critical mismatch");
    }
    if (selectedMatch.score < CONFIRMED_SCORE_THRESHOLD) {
      reviewReasons.push(
        `selected catalog score ${selectedMatch.score} is below ${CONFIRMED_SCORE_THRESHOLD}`,
      );
    }
    if (scoreGap < CONFIRMED_GAP_THRESHOLD && alternateMatches.length > 0) {
      reviewReasons.push(
        `selected catalog score gap ${scoreGap} is below ${CONFIRMED_GAP_THRESHOLD}`,
      );
    }
  }

  const status =
    selectedMatch && reviewReasons.length === 0
      ? "catalog_confirmed"
      : "review_required";
  const matchExplanation = selectedMatch
    ? `${selectedMatch.candidate.sourceLabel} ${selectedMatch.candidate.catalogId} scored ${selectedMatch.score}; ${selectedMatch.matchedEvidence.join(", ") || "no positive evidence"}`
    : "No catalog match was available.";

  return {
    status,
    selectedMatch,
    alternateMatches,
    reviewReasons,
    suggestedQuestion:
      status === "review_required" ? suggestedQuestionFor(selectedMatch) : null,
    matchExplanation,
  };
}

function candidateToCompIdentity(
  candidate: InstaCompCatalogCandidate,
  matchExplanation: string,
): InstaCompCatalogCompIdentity {
  return {
    player: candidate.player,
    year: candidate.year,
    brand: candidate.brand,
    setName: candidate.setName,
    cardNumber: candidate.cardNumber,
    parallel: candidate.parallel,
    variation: candidate.variation,
    serialRun: candidate.serialRun,
    team: candidate.team,
    sport: candidate.sport,
    isAuto: candidate.isAuto,
    isRelic: candidate.isRelic,
    catalogId: candidate.catalogId,
    catalogSource: candidate.source,
    catalogSourceLabel: candidate.sourceLabel,
    catalogSourceUrl: candidate.sourceUrl,
    catalogMatchExplanation: matchExplanation,
  };
}

export function buildInstaCompCatalogCompGate(
  input: InstaCompCatalogIdentityInput,
  candidates: InstaCompCatalogCandidate[],
): InstaCompCatalogCompGate {
  const resolution = resolveInstaCompCatalogIdentity(input, candidates);
  const confirmed =
    resolution.status === "catalog_confirmed" && resolution.selectedMatch;
  const reviewReasons =
    resolution.status === "review_required"
      ? [
          ...resolution.reviewReasons,
          "catalog identity unresolved before exact comps",
        ]
      : [];

  return {
    status: resolution.status,
    exactCompSearchAllowed: Boolean(confirmed),
    trustedForExactComps: Boolean(confirmed),
    compIdentity: confirmed
      ? candidateToCompIdentity(
          confirmed.candidate,
          resolution.matchExplanation,
        )
      : null,
    fallbackInput: input,
    reviewReasons,
    suggestedQuestion: resolution.suggestedQuestion,
    resolution,
  };
}
