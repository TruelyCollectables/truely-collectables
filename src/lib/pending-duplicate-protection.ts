import { normalizeListingDuplicateTitle } from "./listing-duplicate-alert";

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function pendingDuplicateProtectionMatchKey(params: {
  pricingGroupKey?: string | null;
  title?: string | null;
}) {
  const pricingGroupKey = cleanText(params.pricingGroupKey);
  if (pricingGroupKey) return pricingGroupKey;
  const normalizedTitle = normalizeListingDuplicateTitle(params.title);
  return normalizedTitle ? `legacy-title:${normalizedTitle}` : null;
}

export function pendingDuplicateCandidateMatches(params: {
  draftPricingGroupKey?: string | null;
  draftTitle?: string | null;
  candidatePricingGroupKey?: string | null;
  candidateTitle?: string | null;
}) {
  const draftKey = cleanText(params.draftPricingGroupKey);
  const candidateKey = cleanText(params.candidatePricingGroupKey);

  // Structured registry/checklist identity always wins. If both sides have it
  // and disagree, an identical-looking legacy title must never override that.
  if (draftKey && candidateKey) return draftKey === candidateKey;

  // Legacy fallback is deliberately strict: normalized full titles must match.
  // Parallel/variation/serial words remain in the normalization, so Ice, Silver,
  // Blue Velocity, numbered cards, etc. do not collapse into one identity.
  const draftTitle = normalizeListingDuplicateTitle(params.draftTitle);
  const candidateTitle = normalizeListingDuplicateTitle(params.candidateTitle);
  return Boolean(draftTitle && candidateTitle && draftTitle === candidateTitle);
}

export function pendingDuplicateDecisionResolved(
  decisionValue: unknown,
  matchKey: string | null,
) {
  if (
    !matchKey ||
    !decisionValue ||
    typeof decisionValue !== "object" ||
    Array.isArray(decisionValue)
  ) {
    return false;
  }
  const decision = decisionValue as Record<string, unknown>;
  return (
    cleanText(decision.mode) === "keep_separate" &&
    cleanText(decision.matchKey) === matchKey
  );
}
