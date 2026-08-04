export type InstaCompChecklistLookupInput = {
  year: string | null;
  manufacturer: string | null;
  cardNumber: string | null;
  player: string | null;
  serialNumber?: string | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
  parallel?: string | null;
  variation?: string | null;
};

export type InstaCompChecklistCandidate = {
  identityId: string;
  year: string | null;
  manufacturer: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber: string | null;
  player: string | null;
  serialRun?: number | null;
  isAuto: boolean;
  isRelic: boolean;
  parallel?: string | null;
  variation?: string | null;
};

export type InstaCompChecklistFirstDecision = {
  status: "exact_match" | "review_required" | "not_found" | "input_incomplete";
  aiRequired: boolean;
  match: InstaCompChecklistCandidate | null;
  candidates: InstaCompChecklistCandidate[];
  reasons: string[];
};

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

function normalizedPlayer(value: unknown) {
  return normalizedText(value)
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function yearStart(value: unknown) {
  return normalizedText(value).match(/\b((?:18|19|20)\d{2})\b/)?.[1] || "";
}

function serialRun(value: unknown) {
  const normalized = normalizedText(value).replace(/\s+/g, "");
  if (!normalized) return null;
  if (normalized === "1/1" || normalized === "1of1") return 1;
  const match = normalized.match(/\/(\d{1,6})$/);
  return match ? Number(match[1]) : null;
}

function manufacturerMatches(
  input: InstaCompChecklistLookupInput,
  candidate: InstaCompChecklistCandidate,
) {
  const target = normalizedText(input.manufacturer);
  if (!target) return false;
  return [candidate.manufacturer, candidate.brand, candidate.setName]
    .map(normalizedText)
    .some((value) => value === target || value.includes(target) || target.includes(value));
}

function optionalTextMatches(input: unknown, candidate: unknown) {
  const target = normalizedText(input);
  return !target || target === normalizedText(candidate);
}

export function resolveInstaCompChecklistFirst(params: {
  input: InstaCompChecklistLookupInput;
  candidates: InstaCompChecklistCandidate[];
}): InstaCompChecklistFirstDecision {
  const { input } = params;
  const missing = [
    ["year", yearStart(input.year)],
    ["manufacturer", normalizedText(input.manufacturer)],
    ["card_number", normalizedCardNumber(input.cardNumber)],
    ["player", normalizedPlayer(input.player)],
  ].filter(([, value]) => !value).map(([field]) => field);

  if (missing.length) {
    return {
      status: "input_incomplete",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: missing.map((field) => `missing_${field}`),
    };
  }

  const baseMatches = params.candidates.filter((candidate) =>
    yearStart(candidate.year) === yearStart(input.year) &&
    manufacturerMatches(input, candidate) &&
    normalizedCardNumber(candidate.cardNumber) === normalizedCardNumber(input.cardNumber) &&
    normalizedPlayer(candidate.player) === normalizedPlayer(input.player)
  );

  if (!baseMatches.length) {
    return {
      status: "not_found",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: ["no_year_manufacturer_card_number_player_match"],
    };
  }

  const requestedRun = serialRun(input.serialNumber);
  const typedMatches = baseMatches.filter((candidate) =>
    (input.isAuto == null || candidate.isAuto === input.isAuto) &&
    (input.isRelic == null || candidate.isRelic === input.isRelic) &&
    (requestedRun == null || candidate.serialRun === requestedRun) &&
    optionalTextMatches(input.parallel, candidate.parallel) &&
    optionalTextMatches(input.variation, candidate.variation)
  );

  if (typedMatches.length === 1) {
    return {
      status: "exact_match",
      aiRequired: false,
      match: typedMatches[0],
      candidates: typedMatches,
      reasons: ["checklist_exact_match"],
    };
  }

  const reviewCandidates = typedMatches.length ? typedMatches : baseMatches;
  return {
    status: "review_required",
    aiRequired: true,
    match: null,
    candidates: reviewCandidates,
    reasons: typedMatches.length
      ? ["multiple_checklist_variants_match"]
      : ["base_card_match_but_card_type_conflicts"],
  };
}
