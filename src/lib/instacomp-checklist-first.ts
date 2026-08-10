export type InstaCompChecklistLookupInput = {
  year: string | null;
  manufacturer: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber: string | null;
  player: string | null;
  serialNumber?: string | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
  parallel?: string | null;
  variation?: string | null;
  ocrText?: string | null;
};

export type InstaCompChecklistCandidate = {
  identityId: string;
  fingerprintSha256?: string | null;
  year: string | null;
  manufacturer: string | null;
  brand?: string | null;
  product?: string | null;
  setName?: string | null;
  cardNumber: string | null;
  player: string | null;
  serialRun?: number | null;
  isAuto: boolean;
  isRelic: boolean;
  parallel?: string | null;
  variation?: string | null;
  team?: string | null;
  sport?: string | null;
  league?: string | null;
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

function normalizedParallel(value: unknown) {
  const normalized = normalizedText(value);
  if (!normalized || normalized === "base") return "";

  // Prizm/Prizms is a catalog spelling token, not the surface name itself.
  // Remove only that token so harmless word-order differences can match, while
  // Ice, Cracked Ice, Silver, White Seismic, Blue Velocity, Flash, etc. stay
  // separate. Never collapse distinct physical finishes into generic Ice.
  return normalized
    .split(" ")
    .filter((token) => token !== "prizm" && token !== "prizms")
    .join(" ")
    .trim();
}

function normalizedSetName(value: unknown) {
  const normalized = normalizedText(value);
  // Older trusted-memory rows used set_name="Base" to mean the base card/type,
  // not a literal Checklist Registry set. Treat only that exact legacy label as
  // missing set evidence so brand/product + the remaining exact dimensions can
  // disambiguate. Real named sets still have to match exactly below.
  return normalized === "base" ? "" : normalized;
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
  const candidateManufacturer = normalizedText(candidate.manufacturer);
  return Boolean(
    candidateManufacturer &&
      (candidateManufacturer === target ||
        candidateManufacturer.includes(target) ||
        target.includes(candidateManufacturer)),
  );
}

function brandMatches(
  input: InstaCompChecklistLookupInput,
  candidate: InstaCompChecklistCandidate,
) {
  const target = normalizedText(input.brand);
  if (!target) return false;

  return [candidate.brand, candidate.product]
    .map(normalizedText)
    .filter(Boolean)
    .some(
      (value) =>
        value === target || value.includes(target) || target.includes(value),
    );
}

function setMatches(
  input: InstaCompChecklistLookupInput,
  candidate: InstaCompChecklistCandidate,
) {
  const target = normalizedSetName(input.setName);
  if (!target) return false;

  const candidateSet = normalizedText(candidate.setName);
  return Boolean(candidateSet && candidateSet === target);
}

function optionalTextMatches(input: unknown, candidate: unknown) {
  const target = normalizedText(input);
  return !target || target === normalizedText(candidate);
}

function optionalParallelMatches(input: unknown, candidate: unknown) {
  const target = normalizedParallel(input);
  const candidateValue = normalizedParallel(candidate);
  return !target || target === candidateValue;
}

function uniqueCompleteCandidateValue(
  candidates: InstaCompChecklistCandidate[],
  valueFor: (candidate: InstaCompChecklistCandidate) => unknown,
) {
  const values = candidates.map((candidate) => normalizedText(valueFor(candidate)));
  if (values.some((value) => !value)) return null;
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function reviewForProductAmbiguity(
  candidates: InstaCompChecklistCandidate[],
  reason: string,
): InstaCompChecklistFirstDecision {
  return {
    status: "review_required",
    aiRequired: true,
    match: null,
    candidates,
    reasons: [reason],
  };
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
  ]
    .filter(([, value]) => !value)
    .map(([field]) => field);

  if (missing.length) {
    return {
      status: "input_incomplete",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: missing.map((field) => `missing_${field}`),
    };
  }

  // Brand and set are still exact-identity dimensions, but bounded OCR often
  // cannot read them directly. Allow the Registry to supply either dimension
  // only when every candidate matching the hard core identity agrees. Any
  // product/set disagreement stays fail-closed in review instead of guessing.
  const coreMatches = params.candidates.filter(
    (candidate) =>
      yearStart(candidate.year) === yearStart(input.year) &&
      manufacturerMatches(input, candidate) &&
      normalizedCardNumber(candidate.cardNumber) ===
        normalizedCardNumber(input.cardNumber) &&
      normalizedPlayer(candidate.player) === normalizedPlayer(input.player),
  );

  if (!coreMatches.length) {
    return {
      status: "not_found",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: ["no_year_manufacturer_card_number_player_match"],
    };
  }

  let productMatches = coreMatches;
  if (normalizedText(input.brand)) {
    productMatches = productMatches.filter((candidate) => brandMatches(input, candidate));
    if (!productMatches.length) {
      return {
        status: "not_found",
        aiRequired: true,
        match: null,
        candidates: [],
        reasons: ["brand_conflicts_with_registry_candidates"],
      };
    }
  } else if (
    !uniqueCompleteCandidateValue(
      productMatches,
      (candidate) => candidate.brand || candidate.product,
    )
  ) {
    return reviewForProductAmbiguity(
      productMatches,
      "brand_required_to_disambiguate_core_matches",
    );
  }

  if (normalizedSetName(input.setName)) {
    productMatches = productMatches.filter((candidate) => setMatches(input, candidate));
    if (!productMatches.length) {
      return {
        status: "not_found",
        aiRequired: true,
        match: null,
        candidates: [],
        reasons: ["set_name_conflicts_with_registry_candidates"],
      };
    }
  } else if (
    !uniqueCompleteCandidateValue(productMatches, (candidate) => candidate.setName)
  ) {
    return reviewForProductAmbiguity(
      productMatches,
      "set_name_required_to_disambiguate_core_matches",
    );
  }

  const requestedRun = serialRun(input.serialNumber);
  const typedMatches = productMatches.filter(
    (candidate) =>
      (input.isAuto == null || candidate.isAuto === input.isAuto) &&
      (input.isRelic == null || candidate.isRelic === input.isRelic) &&
      (requestedRun == null || candidate.serialRun === requestedRun) &&
      optionalParallelMatches(input.parallel, candidate.parallel) &&
      optionalTextMatches(input.variation, candidate.variation),
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

  const reviewCandidates = typedMatches.length ? typedMatches : productMatches;
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
