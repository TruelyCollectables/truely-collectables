import type { InstaCompAiResult } from "./instacomp";
import {
  buildInstaCompCatalogEvidenceSnapshot,
  type InstaCompCatalogCandidateIdentity,
  type InstaCompCatalogEvidenceSnapshot,
  type InstaCompCatalogIdentityInput,
  type InstaCompCatalogProviderResult,
  type InstaCompCatalogSourcePolicy,
} from "./instacomp-catalog-identity";
import type { InstaCompConsensusCatalogReferee } from "./instacomp-consensus";

const TCOS_CURATED_CHECKLIST_SOURCE: InstaCompCatalogSourcePolicy = {
  source: "tcos_curated_checklist",
  sourceLabel: "TCOS Curated Checklist",
  sourceUrl: "tcos://instacomp/curated-checklist",
  apiAvailable: true,
  sourceUsageAllowed: true,
  commercialUseAllowed: true,
  storageAllowed: true,
  displayAllowed: true,
  cachingAllowed: true,
  attributionRequired: false,
  termsReviewedAt: "2026-07-16",
  variationCoverage: {
    baseCards: true,
    parallels: true,
    refractors: true,
    shortPrints: true,
    imageVariations: true,
    autographs: true,
    relics: true,
    serialNumberedRuns: true,
  },
};

