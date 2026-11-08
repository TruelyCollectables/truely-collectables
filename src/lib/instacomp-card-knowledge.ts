import type { InstaCompAiResult } from "./instacomp";
import { buildInstaCompDraftTitle } from "./instacomp-draft-title";

export const TCOS_CARD_KNOWLEDGE_TRUST_THRESHOLD = 3;

export type TcosCardKnowledgeTrustStatus =
  | "learning"
  | "tcos_trusted"
  | "needs_review";

export type TcosCardKnowledgeResultPayload = {
  ok?: boolean;
  scanId?: string | null;
  ai?: InstaCompAiResult | null;
  searchQuery?: string | null;
  stats?: unknown;
  soldStats?: unknown;
  sourceCoverage?: unknown;
  consensus?: unknown;
  catalogEvidence?: unknown;
  operatorCorrections?: {
    customTitle?: string | null;
    customSerialNumber?: string | null;
    customQuantity?: string | null;
    customPrice?: string | null;
    operatorMarkedWrong?: boolean | null;
    operatorNeedsMoreInfo?: boolean | null;
    listingPrice?: number | null;
    priceSource?: string | null;
  } | null;
};

export type TcosCardKnowledgeDraft = {
  identityFingerprint: string;
  title: string;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  player: string | null;
  parallel: string | null;
  variation: string | null;
  serialRun: string | null;
  serialNumber: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
};

function cleanText(value: unknown, maxLength = 240) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return text ? text.slice(0, maxLength) : null;
}

function comparableText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bo[-\s]*pee[-\s]*chee\b/g, "opeechee")
    .replace(/\bspauthentic\b/g, "sp authentic")
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFingerprintPart(value: unknown) {
  return comparableText(value).replace(/\s+/g, "-") || "unknown";
}

function normalizeCardNumber(value: unknown) {
  return comparableText(value).replace(/[\s-]/g, "") || "unknown";
}

export function extractSerialRunForKnowledge(value: unknown) {
  const text = comparableText(value)
    .replace(/\bone of one\b/g, "1/1")
    .replace(/\b1 of 1\b/g, "1/1")
    .replace(/\s+/g, "");

  if (text === "1/1") return "/1";

  const slashMatch = text.match(/\/(\d{1,6})$/);
  if (slashMatch) return `/${slashMatch[1]}`;

  return null;
}

export function trustStatusForConfirmedCount(
  confirmedCount: number,
): TcosCardKnowledgeTrustStatus {
  return confirmedCount >= TCOS_CARD_KNOWLEDGE_TRUST_THRESHOLD
    ? "tcos_trusted"
    : "learning";
}

export function buildTcosCardKnowledgeDraft(params: {
  resultPayload: TcosCardKnowledgeResultPayload;
  fallbackTitle?: string | null;
}): TcosCardKnowledgeDraft | null {
  const ai = params.resultPayload.ai;

  if (!ai) return null;

  const operatorTitle = cleanText(
    params.resultPayload.operatorCorrections?.customTitle,
    300,
  );
  const title =
    operatorTitle ||
    buildInstaCompDraftTitle(ai, cleanText(params.fallbackTitle, 240) || "TCOS card");
  const serialRun = extractSerialRunForKnowledge(ai.serialNumber);
  const variation = cleanText(
    params.resultPayload.catalogEvidence &&
      typeof params.resultPayload.catalogEvidence === "object" &&
      "compIdentity" in params.resultPayload.catalogEvidence
      ? (params.resultPayload.catalogEvidence as any).compIdentity?.variation
      : null,
    160,
  );
  const parallel = cleanText(ai.parallel, 180) || variation;
  const fingerprintParts = [
    normalizeFingerprintPart(ai.year),
    normalizeFingerprintPart(ai.brand),
    normalizeFingerprintPart(ai.setName),
    normalizeCardNumber(ai.cardNumber),
    normalizeFingerprintPart(ai.player),
    normalizeFingerprintPart(parallel || variation),
    normalizeFingerprintPart(serialRun),
  ];

  return {
    identityFingerprint: fingerprintParts.join("|"),
    title,
    year: cleanText(ai.year, 40),
    brand: cleanText(ai.brand, 120),
    setName: cleanText(ai.setName, 200),
    cardNumber: cleanText(ai.cardNumber, 80),
    player: cleanText(ai.player, 200),
    parallel,
    variation,
    serialRun,
    serialNumber: cleanText(ai.serialNumber, 80),
    team: cleanText(ai.team, 160),
    sport: cleanText(ai.sport, 80),
    isRookie: ai.isRookie === true,
    isAuto: ai.isAuto === true,
    isRelic: ai.isRelic === true,
  };
}
