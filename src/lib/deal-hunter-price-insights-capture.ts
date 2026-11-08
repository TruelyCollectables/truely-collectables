import type { InstaCompAiResult } from "./instacomp";
import type { InstaCompRegistryTruth } from "./instacomp-market-history";

type CandidateLike = {
  id?: unknown;
  title?: unknown;
  identity?: unknown;
  exact_market?: unknown;
  evaluation?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function boolean(value: unknown) {
  return value === true;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function registryPair(value: unknown) {
  const row = record(value);
  const identityId = text(
    row.registryIdentityId ?? row.registry_identity_id ?? row.identityId ?? row.identity_id,
  );
  const fingerprintSha256 = text(
    row.registryFingerprintSha256 ??
      row.registry_fingerprint_sha256 ??
      row.fingerprintSha256 ??
      row.fingerprint_sha256,
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      identityId,
    ) ||
    !/^[0-9a-f]{64}$/i.test(fingerprintSha256)
  ) {
    return null;
  }
  return { identityId, fingerprintSha256 };
}

export function registryTruthFromDealHunterCandidate(
  candidate: CandidateLike,
): InstaCompRegistryTruth | null {
  const identity = record(candidate.identity);
  const exactMarket = record(candidate.exact_market);
  const evaluation = record(candidate.evaluation);

  const internalPair = registryPair({
    registryIdentityId: identity.internalChecklistIdentityId,
    registryFingerprintSha256: identity.internalChecklistFingerprintSha256,
  });
  const sources = [
    record(exactMarket.historicalSoldMemory),
    record(exactMarket.dealHunterMacFailover),
    record(exactMarket.registry),
    record(evaluation.checklistRegistry),
    record(evaluation.registry),
    record(identity.checklistRegistry),
  ];
  const pair = internalPair || sources.map(registryPair).find(Boolean) || null;
  if (!pair) return null;
  return {
    matched: true,
    identityId: pair.identityId,
    fingerprintSha256: pair.fingerprintSha256,
    status: "candidate_locked",
    sourceTier: "deal_hunter_candidate",
  };
}

export function instaCompAiFromDealHunterCandidate(
  candidate: CandidateLike,
): InstaCompAiResult | null {
  const identity = record(candidate.identity);
  const confidence = number(identity.confidence) ?? 0;
  const player = text(identity.player);
  const year = text(identity.year);
  const brand = text(identity.brand);
  const setName = text(identity.setName ?? identity.set_name);
  const cardNumber = text(identity.cardNumber ?? identity.card_number);

  if (confidence < 0.95 || !player || !year || !brand || !setName || !cardNumber) {
    return null;
  }

  return {
    player,
    year,
    brand,
    setName,
    cardNumber,
    parallel: text(identity.parallel) || null,
    serialNumber: text(identity.serialNumber ?? identity.serial_number) || null,
    team: text(identity.team) || null,
    sport: text(identity.sport) || null,
    isRookie: boolean(identity.isRookie ?? identity.is_rookie),
    isAuto: boolean(identity.isAuto ?? identity.is_auto),
    isRelic: boolean(identity.isRelic ?? identity.is_relic),
    conditionGuess: text(identity.conditionGuess ?? identity.condition_guess) || null,
    confidence,
    notes: text(identity.notes) || null,
    gradingCompany: text(identity.gradingCompany ?? identity.grading_company) || null,
    gradeValue: text(identity.gradeValue ?? identity.grade_value) || null,
    certificationNumber:
      text(identity.certificationNumber ?? identity.certification_number) || null,
    certificationLookupUrl:
      text(identity.certificationLookupUrl ?? identity.certification_lookup_url) || null,
    gradingEvidence: text(identity.gradingEvidence ?? identity.grading_evidence) || null,
  };
}

export function priceInsightsCandidateEligibility(candidate: CandidateLike) {
  const registry = registryTruthFromDealHunterCandidate(candidate);
  if (!registry) {
    return { eligible: false as const, reason: "No locked Checklist Registry UUID/fingerprint is stored for this candidate." };
  }
  const ai = instaCompAiFromDealHunterCandidate(candidate);
  if (!ai) {
    return {
      eligible: false as const,
      reason:
        "Candidate identity is not complete at 95%+ confidence (player/year/brand/set/card number required).",
    };
  }
  return { eligible: true as const, registry, ai };
}