const TCOS_CURATED_CHECKLIST_CANDIDATES: InstaCompCatalogCandidateIdentity[] = [
  {
    catalogId: "tcos-2025-26-sp-authentic-hockey-o-8-outliers",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-sp-authentic-hockey/o-8",
    player: "Connor McDavid",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "SP Authentic Hockey",
    cardNumber: "O-8",
    parallel: "Outliers",
    variation: "Outliers",
    team: "Edmonton Oilers",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2025-26-upper-deck-extended-series-c-369-canvas-young-guns",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-upper-deck-extended-series/c-369",
    player: "Curtis Douglas",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "Upper Deck Extended Series",
    cardNumber: "C-369",
    parallel: "Canvas Young Guns",
    variation: "Canvas Young Guns",
    team: "Utah Mammoth",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2025-26-upper-deck-extended-series-ud3-28-clear-cut",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-upper-deck-extended-series/ud3-28",
    player: "Seth Jarvis",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "Upper Deck Extended Series",
    cardNumber: "UD3-28",
    parallel: "Clear Cut",
    variation: "Clear Cut",
    team: "Carolina Hurricanes",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2022-23-upper-deck-extended-series-656-clear-cut",
    sourceUrl: "tcos://instacomp/curated-checklist/2022-23-upper-deck-extended-series/656-clear-cut",
    player: "Dylan Larkin",
    year: "2022-23",
    brand: "Upper Deck",
    setName: "Upper Deck Extended Series",
    cardNumber: "656",
    parallel: "Clear Cut",
    variation: "Clear Cut",
    team: "Detroit Red Wings",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
  {
    catalogId: "tcos-2025-26-sp-authentic-hockey-s-50-spectrum-fx-level-1",
    sourceUrl: "tcos://instacomp/curated-checklist/2025-26-sp-authentic-hockey/s-50",
    player: "Matthew Robertson",
    year: "2025-26",
    brand: "Upper Deck",
    setName: "SP Authentic Hockey",
    cardNumber: "S-50",
    parallel: "Future Watch Spectrum FX Level 1",
    variation: "Future Watch Spectrum FX Level 1",
    team: "New York Rangers",
    sport: "Hockey",
    isAuto: false,
    isRelic: false,
  },
];

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableText(value: string | null | undefined) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableCardNumber(value: string | null | undefined) {
  return comparableText(value).replace(/[\s-]/g, "");
}

function isGenericBase(value: string | null | undefined) {
  const comparable = comparableText(value);

  return (
    comparable === "base" ||
    comparable === "base card" ||
    comparable === "standard" ||
    comparable === "standard card" ||
    comparable === "regular" ||
    comparable === "regular card"
  );
}

function extractSerialRun(serialNumber: string | null | undefined) {
  const match = cleanText(serialNumber).match(/\/\s*(\d{1,6})\b/);

  return match ? `/${match[1]}` : null;
}

function normalizeSetNameForCuratedChecklist(setName: string | null | undefined) {
  const cleaned = cleanText(setName);

  if (/\bsp\s+authentic\b/i.test(cleaned)) return "SP Authentic Hockey";
  if (/\bextended\s+series\b/i.test(cleaned)) return "Upper Deck Extended Series";

  return cleaned || null;
}

function printedVariationCue(text: string) {
  if (/\boutliers?\b/i.test(text)) return "Outliers";
  if (/\bfuture\s+watch\b/i.test(text) && /\bspectrum\s+fx\b/i.test(text)) {
    return "Future Watch Spectrum FX Level 1";
  }
  if (/\bspectrum\s+fx\b/i.test(text)) return "Spectrum FX";
  if (/\bclear\s*cut\b/i.test(text)) return "Clear Cut";
  if (/\bcanvas\b/i.test(text) && /\byoung\s+guns?\b/i.test(text)) {
    return "Canvas Young Guns";
  }
  if (/\bcanvas\b/i.test(text)) return "Canvas";
  if (/\blimited\s+red\b/i.test(text)) return "Limited Red";

  return null;
}

function aiToCatalogInput(
  ai: InstaCompAiResult,
  externalOcrText: string | null | undefined,
): InstaCompCatalogIdentityInput {
  const evidenceText = [
    ai.year,
    ai.brand,
    ai.setName,
    ai.cardNumber,
    ai.player,
    ai.parallel,
    ai.notes,
    externalOcrText,
  ]
    .filter(Boolean)
    .join(" ");
  const printedCue = printedVariationCue(evidenceText);
  const aiParallel = cleanText(ai.parallel);
  const parallel =
    printedCue && (!aiParallel || isGenericBase(aiParallel))
      ? printedCue
      : aiParallel || printedCue;

  return {
    player: ai.player,
    year: ai.year,
    brand: ai.brand,
    setName: normalizeSetNameForCuratedChecklist(ai.setName),
    cardNumber: ai.cardNumber,
    parallel,
    variation: parallel,
    serialNumber: ai.serialNumber,
    serialRun: extractSerialRun(ai.serialNumber),
    team: ai.team,
    sport: ai.sport,
    isAuto: ai.isAuto,
    isRelic: ai.isRelic,
  };
}

function candidateIsPlausible(
  input: InstaCompCatalogIdentityInput,
  candidate: InstaCompCatalogCandidateIdentity,
  evidenceText: string,
) {
  const cardNumber = comparableCardNumber(input.cardNumber);
  const candidateCardNumber = comparableCardNumber(candidate.cardNumber);
  const year = comparableText(input.year);
  const candidateYear = comparableText(candidate.year);
  const player = comparableText(input.player);
  const candidatePlayer = comparableText(candidate.player);
  const parallel = comparableText(input.parallel || input.variation);
  const candidateParallel = comparableText(candidate.parallel || candidate.variation);
  const evidence = comparableText(evidenceText);

  const cardNumberMatches =
    cardNumber &&
    candidateCardNumber &&
    (cardNumber === candidateCardNumber ||
      evidence.includes(candidateCardNumber) ||
      evidence.includes(candidate.cardNumber?.toLowerCase() || ""));
  const yearMatches = !year || !candidateYear || year === candidateYear;
  const playerMatches = !player || !candidatePlayer || player === candidatePlayer;
  const printedCueMatches =
    parallel &&
    candidateParallel &&
    (parallel === candidateParallel ||
      candidateParallel.includes(parallel) ||
      parallel.includes(candidateParallel));

  return Boolean(cardNumberMatches && yearMatches && (playerMatches || printedCueMatches));
}

export function buildInstaCompCuratedChecklistEvidence(params: {
  ai: InstaCompAiResult;
  externalOcrText?: string | null;
  capturedAt?: string;
}): InstaCompCatalogEvidenceSnapshot | null {
  const input = aiToCatalogInput(params.ai, params.externalOcrText);
  const evidenceText = [
    input.year,
    input.brand,
    input.setName,
    input.cardNumber,
    input.player,
    input.parallel,
    input.variation,
    params.ai.notes,
    params.externalOcrText,
  ]
    .filter(Boolean)
    .join(" ");
  const candidates = TCOS_CURATED_CHECKLIST_CANDIDATES.filter((candidate) =>
    candidateIsPlausible(input, candidate, evidenceText),
  );

  if (!candidates.length) return null;

  const providerResults: InstaCompCatalogProviderResult[] = [
    {
      source: TCOS_CURATED_CHECKLIST_SOURCE.source,
      status: "fulfilled",
      candidates,
      latencyMs: 0,
    },
  ];

  return buildInstaCompCatalogEvidenceSnapshot(
    input,
    [TCOS_CURATED_CHECKLIST_SOURCE],
    providerResults,
    params.capturedAt,
  );
}

export function catalogEvidenceToConsensusReferee(
  evidence: InstaCompCatalogEvidenceSnapshot | null,
): InstaCompConsensusCatalogReferee | null {
  if (!evidence?.selectedMatch && !evidence?.compIdentity) return null;

  return {
    status: evidence.status,
    identity: evidence.compIdentity || evidence.selectedMatch?.identity || null,
    sourceLabel: evidence.sourceAttribution?.sourceLabel || evidence.selectedMatch?.sourceLabel || null,
    catalogId: evidence.sourceAttribution?.catalogId || evidence.selectedMatch?.catalogId || null,
    matchExplanation:
      evidence.compIdentity?.catalogMatchExplanation ||
      evidence.selectedMatch?.matchedEvidence.join(", ") ||
      evidence.operatorAction ||
      null,
  };
}
