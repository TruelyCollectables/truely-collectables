import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
  InstaCompSourceCategory,
  InstaCompSourceCoverage,
  buildCompLinks,
  buildInstaCompQueries,
  calculateCompStats,
  filterAndRankExactMatches,
  filterAndRankGuidanceMatches,
  looksLikeBadCompTitle,
} from "../../../../lib/instacomp";
import { extractInstaCompSerialNumber } from "../../../../lib/instacomp-serial";
import { buildInstaCompScanReview } from "../../../../lib/instacomp-scan-review";
import {
  applyInstaCompConsensusToAi,
  buildInstaCompMultiScannerConsensus,
  buildInstaCompReaderFindingFromAi,
  decideInstaCompConsensusEscalation,
  type InstaCompConsensusIdentity,
  type InstaCompConsensusReaderFinding,
} from "../../../../lib/instacomp-consensus";
import {
  INSTACOMP_JOB_IMAGE_BUCKET,
  INSTACOMP_JOB_ITEM_TABLE,
  InstaCompJobServerError,
  getAccessibleInstaCompJob,
  instaCompJobErrorResponse,
  requireInstaCompJobActor,
  requireInstaCompJobSupabase,
  requireUuid,
  throwInstaCompDatabaseError,
} from "../../../../lib/instacomp-job-server";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";
import { applyInstaCompIdentityGuard } from "../../../../lib/instacomp-identity-guard";
import {
  buildInstaCompCuratedChecklistEvidence,
  catalogEvidenceToConsensusReferee,
} from "../../../../lib/instacomp-curated-checklist";
import { detectGradingDetails } from "../../../../lib/grading-cert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INSTACOMP_OPENAI_MODEL =
  process.env.INSTACOMP_OPENAI_MODEL || "gpt-4.1";
const INSTACOMP_OPENAI_FALLBACK_MODEL =
  process.env.INSTACOMP_OPENAI_FALLBACK_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4.1-mini";
const INSTACOMP_SERIAL_OPENAI_MODEL =
  process.env.INSTACOMP_SERIAL_OPENAI_MODEL ||
  INSTACOMP_OPENAI_FALLBACK_MODEL;
const INSTACOMP_SERIAL_VISION_MODE =
  process.env.INSTACOMP_SERIAL_VISION_MODE || "adaptive";
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const INSTACOMP_GEMINI_MODEL =
  process.env.INSTACOMP_GEMINI_MODEL || "gemini-2.5-flash";
const INSTACOMP_GROQ_MODEL =
  process.env.INSTACOMP_GROQ_MODEL ||
  "meta-llama/llama-4-scout-17b-16e-instruct";
const INSTACOMP_OLLAMA_MODEL =
  process.env.INSTACOMP_OLLAMA_MODEL || "llava";
const INSTACOMP_AI_COUNCIL_TIER =
  process.env.INSTACOMP_AI_COUNCIL_TIER || "adaptive";
const requestedAiCouncilTimeoutMs = Number(
  process.env.INSTACOMP_AI_COUNCIL_TIMEOUT_MS || 25000
);
const INSTACOMP_AI_COUNCIL_TIMEOUT_MS = Number.isFinite(
  requestedAiCouncilTimeoutMs
)
  ? Math.max(5000, Math.min(requestedAiCouncilTimeoutMs, 180000))
  : 25000;
const requestedOllamaCouncilTimeoutMs = Number(
  process.env.INSTACOMP_OLLAMA_COUNCIL_TIMEOUT_MS || 12000
);
const INSTACOMP_OLLAMA_COUNCIL_TIMEOUT_MS = Number.isFinite(
  requestedOllamaCouncilTimeoutMs
)
  ? Math.max(3000, Math.min(requestedOllamaCouncilTimeoutMs, 60000))
  : 12000;

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
let ebayAppTokenCache: { token: string; expiresAt: number } | null = null;
let ebayAppTokenRequest: Promise<string | null> | null = null;

const GOOGLE_CSE_API_KEY =
  process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
const GOOGLE_CSE_CX =
  process.env.GOOGLE_CSE_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
const PADDLEOCR_API_URL =
  process.env.PADDLEOCR_API_URL || process.env.INSTACOMP_PADDLEOCR_API_URL;
const PADDLEOCR_API_KEY =
  process.env.PADDLEOCR_API_KEY || process.env.INSTACOMP_PADDLEOCR_API_KEY;
const requestedPaddleOcrTimeoutMs = Number(
  process.env.PADDLEOCR_TIMEOUT_MS || 120000
);
const PADDLEOCR_TIMEOUT_MS = Number.isFinite(requestedPaddleOcrTimeoutMs)
  ? Math.max(1000, Math.min(requestedPaddleOcrTimeoutMs, 180000))
  : 120000;
const DEAD_PROVIDER_COOLDOWN_MS = 10 * 60 * 1000;
let paddleOcrDisabledUntil = 0;
const MAX_SCAN_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SCAN_DETAIL_IMAGE_BYTES = 512 * 1024;
const MAX_SCAN_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_PERSISTED_SCAN_RESULT_BYTES = 250_000;
const ALLOWED_SCAN_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const GOOGLE_VISION_API_KEY =
  process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_CLOUD_VISION_API_KEY;
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const PRICECHARTING_API_TOKEN =
  process.env.PRICECHARTING_API_TOKEN ||
  process.env.SPORTSCARDSPRO_API_TOKEN ||
  process.env.SPORTSCARDS_PRO_API_TOKEN;
const requestedExternalSearchLimit = Number(
  process.env.INSTACOMP_EXTERNAL_SEARCH_LIMIT || 15
);
const EXTERNAL_SEARCH_LIMIT = Number.isFinite(requestedExternalSearchLimit)
  ? Math.max(1, Math.min(requestedExternalSearchLimit, 25))
  : 15;
const EXTERNAL_SEARCH_CACHE_TTL_DAYS = 7;
const PRICECHARTING_CACHE_TTL_DAYS = Number.isFinite(
  Number(process.env.INSTACOMP_PRICECHARTING_CACHE_TTL_DAYS)
)
  ? Math.max(
      1,
      Math.min(Number(process.env.INSTACOMP_PRICECHARTING_CACHE_TTL_DAYS), 30)
    )
  : 7;
const PRICECHARTING_MIN_REQUEST_INTERVAL_MS = 1100;
let priceChartingLastRequestStartedAt = 0;
let priceChartingApiQueue: Promise<void> = Promise.resolve();

type ExternalSearchProvider = "google_cse" | "serpapi";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      details,
    },
    { status }
  );
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";

  return `data:${mime};base64,${buffer.toString("base64")}`;
}

type InstaCompDetailImage = {
  name: string;
  dataUrl: string;
};

type InstaCompSerialOcrResult = {
  serialNumber: string | null;
  confidence: number;
  evidence: string | null;
  checkedImages: number;
};

type ExternalOcrResult = {
  provider: string;
  text: string;
  serialNumber: string | null;
  checkedImages: number;
};

type InstaCompAiCouncilProvider =
  | "openai_secondary"
  | "gemini"
  | "groq"
  | "ollama";

type InstaCompAiCouncilReader = {
  provider: InstaCompAiCouncilProvider;
  readerId: string;
  label: string;
  model: string;
  ai: InstaCompAiResult;
  durationMs: number;
};

type InstaCompAiCouncilAttempt = {
  provider: InstaCompAiCouncilProvider;
  label: string;
  model: string;
  status: "completed" | "not_configured" | "error" | "skipped";
  durationMs: number | null;
  message: string | null;
};

type InstaCompAiCouncilRun = {
  tier: string;
  desiredReaders: number;
  completedReaders: number;
  readers: InstaCompAiCouncilReader[];
  attempts: InstaCompAiCouncilAttempt[];
};

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

function normalizeOcrText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[|｜]/g, "/")
    .replace(/\s+\/\s+/g, "/")
    .replace(/\bO(?=\/\d)/gi, "0")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSerialNumberFromText(text: string) {
  return extractInstaCompSerialNumber(normalizeOcrText(text))?.exact || null;
}

function collectOcrTextValues(value: unknown, depth = 0): string[] {
  if (!value || depth > 4) return [];

  if (typeof value === "string") return [value];

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectOcrTextValues(item, depth + 1));
  }

  if (typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const directTextValues = [
    record.text,
    record.fullText,
    record.full_text,
    record.rawText,
    record.raw_text,
    record.description,
    record.ocrText,
    record.ocr_text,
  ].filter((item): item is string => typeof item === "string");

  return [
    ...directTextValues,
    ...collectOcrTextValues(record.results, depth + 1),
    ...collectOcrTextValues(record.images, depth + 1),
    ...collectOcrTextValues(record.pages, depth + 1),
    ...collectOcrTextValues(record.detections, depth + 1),
    ...collectOcrTextValues(record.lines, depth + 1),
  ];
}

async function getPaddleOcr(
  images: InstaCompDetailImage[]
): Promise<ExternalOcrResult | null> {
  if (!PADDLEOCR_API_URL || !images.length) return null;
  if (Date.now() < paddleOcrDisabledUntil) return null;

  const checkedImages = images.slice(0, 24);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PADDLEOCR_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (PADDLEOCR_API_KEY) {
      headers.Authorization = `Bearer ${PADDLEOCR_API_KEY}`;
    }

    const response = await fetch(PADDLEOCR_API_URL, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        images: checkedImages.map((image) => ({
          name: image.name,
          dataUrl: image.dataUrl,
        })),
        hints: {
          task: "sports_card_ocr",
          priority: [
            "serial_number",
            "card_number",
            "player",
            "team",
            "set",
            "parallel",
            "autograph",
            "relic",
            "grading_company",
            "grade",
            "certification_number",
          ],
        },
      }),
    });

    if (!response.ok) {
      console.error("PaddleOCR failed:", await response.text());
      return null;
    }

    const data = await response.json();
    const text = normalizeOcrText(collectOcrTextValues(data).join("\n"));
    const responseSerial =
      typeof data?.serialNumber === "string"
        ? data.serialNumber
        : typeof data?.serial_number === "string"
          ? data.serial_number
          : null;
    const serialNumber =
      extractSerialNumberFromText(responseSerial || "") ||
      extractSerialNumberFromText(text);

    return {
      provider: String(data?.provider || "paddleocr"),
      text,
      serialNumber,
      checkedImages:
        typeof data?.checkedImages === "number"
          ? data.checkedImages
          : typeof data?.checked_images === "number"
            ? data.checked_images
            : checkedImages.length,
    };
  } catch (error) {
    console.error("PaddleOCR request failed:", error);
    paddleOcrDisabledUntil = Date.now() + DEAD_PROVIDER_COOLDOWN_MS;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getGoogleVisionOcr(
  images: InstaCompDetailImage[]
): Promise<ExternalOcrResult | null> {
  if (!GOOGLE_VISION_API_KEY || !images.length) return null;

  const requests = images.slice(0, 16).map((image) => ({
    image: {
      content: dataUrlToBase64(image.dataUrl),
    },
    features: [
      {
        type: "TEXT_DETECTION",
      },
    ],
    imageContext: {
      languageHints: ["en"],
    },
  }));

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(
      GOOGLE_VISION_API_KEY
    )}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    }
  );

  if (!response.ok) {
    console.error("Google Vision OCR failed:", await response.text());
    return null;
  }

  const data = await response.json();
  const texts = (data?.responses || [])
    .map((item: any) => {
      const fullText = item?.fullTextAnnotation?.text;
      const annotationText = item?.textAnnotations?.[0]?.description;
      return normalizeOcrText(fullText || annotationText || "");
    })
    .filter(Boolean);
  const text = normalizeOcrText(texts.join("\n"));

  return {
    provider: "google_vision",
    text,
    serialNumber: extractSerialNumberFromText(text),
    checkedImages: requests.length,
  };
}

async function getBestExternalOcr(
  images: InstaCompDetailImage[]
): Promise<ExternalOcrResult | null> {
  const paddleOcr = await getPaddleOcr(images);

  if (paddleOcr?.serialNumber) {
    return paddleOcr;
  }

  const googleVision = await getGoogleVisionOcr(images);

  if (paddleOcr && googleVision?.serialNumber) {
    const text = normalizeOcrText(
      [paddleOcr.text, googleVision.text].filter(Boolean).join("\n")
    );

    return {
      provider: `${paddleOcr.provider}+${googleVision.provider}`,
      text,
      serialNumber: googleVision.serialNumber,
      checkedImages: paddleOcr.checkedImages + googleVision.checkedImages,
    };
  }

  if (paddleOcr?.text || paddleOcr?.serialNumber) {
    return paddleOcr;
  }

  return googleVision;
}

async function identifyCardWithOpenAI(
  frontDataUrl: string,
  backDataUrl?: string,
  detailImages: InstaCompDetailImage[] = [],
  externalOcr: ExternalOcrResult | null = null,
  options: {
    readerFocus?: "primary" | "secondary_consensus";
    models?: string[];
  } = {},
) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const identificationPrompt = `
You are InstaComp™, an expert sports-card identifier and listing assistant for TCOS.

Analyze the uploaded front and optional back images like a card collector preparing a paid listing. Identify the exact collectible card as accurately as possible.

Return JSON only.

Critical inspection workflow:
1. Read the front first for player, team, product line, brand marks, rookie logos, autograph/relic indicators, chrome/prizm/refractor wording, color, border, foil, wave, shimmer, cracked ice, mosaic, mojo, pulsar, scope, laser, sparkle, raywave, x-fractor, atomic, disco, holo, negative, sepia, prism, and other parallel clues.
2. Read the back second for copyright year, printed card number, set/subset name, team, manufacturer text, printed insert names, printed parallel names, and tiny serial-number stamps.
3. If the card is inside a grading slab, inspect the label separately from the card. Return the grading company in gradingCompany, the visible grade in gradeValue, the slab certification number in certificationNumber, and never confuse the slab certification number with the card serialNumber.
4. Serial numbers are often foil-stamped and tiny on the card itself. Inspect both images for formats like 7/25, 07/50, 007/199, 1 of 1, one-of-one, /5, /10, /25, /49, /50, /75, /99, /100, /149, /150, /199, /250, /299, /399, /499, /999. Return the exact visible card stamp in serialNumber.
5. Parallel/insert identity matters for price. If the card text, OCR text, or visible design says Limited Red, Red Limited, Clear Cut, Acetate, Canvas, Dazzlers, Young Guns, Portraits, Rookie Materials, Honor Roll, another insert/subset, or another printed color/foil/parallel name, do not call the card Base. Return the printed collector-market name in parallel and use the printed insert/subset as setName when appropriate.
6. If a visible design cue strongly indicates the parallel, return the best collector-market name in parallel, such as "Limited Red", "Clear Cut", "Silver Prizm", "Green Prizm", "Blue Refractor", "Gold Wave", "Orange Ice", "Purple Shimmer", "Red White Blue Prizm", "Holo", "Refractor", "Chrome Refractor", "Mosaic Reactive Orange", "Sepia Refractor", "X-Fractor", "Atomic Refractor", or "Base".
7. Upper Deck Clear Cut / acetate rule: if an Upper Deck card looks transparent or acetate-like, has a washed/see-through back, a centered team logo/player-name treatment, ghosted player silhouette, or clear-stock design while keeping the normal base card number, return parallel "Clear Cut". Do this even if the printed words "Clear Cut" are not visible. Example: Upper Deck Extended Series cards with a normal front but a translucent/clear back and centered logo/name are Clear Cut parallels, not base.
8. Use "Base" only when the card appears to be the normal base version and there are no visible or OCR-detected insert, subset, acetate/clear-stock, foil, color, refractor/prizm, or numbering cues. Use null only when the image quality prevents a fair call.
9. Panini Select products use levels such as Concourse, Premier Level, and Courtside. These are set/product levels, not insert or parallel names. Put the level in setName when visible (for example "WNBA Select - Premier Level") and keep parallel null unless a true parallel cue such as Prizm, Green Prizm, Silver Prizm, Zebra, Tie-Dye, Gold, etc. is visible.
10. Do not hallucinate serial numbers or grading cert numbers. Only return serialNumber when a card stamp is visible or explicitly printed/stamped. Only return certificationNumber when a slab label cert is visible or present in OCR text.
11. Do not overclaim exact parallels. If the color/finish or insert/clear-stock cue is visible but the exact market name is uncertain, use a cautious descriptive value like "Blue parallel - exact type uncertain" or "Insert - exact type uncertain" instead of Base.
12. If front/back disagree, prefer the printed back for card number/year/set, and explain the conflict in notes.
13. For checklist identity, prefer manufacturer/checklist evidence from Upper Deck, Panini America, Sportlots, COMC checklist pages, Cardboard Connection, TCDB/Trading Card DB, and similar checklist references before generic marketplace titles. Blowout Cards and Blowout Forums can provide helpful collector context, but treat forum claims as review/reference evidence unless they agree with printed card or checklist evidence.
14. If the image is not a sports card, still describe what it appears to be and lower confidence.

Field rules:
- Confidence must be between 0 and 1.
- player, year, brand, setName, cardNumber, parallel, serialNumber, gradingCompany, gradeValue, certificationNumber, certificationLookupUrl, team, sport, conditionGuess, and notes may be null only when not visible/inferable.
- notes must include short evidence for parallel and serial-number decisions, for example: "Parallel evidence: green prizm border. Serial evidence: visible 07/50 stamp on back." If absent, say what was checked.
 - gradingEvidence must include short evidence for slab decisions when a graded slab is visible, for example: "PSA label; grade 10; cert 12345678." If no slab is visible, return null.
  `.trim();

  const content: any[] = [
    {
      type: "text",
      text: identificationPrompt, /*
You are InstaComp™, an AI sports card identification assistant for TCOS.

Analyze the uploaded card image or images. Identify the exact collectible card as accurately as possible.

Return JSON only.

Rules:
- If you are unsure about a field, use null.
- Confidence must be between 0 and 1.
- Do not hallucinate serial numbers. Only return a serial number if visible.
- Be careful with parallels, refractors, prizms, color, autos, relics, and rookie status.
- If the image is not a sports card, still describe what it appears to be and lower confidence.
      */
    },
    ...(options.readerFocus === "secondary_consensus"
      ? [
          {
            type: "text",
            text: "SECOND AI CONSENSUS PASS: act as an independent skeptical reader. Do not copy the first scanner. Re-check player, year, set/product line, card number, insert/subset/parallel, card serial number, grading slab company, slab grade, slab certification number, autograph/relic, and any clear-stock/acetate or color/foil cues. If the exact variation is not proven, say what is uncertain in notes instead of calling it Base.",
          },
        ]
      : []),
    ...(externalOcr?.text
      ? [
          {
            type: "text",
            text: `OCR TEXT EXTRACTED FROM FRONT/BACK/CROPS (${externalOcr.provider}, ${externalOcr.checkedImages} image(s)): ${externalOcr.text.slice(0, 6000)} Use this text heavily for exact player, set, card number, copyright year, manufacturer, parallel wording, card serial number, grading company, slab grade, and slab certification number.`,
          },
        ]
      : []),
    {
      type: "text",
      text: "FRONT IMAGE: inspect player, product line, rookie logo, color/foil/refractor/prizm/parallel cues, autograph/relic cues, visible card serial stamp, and any grading slab label with company, grade, and cert number.",
    },
    {
      type: "image_url",
      image_url: {
        url: frontDataUrl,
        detail: "high",
      },
    },
  ];

  if (backDataUrl) {
    content.push({
      type: "text",
      text: "BACK IMAGE: inspect copyright year, manufacturer text, set/subset, printed card number, team, odds text, tiny foil card serial-number stamps, and any grading slab barcode/label/cert text.",
    });
    content.push({
      type: "image_url",
      image_url: {
        url: backDataUrl,
        detail: "high",
      },
    });
  }

  if (detailImages.length) {
    content.push({
      type: "text",
      text: "ZOOM DETAIL IMAGES: these are cropped closeups from the same card images. Prioritize these for card serial-number OCR, slab cert OCR, grading labels, foil stamps, color/parallel names, and tiny printed identifiers. If a card serial number or slab certification number is visible in any crop, return it exactly in the correct field.",
    });

    detailImages.forEach((image, index) => {
      content.push({
        type: "text",
        text: `ZOOM DETAIL IMAGE ${index + 1}: ${image.name}`,
      });
      content.push({
        type: "image_url",
        image_url: {
          url: image.dataUrl,
          detail: "high",
        },
      });
    });
  }

  const scanModels = Array.from(
    new Set(
      (options.models?.length
        ? options.models
        : [INSTACOMP_OPENAI_MODEL, INSTACOMP_OPENAI_FALLBACK_MODEL]
      ).filter(Boolean),
    ),
  );
  let response: Response | null = null;
  let errorText = "";

  for (const model of scanModels) {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "instacomp_card_scan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              player: { type: ["string", "null"] },
              year: { type: ["string", "null"] },
              brand: { type: ["string", "null"] },
              setName: { type: ["string", "null"] },
              cardNumber: { type: ["string", "null"] },
              parallel: { type: ["string", "null"] },
              serialNumber: { type: ["string", "null"] },
              gradingCompany: { type: ["string", "null"] },
              gradeValue: { type: ["string", "null"] },
              certificationNumber: { type: ["string", "null"] },
              certificationLookupUrl: { type: ["string", "null"] },
              gradingEvidence: { type: ["string", "null"] },
              team: { type: ["string", "null"] },
              sport: { type: ["string", "null"] },
              isRookie: { type: "boolean" },
              isAuto: { type: "boolean" },
              isRelic: { type: "boolean" },
              conditionGuess: { type: ["string", "null"] },
              confidence: { type: "number" },
              notes: { type: ["string", "null"] },
            },
            required: [
              "player",
              "year",
              "brand",
              "setName",
              "cardNumber",
              "parallel",
              "serialNumber",
              "gradingCompany",
              "gradeValue",
              "certificationNumber",
              "certificationLookupUrl",
              "gradingEvidence",
              "team",
              "sport",
              "isRookie",
              "isAuto",
              "isRelic",
              "conditionGuess",
              "confidence",
              "notes",
            ],
          },
        },
      },
      messages: [
        {
          role: "user",
          content,
        },
      ],
    }),
    });

    if (response.ok) break;

    errorText = await response.text();
  }

  if (!response?.ok) {
    throw new Error(`OpenAI scan failed: ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("OpenAI returned no scan content.");
  }

  return normalizeInstaCompAiResult(JSON.parse(text));
}

function aiCouncilTier(requestedTier?: string | null) {
  const normalized = String(requestedTier || INSTACOMP_AI_COUNCIL_TIER || "adaptive")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  if (
    [
      "basic",
      "adaptive",
      "mid",
      "pro",
      "dealer",
      "high_end",
      "high-end",
      "courtroom",
    ].includes(normalized)
  ) {
    return normalized;
  }

  return "adaptive";
}

function desiredAiCouncilReaders(runSecondaryVision: boolean, requestedTier?: string | null) {
  const tier = aiCouncilTier(requestedTier);

  if (tier === "basic") return 0;
  if (tier === "mid") return 1;
  if (tier === "pro" || tier === "dealer") return 2;
  if (tier === "high_end" || tier === "high-end") return 3;
  if (tier === "courtroom") {
    return 4;
  }

  return runSecondaryVision ? 1 : 0;
}

function dataUrlMimeType(dataUrl: string) {
  return dataUrl.match(/^data:([^;]+);base64,/)?.[1] || "image/jpeg";
}

function parseAiJsonText(text: string) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const objectText =
    candidate.startsWith("{") && candidate.endsWith("}")
      ? candidate
      : candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1);

  return JSON.parse(objectText);
}

function cleanNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();

  return cleaned || null;
}

function normalizeAiBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return /^(true|yes|y|1)$/i.test(value.trim());
  }

  return false;
}

function normalizeInstaCompAiResult(value: unknown): InstaCompAiResult {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawConfidence = Number(record.confidence);

  const normalized = {
    player: cleanNullableString(record.player),
    year: cleanNullableString(record.year),
    brand: cleanNullableString(record.brand),
    setName: cleanNullableString(record.setName),
    cardNumber: cleanNullableString(record.cardNumber),
    parallel: cleanNullableString(record.parallel),
    serialNumber: cleanNullableString(record.serialNumber),
    gradingCompany: cleanNullableString(record.gradingCompany),
    gradeValue: cleanNullableString(record.gradeValue),
    certificationNumber: cleanNullableString(record.certificationNumber),
    certificationLookupUrl: cleanNullableString(record.certificationLookupUrl),
    gradingEvidence: cleanNullableString(record.gradingEvidence),
    team: cleanNullableString(record.team),
    sport: cleanNullableString(record.sport),
    isRookie: normalizeAiBoolean(record.isRookie),
    isAuto: normalizeAiBoolean(record.isAuto),
    isRelic: normalizeAiBoolean(record.isRelic),
    conditionGuess: cleanNullableString(record.conditionGuess),
    confidence: Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0,
    notes: cleanNullableString(record.notes),
  };

  const gradingDetails = detectGradingDetails(null, normalized);

  return {
    ...normalized,
    gradingCompany: gradingDetails.gradingCompany,
    gradeValue: gradingDetails.gradeValue,
    certificationNumber: gradingDetails.certificationNumber,
    certificationLookupUrl: gradingDetails.certificationLookupUrl,
    gradingEvidence: gradingDetails.evidence || normalized.gradingEvidence,
  };
}

function normalizedSerialVisionMode() {
  const mode = String(INSTACOMP_SERIAL_VISION_MODE || "adaptive")
    .toLowerCase()
    .trim();

  if (["always", "off", "adaptive"].includes(mode)) return mode;

  return "adaptive";
}

function normalizeOperatorSerialNumberOverride(value: unknown, present: boolean) {
  if (!present) return undefined;

  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const comparable = text.toLowerCase();

  if (
    !text ||
    comparable === "none" ||
    comparable === "no serial" ||
    comparable === "no serial number" ||
    comparable === "not serial numbered"
  ) {
    return null;
  }

  return text;
}

function applyOperatorSerialNumberOverride(
  ai: InstaCompAiResult,
  override: string | null | undefined,
): InstaCompAiResult {
  if (override === undefined) return ai;

  const note = override
    ? `Operator serial override: ${override}.`
    : "Operator serial override: no serial number.";

  return {
    ...ai,
    serialNumber: override,
    notes: [ai.notes, note].filter(Boolean).join(" "),
  };
}

function textHasSerialVisionSignal(value: string | null | undefined) {
  const text = String(value || "");

  return (
    /\b(?:serial(?:ed)?|numbered|numbered\s+to|limited\s+to|one\s+of\s+one|1\s+of\s+1|1\/1)\b/i.test(text) ||
    /\b(?!20\d{2}\s*\/\s*\d{2}\b)\d{1,3}\s*\/\s*(?:1|5|10|15|20|25|49|50|75|99|100|149|150|199|250|299|399|499|999|1000)\b/i.test(text) ||
    /\b\/(?:1|5|10|15|20|25|49|50|75|99|100|149|150|199|250|299|399|499|999|1000)\b/i.test(text)
  );
}

function shouldRunSerialVision(params: {
  ai: InstaCompAiResult;
  externalOcr: ExternalOcrResult | null;
  requestedTier?: string | null;
}) {
  if (params.externalOcr?.serialNumber || params.ai.serialNumber) return true;

  const mode = normalizedSerialVisionMode();
  if (mode === "off") return false;
  if (mode === "always") return true;

  const tier = aiCouncilTier(params.requestedTier);
  if (tier === "courtroom") return true;

  const evidenceText = [
    params.externalOcr?.text,
    params.ai.notes,
    params.ai.parallel,
    params.ai.setName,
  ]
    .filter(Boolean)
    .join(" ");

  return textHasSerialVisionSignal(evidenceText);
}

function shouldPreflightSerialVision(params: {
  externalOcr: ExternalOcrResult | null;
  requestedTier?: string | null;
}) {
  if (params.externalOcr?.serialNumber) return false;

  const mode = normalizedSerialVisionMode();
  if (mode === "off") return false;
  if (mode === "always") return true;

  const tier = aiCouncilTier(params.requestedTier);
  if (tier === "courtroom") return true;

  return textHasSerialVisionSignal(params.externalOcr?.text);
}

function mergeGradingDetection(
  ai: InstaCompAiResult,
  externalOcr: ExternalOcrResult | null
): InstaCompAiResult {
  const gradingDetails = detectGradingDetails(externalOcr?.text || null, ai);

  return {
    ...ai,
    gradingCompany: gradingDetails.gradingCompany,
    gradeValue: gradingDetails.gradeValue,
    certificationNumber: gradingDetails.certificationNumber,
    certificationLookupUrl: gradingDetails.certificationLookupUrl,
    gradingEvidence: gradingDetails.evidence || ai.gradingEvidence || null,
    conditionGuess:
      gradingDetails.gradingCompany && !/graded/i.test(ai.conditionGuess || "")
        ? [ai.conditionGuess, "Graded"].filter(Boolean).join(" - ")
        : ai.conditionGuess,
  };
}

function buildAiCouncilPrompt(params: {
  externalOcr: ExternalOcrResult | null;
  providerLabel: string;
}) {
  return `
You are ${params.providerLabel}, an independent InstaComp™ sports-card identity witness for TCOS.

Return JSON only with exactly these fields:
player, year, brand, setName, cardNumber, parallel, serialNumber, gradingCompany, gradeValue, certificationNumber, certificationLookupUrl, gradingEvidence, team, sport, isRookie, isAuto, isRelic, conditionGuess, confidence, notes.

Rules:
- Identify the exact sports card from the front/back images.
- If the card is in a grading slab, read the slab label separately and return gradingCompany, gradeValue, and certificationNumber. Do not put the slab cert in serialNumber.
- If the card says Outliers, Canvas, Clear Cut, Future Watch, Spectrum FX, Young Guns, Dazzlers, Portraits, Rookie Materials, Honor Roll, or another insert/subset, do not call it Base.
- Upper Deck is the manufacturer unless the product is actually Upper Deck Series 1, Series 2, Extended Series, or a similarly printed Upper Deck product name. For SP Authentic, use setName like "SP Authentic" or "SP Authentic - Outliers", not "Upper Deck SP Authentic Hockey" unless the printed product says that.
- Use "Base" only when no insert, subset, clear-stock, acetate, color, refractor/prizm, foil, autograph/relic, or serial cue is visible.
- Clear/transparent/washed-back Upper Deck acetate cards with centered logo/player-name treatment are Clear Cut parallels.
- Do not hallucinate serial numbers. Return serialNumber only when visible or present in OCR text.
- Do not hallucinate slab certification numbers. Return certificationNumber only when visible or present in OCR text.
- Confidence must be 0 to 1.
- notes must explain the exact visible evidence for set, parallel/insert, card number, and serial decision.
${
  params.externalOcr?.text
    ? `\nOCR TEXT (${params.externalOcr.provider}, ${params.externalOcr.checkedImages} image(s)): ${params.externalOcr.text.slice(0, 6000)}`
    : ""
}
  `.trim();
}

async function withAiCouncilTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = INSTACOMP_AI_COUNCIL_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function identifyCardWithGemini(
  frontDataUrl: string,
  backDataUrl: string | undefined,
  detailImages: InstaCompDetailImage[],
  externalOcr: ExternalOcrResult | null,
) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  const parts: any[] = [
    { text: buildAiCouncilPrompt({ externalOcr, providerLabel: "Gemini" }) },
    { text: "FRONT IMAGE" },
    {
      inlineData: {
        mimeType: dataUrlMimeType(frontDataUrl),
        data: dataUrlToBase64(frontDataUrl),
      },
    },
  ];

  if (backDataUrl) {
    parts.push(
      { text: "BACK IMAGE" },
      {
        inlineData: {
          mimeType: dataUrlMimeType(backDataUrl),
          data: dataUrlToBase64(backDataUrl),
        },
      },
    );
  }

  for (const image of detailImages.slice(0, 8)) {
    parts.push(
      { text: `DETAIL IMAGE: ${image.name}` },
      {
        inlineData: {
          mimeType: dataUrlMimeType(image.dataUrl),
          data: dataUrlToBase64(image.dataUrl),
        },
      },
    );
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      INSTACOMP_GEMINI_MODEL,
    )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini scan failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text || "")
    .join("\n");

  if (!text) throw new Error("Gemini returned no scan content.");

  return normalizeInstaCompAiResult(parseAiJsonText(text));
}

async function identifyCardWithGroq(
  frontDataUrl: string,
  backDataUrl: string | undefined,
  detailImages: InstaCompDetailImage[],
  externalOcr: ExternalOcrResult | null,
) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY.");
  }

  const content: any[] = [
    { type: "text", text: buildAiCouncilPrompt({ externalOcr, providerLabel: "Groq vision" }) },
    { type: "text", text: "FRONT IMAGE" },
    { type: "image_url", image_url: { url: frontDataUrl } },
  ];

  if (backDataUrl) {
    content.push(
      { type: "text", text: "BACK IMAGE" },
      { type: "image_url", image_url: { url: backDataUrl } },
    );
  }

  for (const image of detailImages.slice(0, 8)) {
    content.push(
      { type: "text", text: `DETAIL IMAGE: ${image.name}` },
      { type: "image_url", image_url: { url: image.dataUrl } },
    );
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: INSTACOMP_GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq scan failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) throw new Error("Groq returned no scan content.");

  return normalizeInstaCompAiResult(parseAiJsonText(text));
}

async function identifyCardWithOllama(
  frontDataUrl: string,
  backDataUrl: string | undefined,
  detailImages: InstaCompDetailImage[],
  externalOcr: ExternalOcrResult | null,
) {
  if (!OLLAMA_BASE_URL) {
    throw new Error("Missing OLLAMA_BASE_URL.");
  }

  const images = [
    frontDataUrl,
    ...(backDataUrl ? [backDataUrl] : []),
    ...detailImages.slice(0, 6).map((image) => image.dataUrl),
  ].map(dataUrlToBase64);

  const response = await fetch(
    `${OLLAMA_BASE_URL.replace(/\/+$/, "")}/api/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: INSTACOMP_OLLAMA_MODEL,
        stream: false,
        format: "json",
        messages: [
          {
            role: "user",
            content: buildAiCouncilPrompt({
              externalOcr,
              providerLabel: "Local Ollama vision",
            }),
            images,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Ollama scan failed: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data?.message?.content;

  if (!text) throw new Error("Ollama returned no scan content.");

  return normalizeInstaCompAiResult(parseAiJsonText(text));
}

async function runAiCouncilReader(params: {
  provider: InstaCompAiCouncilProvider;
  frontDataUrl: string;
  backDataUrl?: string;
  detailImages: InstaCompDetailImage[];
  externalOcr: ExternalOcrResult | null;
}): Promise<{
  reader: InstaCompAiCouncilReader | null;
  attempt: InstaCompAiCouncilAttempt;
}> {
  const startedAt = Date.now();
  const providerMeta = {
    openai_secondary: {
      label: "OpenAI skeptical reader",
      model: INSTACOMP_OPENAI_FALLBACK_MODEL,
      configured: Boolean(OPENAI_API_KEY),
    },
    gemini: {
      label: "Gemini vision reader",
      model: INSTACOMP_GEMINI_MODEL,
      configured: Boolean(GEMINI_API_KEY),
    },
    groq: {
      label: "Groq fast vision reader",
      model: INSTACOMP_GROQ_MODEL,
      configured: Boolean(GROQ_API_KEY),
    },
    ollama: {
      label: "Local Ollama vision reader",
      model: INSTACOMP_OLLAMA_MODEL,
      configured: Boolean(OLLAMA_BASE_URL),
    },
  }[params.provider];

  if (!providerMeta.configured) {
    return {
      reader: null,
      attempt: {
        provider: params.provider,
        label: providerMeta.label,
        model: providerMeta.model,
        status: "not_configured",
        durationMs: null,
        message: "Provider key/base URL is not configured.",
      },
    };
  }

  try {
    const timeoutMs =
      params.provider === "ollama"
        ? INSTACOMP_OLLAMA_COUNCIL_TIMEOUT_MS
        : INSTACOMP_AI_COUNCIL_TIMEOUT_MS;
    const ai = await withAiCouncilTimeout(
      params.provider === "openai_secondary"
        ? identifyCardWithOpenAI(
            params.frontDataUrl,
            params.backDataUrl,
            params.detailImages.slice(0, 8),
            params.externalOcr,
            {
              readerFocus: "secondary_consensus",
              models: [INSTACOMP_OPENAI_FALLBACK_MODEL, INSTACOMP_OPENAI_MODEL],
            },
          )
        : params.provider === "gemini"
          ? identifyCardWithGemini(
              params.frontDataUrl,
              params.backDataUrl,
              params.detailImages,
              params.externalOcr,
            )
          : params.provider === "groq"
            ? identifyCardWithGroq(
                params.frontDataUrl,
                params.backDataUrl,
                params.detailImages,
                params.externalOcr,
              )
            : identifyCardWithOllama(
                params.frontDataUrl,
                params.backDataUrl,
                params.detailImages,
                params.externalOcr,
              ),
      providerMeta.label,
      timeoutMs,
    );
    const durationMs = Date.now() - startedAt;

    return {
      reader: {
        provider: params.provider,
        readerId: params.provider,
        label: providerMeta.label,
        model: providerMeta.model,
        ai,
        durationMs,
      },
      attempt: {
        provider: params.provider,
        label: providerMeta.label,
        model: providerMeta.model,
        status: "completed",
        durationMs,
        message: null,
      },
    };
  } catch (error: any) {
    return {
      reader: null,
      attempt: {
        provider: params.provider,
        label: providerMeta.label,
        model: providerMeta.model,
        status: "error",
        durationMs: Date.now() - startedAt,
        message: String(error?.message || error).slice(0, 500),
      },
    };
  }
}

async function runInstaCompAiCouncil(params: {
  runSecondaryVision: boolean;
  requestedTier?: string | null;
  frontDataUrl: string;
  backDataUrl?: string;
  detailImages: InstaCompDetailImage[];
  externalOcr: ExternalOcrResult | null;
}): Promise<InstaCompAiCouncilRun> {
  const desiredReaders = desiredAiCouncilReaders(
    params.runSecondaryVision,
    params.requestedTier,
  );
  const tier = aiCouncilTier(params.requestedTier);
  const providerPlan: InstaCompAiCouncilProvider[] = [
    "openai_secondary",
    "gemini",
    "groq",
  ];

  if (tier === "courtroom") {
    providerPlan.push("ollama");
  }

  if (desiredReaders <= 0) {
    return {
      tier,
      desiredReaders,
      completedReaders: 0,
      readers: [],
      attempts: providerPlan.map((provider) => ({
        provider,
        label:
          provider === "openai_secondary"
            ? "OpenAI skeptical reader"
            : provider === "gemini"
              ? "Gemini vision reader"
              : provider === "groq"
                ? "Groq fast vision reader"
                : "Local Ollama vision reader",
        model:
          provider === "openai_secondary"
            ? INSTACOMP_OPENAI_FALLBACK_MODEL
            : provider === "gemini"
              ? INSTACOMP_GEMINI_MODEL
              : provider === "groq"
                ? INSTACOMP_GROQ_MODEL
                : INSTACOMP_OLLAMA_MODEL,
        status: "skipped",
        durationMs: null,
        message: "This tier/lane did not require another AI witness.",
      })),
    };
  }

  const attempts = await Promise.all(
    providerPlan.slice(0, desiredReaders).map((provider) =>
      runAiCouncilReader({
        provider,
        frontDataUrl: params.frontDataUrl,
        backDataUrl: params.backDataUrl,
        detailImages: params.detailImages,
        externalOcr: params.externalOcr,
      }),
    ),
  );
  const readers = attempts.flatMap((attempt) =>
    attempt.reader ? [attempt.reader] : [],
  );

  return {
    tier,
    desiredReaders,
    completedReaders: readers.length,
    readers,
    attempts: attempts.map((attempt) => attempt.attempt),
  };
}

async function detectSerialNumberWithOpenAI(
  frontDataUrl: string,
  backDataUrl?: string,
  detailImages: InstaCompDetailImage[] = [],
  externalOcr: ExternalOcrResult | null = null
): Promise<InstaCompSerialOcrResult | null> {
  if (externalOcr?.serialNumber) {
    return {
      serialNumber: externalOcr.serialNumber,
      confidence: 0.99,
      evidence: `${externalOcr.provider} OCR text contained ${externalOcr.serialNumber}. Text: ${externalOcr.text.slice(0, 500)}`,
      checkedImages: externalOcr.checkedImages,
    };
  }

  if (!OPENAI_API_KEY) return null;

  const content: any[] = [
    {
      type: "text",
      text: `
You are a strict OCR reader for sports-card serial-number stamps.

Your only job is to find a visible serial-number stamp on the provided card images and close-up crops.

Return JSON only.

What counts:
- Serial numbering such as 7/25, 07/50, 007/199, 1/1, 1 of 1, one of one.
- Foil-stamped, embossed, printed, or tiny numbered stamps.
- Partial denominator-only evidence like /50 should be reported in evidence, but serialNumber must stay null unless the full visible stamp can be read.
- Many cards place the serial stamp near the front top-right edge. Pay special attention to crops named top-right-stamp, top-band, and right-edge.
- Enhanced contrast and inverted crops are alternate views of the same stamp area. Use them to read faint silver, gold, or black foil on glossy backgrounds.

Rules:
- Do not identify the card.
- Do not price the card.
- Do not infer a serial number from the parallel color.
- Do not invent missing digits.
- If no full serial number is visible, return serialNumber null.
- If visible, return the exact visible format, preserving leading zeroes when visible.
      `.trim(),
    },
  ];

  if (externalOcr?.text) {
    content.push({
      type: "text",
      text: `EXTERNAL OCR TEXT (${externalOcr.provider}, ${externalOcr.checkedImages} image(s)): ${externalOcr.text.slice(0, 4000)} If this text includes a full serial number like 087/250, return it exactly. If it only includes partial text, inspect the images.`,
    });
  }

  detailImages.forEach((image, index) => {
    content.push({
      type: "text",
      text: `CLOSE-UP OCR CROP ${index + 1}: ${image.name}`,
    });
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
        detail: "high",
      },
    });
  });

  content.push({
    type: "text",
    text: detailImages.length
      ? "FULL FRONT IMAGE for context only. Prefer close-up crops for OCR."
      : "FULL FRONT IMAGE. Inspect every edge and corner for a serial stamp.",
  });
  content.push({
    type: "image_url",
    image_url: {
      url: frontDataUrl,
      detail: "high",
    },
  });

  if (backDataUrl) {
    content.push({
      type: "text",
      text: detailImages.length
        ? "FULL BACK IMAGE for context only. Prefer close-up crops for OCR."
        : "FULL BACK IMAGE. Inspect every edge and corner for a serial stamp.",
    });
    content.push({
      type: "image_url",
      image_url: {
        url: backDataUrl,
        detail: "high",
      },
    });
  }

  const scanModels = Array.from(
    new Set(
      [
        INSTACOMP_SERIAL_OPENAI_MODEL,
        INSTACOMP_OPENAI_FALLBACK_MODEL,
        INSTACOMP_OPENAI_MODEL,
      ].filter(Boolean)
    )
  );
  let response: Response | null = null;
  let errorText = "";

  for (const model of scanModels) {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "instacomp_serial_ocr",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                serialNumber: { type: ["string", "null"] },
                confidence: { type: "number" },
                evidence: { type: ["string", "null"] },
                checkedImages: { type: "number" },
              },
              required: [
                "serialNumber",
                "confidence",
                "evidence",
                "checkedImages",
              ],
            },
          },
        },
        messages: [
          {
            role: "user",
            content,
          },
        ],
      }),
    });

    if (response.ok) break;

    errorText = await response.text();
  }

  if (!response?.ok) {
    console.error("InstaComp™ serial OCR failed:", errorText);
    return null;
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) return null;

  const parsed = JSON.parse(text) as InstaCompSerialOcrResult;

  return {
    serialNumber: parsed.serialNumber,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
    evidence: parsed.evidence,
    checkedImages:
      typeof parsed.checkedImages === "number"
        ? Math.max(0, Math.floor(parsed.checkedImages))
        : detailImages.length + 1 + (backDataUrl ? 1 : 0),
  };
}

function mergeSerialOcrResult(
  ai: InstaCompAiResult,
  serialOcr: InstaCompSerialOcrResult | null
): InstaCompAiResult {
  if (!serialOcr?.serialNumber) {
    return {
      ...ai,
      notes: [
        ai.notes,
        serialOcr
          ? `Serial OCR checked ${serialOcr.checkedImages} crop(s): ${serialOcr.evidence || "no full serial number found"}`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  return {
    ...ai,
    serialNumber: serialOcr.serialNumber,
    confidence: Math.max(ai.confidence || 0, serialOcr.confidence),
    notes: [
      ai.notes,
      `Serial OCR override: ${serialOcr.serialNumber}. Evidence: ${
        serialOcr.evidence || "visible serial number in detail crop"
      }`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function buildChangedIdentityFinding(
  before: InstaCompAiResult,
  after: InstaCompAiResult,
): InstaCompConsensusIdentity {
  const identity: InstaCompConsensusIdentity = {};
  const fields: Array<keyof InstaCompConsensusIdentity> = [
    "player",
    "year",
    "brand",
    "setName",
    "cardNumber",
    "parallel",
    "serialNumber",
    "team",
    "sport",
    "isRookie",
    "isAuto",
    "isRelic",
  ];

  for (const field of fields) {
    if (before[field] !== after[field]) {
      (identity as Record<string, unknown>)[field] = after[field];
    }
  }

  return identity;
}

function buildInstaCompConsensusReaders(params: {
  baseAi: InstaCompAiResult;
  mergedSerialAi: InstaCompAiResult;
  guardedAi: InstaCompAiResult;
  aiCouncil: InstaCompAiCouncilRun;
  serialOcr: InstaCompSerialOcrResult | null;
  externalOcr: ExternalOcrResult | null;
}) {
  const readers: InstaCompConsensusReaderFinding[] = [
    buildInstaCompReaderFindingFromAi({
      readerId: "primary_vision",
      label: "Primary AI vision",
      kind: "primary_vision",
      ai: params.baseAi,
      evidence: ["front/back image model identity pass"],
      weight: 1,
    }),
  ];

  if (params.serialOcr?.serialNumber) {
    readers.push({
      readerId: "serial_vision",
      label: "Serial vision/OCR",
      kind: "serial_vision",
      identity: {
        serialNumber: params.serialOcr.serialNumber,
      },
      confidence: params.serialOcr.confidence,
      weight: 1.25,
      evidence: [
        params.serialOcr.evidence ||
          `serial reader found ${params.serialOcr.serialNumber}`,
      ],
    });
  }

  params.aiCouncil.readers.forEach((councilReader, index) => {
    readers.push(
      buildInstaCompReaderFindingFromAi({
        readerId: `secondary_vision_${councilReader.readerId}`,
        label: councilReader.label,
        kind: "secondary_vision",
        ai: councilReader.ai,
        evidence: [
          `AI council ${params.aiCouncil.tier} identity witness ${index + 1}/${params.aiCouncil.desiredReaders}`,
          `${councilReader.label} used ${councilReader.model} in ${councilReader.durationMs}ms`,
          params.externalOcr?.provider
            ? `${params.externalOcr.provider} OCR text was provided to this reader`
            : "reader used card images without external OCR text",
        ],
        weight: councilReader.provider === "openai_secondary" ? 0.95 : 0.9,
      }),
    );
  });

  const printedGuardIdentity = buildChangedIdentityFinding(
    params.mergedSerialAi,
    params.guardedAi,
  );
  const printedGuardFields = Object.keys(printedGuardIdentity);

  if (printedGuardFields.length > 0) {
    readers.push({
      readerId: "ocr_printed_evidence_guard",
      label: "OCR/printed evidence guard",
      kind: "ocr_printed_evidence",
      identity: printedGuardIdentity,
      confidence: Math.max(0.84, params.guardedAi.confidence || 0),
      weight: 1.15,
      evidence: [
        params.guardedAi.notes || "printed/OCR evidence adjusted identity fields",
        params.externalOcr?.provider
          ? `${params.externalOcr.provider} OCR supplied ${params.externalOcr.checkedImages} image text pass(es)`
          : "vision-only printed evidence guard",
      ],
    });
  }

  return readers;
}

async function getEbayAppToken() {
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    return null;
  }

  if (ebayAppTokenCache && ebayAppTokenCache.expiresAt > Date.now()) {
    return ebayAppTokenCache.token;
  }

  if (ebayAppTokenRequest) return ebayAppTokenRequest;

  ebayAppTokenRequest = requestEbayAppToken();

  try {
    return await ebayAppTokenRequest;
  } finally {
    ebayAppTokenRequest = null;
  }
}

async function requestEbayAppToken() {
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) return null;

  const auth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString(
    "base64"
  );

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }).toString(),
  });

  if (!response.ok) {
    console.error("eBay token error:", await response.text());
    return null;
  }

  const data = await response.json();
  const token = typeof data?.access_token === "string" ? data.access_token : null;

  if (token) {
    const expiresInSeconds = Number(data?.expires_in);
    const safeLifetimeSeconds = Number.isFinite(expiresInSeconds)
      ? Math.max(60, expiresInSeconds - 90)
      : 60 * 60;

    ebayAppTokenCache = {
      token,
      expiresAt: Date.now() + safeLifetimeSeconds * 1000,
    };
  }

  return token;
}

async function getEbayProvider(
  query: string,
  ai: InstaCompAiResult,
  searchUrl: string
): Promise<InstaCompProviderResult> {
  const token = await getEbayAppToken();

  if (!token) {
    return {
      source: "ebay_active",
      label: "eBay Active",
      status: "not_configured",
      message: "eBay API token was not available.",
      results: [],
      searchUrl,
    };
  }

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "25");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Accept-Language": "en-US",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error("eBay Browse search error:", await response.text());

    return {
      source: "ebay_active",
      label: "eBay Active",
      status: "error",
      message: "eBay search failed.",
      results: [],
      searchUrl,
    };
  }

  const data = await response.json();
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = items
    .map((item: any) => {
      const value = Number(item?.price?.value);

      return {
        title: String(item?.title || ""),
        price: Number.isFinite(value) ? value : 0,
        currency: String(item?.price?.currency || "USD"),
        url: String(item?.itemWebUrl || ""),
        imageUrl: item?.image?.imageUrl ? String(item.image.imageUrl) : null,
        source: "ebay_active" as const,
        sourceLabel: "eBay Active",
        sourceCategory: "marketplace" as const,
        listedAt: item?.itemCreationDate ? String(item.itemCreationDate) : null,
        observedAt: new Date().toISOString(),
      };
    })
    .filter((item: Omit<InstaCompComp, "matchScore" | "flags">) => {
      if (!item.title || !item.url || !item.price) return false;
      if (looksLikeBadCompTitle(item.title, ai)) return false;

      return true;
    });

  let results = filterAndRankExactMatches(rawComps, ai, 3, 55);
  let reviewOnly = false;

  const guidanceResults = filterAndRankGuidanceMatches(rawComps, ai, 5, 30);

  if (results.length) {
    const exactUrls = new Set(results.map((result) => result.url));
    results = [
      ...results,
      ...guidanceResults.filter((result) => !exactUrls.has(result.url)),
    ].slice(0, 6);
  } else {
    results = guidanceResults;
    reviewOnly = results.length > 0;
  }

  return {
    source: "ebay_active",
    label: "eBay Active",
    status: results.length ? "live" : "no_matches",
    message: reviewOnly
      ? "eBay returned review-needed candidates. They are shown but not used for auto-pricing."
      : results.length
      ? null
      : "No exact raw matches passed the InstaComp™ filter.",
    results,
    searchUrl,
  };
}

async function getBestEbayProvider(
  queries: string[],
  ai: InstaCompAiResult,
  searchUrl: string
) {
  const uniqueQueries = Array.from(
    new Set(queries.map((item) => item.trim()).filter(Boolean))
  ).slice(0, 4);
  let best: InstaCompProviderResult | null = null;

  for (const query of uniqueQueries) {
    const provider = await getEbayProvider(query, ai, searchUrl);

    if (!best || provider.results.length > best.results.length) {
      best = {
        ...provider,
        message:
          provider.message ||
          (query !== uniqueQueries[0] ? `Matched backup query: ${query}` : null),
      };
    }

    if (
      provider.results.some(
        (result) => !result.flags.includes("not used for pricing")
      )
    ) {
      return provider;
    }
  }

  return (
    best || {
      source: "ebay_active",
      label: "eBay Active",
      status: "no_matches",
      message: "No eBay query returned usable comps.",
      results: [],
      searchUrl,
    }
  );
}

function normalizeInstaCompCacheKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function buildExternalSearchCacheKey(
  query: string,
  provider: ExternalSearchProvider
) {
  const normalizedQuery = normalizeInstaCompCacheKey(query);
  const rawKey = `${provider}:${normalizedQuery}`;

  return createHash("sha256").update(rawKey).digest("hex");
}

async function getCachedExternalSearchItems(
  cacheKey: string,
  provider: ExternalSearchProvider
): Promise<{
  items: ExternalSearchItem[];
  expiresAt: string | null;
  hitCount: number;
} | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload, hit_count, expires_at")
    .eq("query_hash", cacheKey)
    .eq("provider", provider)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("InstaComp™ cache read error:", error);
    return null;
  }

  const payload = data?.result_payload as
    | { items?: ExternalSearchItem[]; query?: string; provider?: string }
    | null;

  if (!payload?.items || !Array.isArray(payload.items)) {
    return null;
  }

  const hitCount = Number(data?.hit_count || 0);

  void supabase
    .from("instacomp_search_cache")
    .update({
      hit_count: Number.isFinite(hitCount) ? hitCount + 1 : 1,
      updated_at: new Date().toISOString(),
    })
    .eq("query_hash", cacheKey)
    .eq("provider", provider);

  return {
    items: payload.items,
    expiresAt: typeof data?.expires_at === "string" ? data.expires_at : null,
    hitCount: Number.isFinite(hitCount) ? hitCount : 0,
  };
}

async function storeCachedExternalSearchItems(
  cacheKey: string,
  provider: ExternalSearchProvider,
  query: string,
  items: ExternalSearchItem[]
) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + 1000 * 60 * 60 * 24 * EXTERNAL_SEARCH_CACHE_TTL_DAYS
  ).toISOString();

  const { error } = await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: cacheKey,
      provider,
      normalized_query: normalizeInstaCompCacheKey(query),
      result_payload: {
        query,
        provider,
        items,
      },
      updated_at: now.toISOString(),
      expires_at: expiresAt,
      hit_count: 0,
    },
    { onConflict: "query_hash" }
  );

  if (error) {
    console.error("InstaComp™ cache write error:", error);
  }
}

function buildPriceChartingCacheKey(query: string) {
  const normalizedQuery = normalizeInstaCompCacheKey(query);
  const rawKey = `pricecharting_api:${normalizedQuery}`;

  return createHash("sha256").update(rawKey).digest("hex");
}

function positiveIntegerOrNull(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function priceChartingProductUrl(product: Record<string, unknown>) {
  const directUrl =
    typeof product["product-url"] === "string"
      ? product["product-url"]
      : typeof product.url === "string"
        ? product.url
        : null;

  if (directUrl) return directUrl;

  return null;
}

function normalizePriceChartingProducts(value: unknown): PriceChartingProductItem[] {
  const products: unknown[] = Array.isArray((value as any)?.products)
    ? (value as any).products
    : Array.isArray(value)
      ? value
      : [];

  return products
    .map((product: unknown): PriceChartingProductItem | null => {
      const record =
        product && typeof product === "object"
          ? (product as Record<string, unknown>)
          : {};
      const productName = String(
        record["product-name"] || record.productName || record.name || ""
      ).trim();

      if (!productName) return null;

      return {
        id: String(record.id || "").trim(),
        productName,
        consoleName:
          typeof record["console-name"] === "string"
            ? record["console-name"]
            : typeof record.consoleName === "string"
              ? record.consoleName
              : null,
        loosePriceCents: positiveIntegerOrNull(record["loose-price"]),
        productUrl: priceChartingProductUrl(record),
      };
    })
    .filter((item): item is PriceChartingProductItem => Boolean(item));
}

async function getCachedPriceChartingProducts(
  cacheKey: string
): Promise<{
  products: PriceChartingProductItem[];
  expiresAt: string | null;
  hitCount: number;
} | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload, hit_count, expires_at")
    .eq("query_hash", cacheKey)
    .eq("provider", "pricecharting_api")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("PriceCharting cache read error:", error);
    return null;
  }

  const payload = data?.result_payload as
    | { products?: PriceChartingProductItem[]; query?: string }
    | null;
  const products = normalizePriceChartingProducts(payload?.products || []);

  if (!products.length) return null;

  const hitCount = Number(data?.hit_count || 0);

  void supabase
    .from("instacomp_search_cache")
    .update({
      hit_count: Number.isFinite(hitCount) ? hitCount + 1 : 1,
      updated_at: new Date().toISOString(),
    })
    .eq("query_hash", cacheKey)
    .eq("provider", "pricecharting_api");

  return {
    products,
    expiresAt: typeof data?.expires_at === "string" ? data.expires_at : null,
    hitCount: Number.isFinite(hitCount) ? hitCount : 0,
  };
}

async function storeCachedPriceChartingProducts(
  cacheKey: string,
  query: string,
  products: PriceChartingProductItem[]
) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + 1000 * 60 * 60 * 24 * PRICECHARTING_CACHE_TTL_DAYS
  ).toISOString();

  const { error } = await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: cacheKey,
      provider: "pricecharting_api",
      normalized_query: normalizeInstaCompCacheKey(query),
      result_payload: {
        query,
        provider: "pricecharting_api",
        products,
      },
      updated_at: now.toISOString(),
      expires_at: expiresAt,
      hit_count: 0,
    },
    { onConflict: "query_hash" }
  );

  if (error) {
    console.error("PriceCharting cache write error:", error);
  }
}

async function runPriceChartingApiCall<T>(fn: () => Promise<T>) {
  const run = priceChartingApiQueue.then(async () => {
    const waitMs = Math.max(
      0,
      PRICECHARTING_MIN_REQUEST_INTERVAL_MS -
        (Date.now() - priceChartingLastRequestStartedAt)
    );

    if (waitMs) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    priceChartingLastRequestStartedAt = Date.now();
    return fn();
  });

  priceChartingApiQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

async function fetchPriceChartingProducts(query: string): Promise<{
  ok: boolean;
  products: PriceChartingProductItem[];
  message: string | null;
}> {
  if (!PRICECHARTING_API_TOKEN) {
    return {
      ok: false,
      products: [],
      message:
        "Add PRICECHARTING_API_TOKEN to ingest SportsCardsPro / PriceCharting guide prices.",
    };
  }

  const url = new URL("https://www.pricecharting.com/api/products");
  url.searchParams.set("t", PRICECHARTING_API_TOKEN);
  url.searchParams.set("q", query);

  try {
    return await runPriceChartingApiCall(async () => {
      const response = await fetch(url.toString(), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.status === "error") {
        return {
          ok: false,
          products: [],
          message: `SportsCardsPro / PriceCharting failed: ${String(
            data?.["error-message"] || data?.error || response.statusText
          )}`,
        };
      }

      return {
        ok: true,
        products: normalizePriceChartingProducts(data),
        message: null,
      };
    });
  } catch (error: any) {
    return {
      ok: false,
      products: [],
      message: `SportsCardsPro / PriceCharting failed: ${error?.message || "request error"}`,
    };
  }
}

async function getPriceChartingProvider(
  query: string,
  ai: InstaCompAiResult
): Promise<InstaCompProviderResult> {
  const searchUrl = `https://www.sportscardspro.com/search-products?q=${encodeURIComponent(
    query
  )}&type=prices`;

  if (!PRICECHARTING_API_TOKEN) {
    return {
      source: "sports_cards_pro",
      label: "SportsCardsPro Guide",
      status: "not_configured",
      message:
        "PRICECHARTING_API_TOKEN is not configured, so SportsCardsPro guide prices were not ingested.",
      results: [],
      searchUrl,
    };
  }

  const cacheKey = buildPriceChartingCacheKey(query);
  const cached = await getCachedPriceChartingProducts(cacheKey);
  const fetched = cached ? null : await fetchPriceChartingProducts(query);

  if (fetched && !fetched.ok) {
    return {
      source: "sports_cards_pro",
      label: "SportsCardsPro Guide",
      status: "error",
      message: fetched.message,
      results: [],
      searchUrl,
    };
  }

  const products = cached?.products ?? fetched?.products ?? [];

  if (!cached && fetched?.ok) {
    void storeCachedPriceChartingProducts(cacheKey, query, products);
  }

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = products
    .filter((product) => product.loosePriceCents !== null)
    .map((product) => ({
      title: [
        product.productName,
        product.consoleName && !product.productName.includes(product.consoleName)
          ? product.consoleName
          : null,
      ]
        .filter(Boolean)
        .join(" "),
      price: Number(product.loosePriceCents) / 100,
      currency: "USD",
      url: product.productUrl || searchUrl,
      imageUrl: null,
      source: "sports_cards_pro" as const,
      sourceLabel: "SportsCardsPro Guide",
      sourceCategory: "pricing" as const,
    }))
    .filter((item) => !looksLikeBadCompTitle(item.title, ai));

  const results = filterAndRankExactMatches(rawComps, ai, 6, 45).map(
    (comp) => ({
      ...comp,
      flags: Array.from(new Set([...comp.flags, "guide price", "ungraded"])),
    })
  );

  return {
    source: "sports_cards_pro",
    label: "SportsCardsPro Guide",
    status: results.length ? "live" : "no_matches",
    message: cached
      ? `Loaded cached SportsCardsPro guide prices.`
      : results.length
        ? "SportsCardsPro / PriceCharting returned filtered ungraded guide price matches."
        : products.length
          ? "SportsCardsPro / PriceCharting returned products, but no ungraded exact guide price passed the InstaComp™ filter."
          : "SportsCardsPro / PriceCharting returned no product matches.",
    results,
    searchUrl,
  };
}

type ExternalSearchSource = {
  label: string;
  domain: string;
  category: InstaCompSourceCategory;
};

type ExternalSearchItem = {
  title: string;
  url: string;
  snippet: string;
  imageUrl: string | null;
};

type PriceChartingProductItem = {
  id: string;
  productName: string;
  consoleName: string | null;
  loosePriceCents: number | null;
  productUrl: string | null;
};

type ExternalSearchFetchResult = {
  ok: boolean;
  items: ExternalSearchItem[];
  errorMessage: string | null;
};

const externalSearchSources: ExternalSearchSource[] = [
  { label: "130point", domain: "130point.com", category: "sold" },
  {
    label: "PSA APR",
    domain: "psacard.com/auctionprices",
    category: "sold",
  },
  { label: "Sportlots Checklist", domain: "sportlots.com", category: "reference" },
  { label: "COMC Checklist", domain: "comc.com", category: "reference" },
  {
    label: "Panini America Checklist",
    domain: "paniniamerica.net",
    category: "reference",
  },
  {
    label: "Upper Deck Checklist",
    domain: "upperdeck.com",
    category: "reference",
  },
  {
    label: "Cardboard Connection Checklist",
    domain: "cardboardconnection.com",
    category: "reference",
  },
  {
    label: "Blowout Cards Checklist",
    domain: "blowoutcards.com",
    category: "reference",
  },
  {
    label: "Blowout Forums Reference",
    domain: "blowoutforums.com",
    category: "reference",
  },
  { label: "Mercari", domain: "mercari.com", category: "marketplace" },
  {
    label: "Facebook Marketplace",
    domain: "facebook.com/marketplace",
    category: "marketplace",
  },
  { label: "MySlabs", domain: "myslabs.com", category: "marketplace" },
  { label: "Whatnot", domain: "whatnot.com", category: "marketplace" },
  { label: "StockX", domain: "stockx.com", category: "marketplace" },
  {
    label: "Fanatics Collect",
    domain: "fanaticscollect.com",
    category: "auction",
  },
  { label: "PWCC", domain: "pwccmarketplace.com", category: "auction" },
  { label: "Goldin", domain: "goldin.co", category: "auction" },
  { label: "Heritage", domain: "ha.com", category: "auction" },
  {
    label: "PriceCharting",
    domain: "pricecharting.com",
    category: "pricing",
  },
  {
    label: "SportsCardsPro",
    domain: "sportscardspro.com",
    category: "pricing",
  },
  { label: "CollX", domain: "collx.app", category: "pricing" },
  { label: "Cardbase", domain: "cardbase.com", category: "pricing" },
  { label: "Card Ladder", domain: "cardladder.com", category: "pricing" },
  { label: "Alt", domain: "alt.xyz", category: "pricing" },
];

function slugifySource(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildExternalSearchQuery(query: string) {
  const sourceQuery = externalSearchSources
    .map((source) => `site:${source.domain}`)
    .join(" OR ");

  return `${query} (${sourceQuery})`;
}

function identifyExternalSource(url: string): ExternalSearchSource | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = parsed.pathname.toLowerCase();

    return (
      externalSearchSources.find((source) => {
        const [domainHost, ...pathParts] = source.domain
          .toLowerCase()
          .split("/");
        const path = pathParts.join("/");

        if (!hostname.endsWith(domainHost)) return false;
        if (!path) return true;

        return pathname.includes(path);
      }) || null
    );
  } catch {
    return null;
  }
}

function extractPriceFromSearchText(value: string) {
  const match =
    value.match(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/) ||
    value.match(/\bUSD\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);

  if (!match?.[1]) return 0;

  const parsed = Number(match[1].replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : 0;
}

function extractCompEventDateIso(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const monthName =
    "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const monthDateMatch =
    normalized.match(
      new RegExp(`\\b${monthName}\\.?\\s+([0-9]{1,2})(?:,)?\\s+(20[0-9]{2})\\b`, "i")
    ) ||
    normalized.match(
      new RegExp(`\\b([0-9]{1,2})\\s+${monthName}\\.?\\s+(20[0-9]{2})\\b`, "i")
    );
  const isoLikeMatch = normalized.match(/\b(20[0-9]{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])\b/);
  const agoMatch = normalized.match(/\b([0-9]{1,3})\s+(day|days|week|weeks|month|months)\s+ago\b/i);

  let date: Date | null = null;

  if (monthDateMatch) {
    date = new Date(monthDateMatch[0].replace(/\./g, ""));
  } else if (isoLikeMatch) {
    date = new Date(
      `${isoLikeMatch[1]}-${isoLikeMatch[2].padStart(2, "0")}-${isoLikeMatch[3].padStart(2, "0")}`
    );
  } else if (agoMatch) {
    const amount = Number(agoMatch[1]);
    const unit = agoMatch[2].toLowerCase();
    const days = unit.startsWith("month")
      ? amount * 30
      : unit.startsWith("week")
        ? amount * 7
        : amount;

    if (Number.isFinite(days)) {
      date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }
  }

  return date && Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

function externalProviderLabel(provider: ExternalSearchProvider | null) {
  if (provider === "serpapi") return "SerpApi";
  if (provider === "google_cse") return "Google CSE";
  return null;
}

function externalProviderRequestedLimit(provider: ExternalSearchProvider | null) {
  if (provider === "google_cse") return Math.min(EXTERNAL_SEARCH_LIMIT, 10);
  if (provider === "serpapi") return EXTERNAL_SEARCH_LIMIT;
  return 0;
}

async function fetchGoogleCseItems(
  searchQuery: string
): Promise<ExternalSearchFetchResult> {
  if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_CX) {
    return {
      ok: false,
      items: [],
      errorMessage: "Google CSE credentials were not available.",
    };
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", GOOGLE_CSE_API_KEY);
  url.searchParams.set("cx", GOOGLE_CSE_CX);
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("num", String(Math.min(EXTERNAL_SEARCH_LIMIT, 10)));
  url.searchParams.set("safe", "active");

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error("Google CSE InstaComp™ error:", await response.text());

      return {
        ok: false,
        items: [],
        errorMessage: "Google CSE external comp search failed.",
      };
    }

    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];

    return {
      ok: true,
      items: items.map((item: any) => ({
        title: String(item?.title || ""),
        url: String(item?.link || ""),
        snippet: String(item?.snippet || ""),
        imageUrl: item?.pagemap?.cse_thumbnail?.[0]?.src
          ? String(item.pagemap.cse_thumbnail[0].src)
          : null,
      })),
      errorMessage: null,
    };
  } catch (error) {
    console.error("Google CSE InstaComp™ exception:", error);

    return {
      ok: false,
      items: [],
      errorMessage: "Google CSE external comp search threw an error.",
    };
  }
}

async function fetchSerpApiItems(
  searchQuery: string
): Promise<ExternalSearchFetchResult> {
  if (!SERPAPI_API_KEY) {
    return {
      ok: false,
      items: [],
      errorMessage: "SerpApi credentials were not available.",
    };
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("api_key", SERPAPI_API_KEY);
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("num", String(EXTERNAL_SEARCH_LIMIT));
  url.searchParams.set("safe", "active");

  try {
    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error("SerpApi InstaComp™ error:", await response.text());

      return {
        ok: false,
        items: [],
        errorMessage: "SerpApi external comp search failed.",
      };
    }

    const data = await response.json();
    const items = Array.isArray(data?.organic_results)
      ? data.organic_results
      : [];

    return {
      ok: true,
      items: items.map((item: any) => ({
        title: String(item?.title || ""),
        url: String(item?.link || ""),
        snippet: String(item?.snippet || ""),
        imageUrl: item?.thumbnail ? String(item.thumbnail) : null,
      })),
      errorMessage: null,
    };
  } catch (error) {
    console.error("SerpApi InstaComp™ exception:", error);

    return {
      ok: false,
      items: [],
      errorMessage: "SerpApi external comp search threw an error.",
    };
  }
}

async function getExternalSearchProvider(
  query: string,
  ai: InstaCompAiResult,
  searchUrl: string
): Promise<InstaCompProviderResult> {
  const hasGoogleCse = Boolean(GOOGLE_CSE_API_KEY && GOOGLE_CSE_CX);

  if (!SERPAPI_API_KEY && !hasGoogleCse) {
    return {
      source: "external_comp_search",
      label: "External Comp Search",
      status: "not_configured",
      message:
        "Add GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX or SERPAPI_API_KEY to ingest external comp sources.",
      results: [],
      searchUrl,
      diagnostics: {
        externalSearch: {
          provider: null,
          providerLabel: null,
          cacheStatus: "not_configured",
          cacheHit: false,
          externalRequestAttempted: false,
          paidSearchUsed: false,
          requestedLimit: 0,
          returnedSearchItems: 0,
          includedCompCount: 0,
          registeredSourceCount: externalSearchSources.length,
          cacheTtlDays: EXTERNAL_SEARCH_CACHE_TTL_DAYS,
          cacheExpiresAt: null,
          cacheHitCountBeforeScan: null,
        },
      },
    };
  }

  const searchQuery = buildExternalSearchQuery(query);
  const provider: ExternalSearchProvider = SERPAPI_API_KEY
    ? "serpapi"
    : "google_cse";
  const cacheKey = buildExternalSearchCacheKey(query, provider);
  const cachedSearch = await getCachedExternalSearchItems(cacheKey, provider);
  const cacheHit = Boolean(cachedSearch);

  const fetched = cachedSearch
    ? null
    : provider === "serpapi"
      ? await fetchSerpApiItems(searchQuery)
      : await fetchGoogleCseItems(searchQuery);

  if (fetched && !fetched.ok) {
    return {
      source: "external_comp_search",
      label: "External Comp Search",
      status: "error",
      message: fetched.errorMessage,
      results: [],
      searchUrl,
      diagnostics: {
        externalSearch: {
          provider,
          providerLabel: externalProviderLabel(provider),
          cacheStatus: "error",
          cacheHit: false,
          externalRequestAttempted: true,
          paidSearchUsed: false,
          requestedLimit: externalProviderRequestedLimit(provider),
          returnedSearchItems: 0,
          includedCompCount: 0,
          registeredSourceCount: externalSearchSources.length,
          cacheTtlDays: EXTERNAL_SEARCH_CACHE_TTL_DAYS,
          cacheExpiresAt: null,
          cacheHitCountBeforeScan: null,
        },
      },
    };
  }

  const searchItems = cachedSearch?.items ?? fetched?.items ?? [];

  if (!cacheHit && fetched?.ok) {
    void storeCachedExternalSearchItems(cacheKey, provider, query, searchItems);
  }

  const rawComps = searchItems
    .map((item): Omit<InstaCompComp, "matchScore" | "flags"> | null => {
      const source = identifyExternalSource(item.url);
      const searchText = `${item.title} ${item.snippet}`;
      const price = extractPriceFromSearchText(searchText);

      if (!source) return null;

      return {
        title: item.title,
        price,
        currency: "USD",
        url: item.url,
        imageUrl: item.imageUrl,
        source: `external_${slugifySource(source.label)}`,
        sourceLabel: source.label,
        sourceCategory: source.category,
        soldAt:
          source.category === "sold" ? extractCompEventDateIso(searchText) : null,
        observedAt: new Date().toISOString(),
      };
    })
    .filter(
      (item): item is Omit<InstaCompComp, "matchScore" | "flags"> =>
        Boolean(item?.title && item?.url && item?.price)
    )
    .filter((item) => !looksLikeBadCompTitle(item.title, ai));

  const results = filterAndRankExactMatches(rawComps, ai, 12, 35);

  return {
    source: "external_comp_search",
    label: "External Comp Search",
    status: results.length ? "live" : "no_matches",
    message: cacheHit
      ? "Loaded cached external comp results for this card identity."
      : results.length
        ? "External search returned priced, filtered comp candidates."
        : "External search returned no priced exact-match comp candidates.",
    results,
    searchUrl,
    diagnostics: {
      externalSearch: {
        provider,
        providerLabel: externalProviderLabel(provider),
        cacheStatus: cacheHit
          ? "hit"
          : SUPABASE_URL && SUPABASE_KEY
            ? "miss"
            : "disabled",
        cacheHit,
        externalRequestAttempted: Boolean(fetched?.ok),
        paidSearchUsed: Boolean(fetched?.ok),
        requestedLimit: externalProviderRequestedLimit(provider),
        returnedSearchItems: searchItems.length,
        includedCompCount: results.length,
        registeredSourceCount: externalSearchSources.length,
        cacheTtlDays: EXTERNAL_SEARCH_CACHE_TTL_DAYS,
        cacheExpiresAt: cachedSearch?.expiresAt || null,
        cacheHitCountBeforeScan: cachedSearch?.hitCount ?? null,
      },
    },
  };
}

async function getTcosInventoryProvider(
  query: string,
  ai: InstaCompAiResult
): Promise<InstaCompProviderResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "not_configured",
      message: "Supabase env vars missing.",
      results: [],
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const words = query
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 2)
    .slice(0, 6);

  if (!words.length) {
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "no_matches",
      message: "Not enough query words for internal search.",
      results: [],
    };
  }

  const searchTerm = words.join(" ");

  const { data, error } = await supabase
    .from("products")
    .select("id, title, price, image_url, quantity")
    .ilike("title", `%${searchTerm}%`)
    .gt("price", 0)
    .limit(25);

  if (error) {
    console.error("TCOS internal comp search error:", error);

    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "error",
      message: "TCOS inventory search failed.",
      results: [],
    };
  }

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = (data || [])
    .filter((item: any) => item?.title && Number(item?.price) > 0)
    .map((item: any) => ({
      title: String(item.title),
      price: Number(item.price),
      currency: "USD",
      url: `/product/${item.id}`,
      imageUrl: item.image_url ? String(item.image_url) : null,
      source: "tcos_inventory" as const,
      sourceLabel: "TCOS Inventory",
      sourceCategory: "marketplace" as const,
    }));

  const results = filterAndRankExactMatches(rawComps, ai, 3, 45);

  return {
    source: "tcos_inventory",
    label: "TCOS Inventory",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? null
      : "No exact TCOS inventory matches passed the filter.",
    results,
  };
}

async function saveScanToSupabase(input: {
  imageFilename: string | null;
  ai: InstaCompAiResult;
  searchQuery: string;
  backupQueries: string[];
  stats: ReturnType<typeof calculateCompStats>;
  soldStats: ReturnType<typeof calculateCompStats>;
  links: ReturnType<typeof buildCompLinks>;
  providers: InstaCompProviderResult[];
  sourceCoverage: InstaCompSourceCoverage[];
  marketValueComps: InstaCompComp[];
  soldComps: InstaCompComp[];
  remainingCards: InstaCompComp[];
  catalogEvidence?: unknown;
}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  const allResults = input.providers.flatMap((provider) => provider.results);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabase
    .from("instacomp_scans")
    .insert({
      image_filename: input.imageFilename,

      player: input.ai.player,
      year: input.ai.year,
      brand: input.ai.brand,
      set_name: input.ai.setName,
      card_number: input.ai.cardNumber,
      parallel: input.ai.parallel,
      serial_number: input.ai.serialNumber,
      team: input.ai.team,
      sport: input.ai.sport,
      is_rookie: input.ai.isRookie,
      is_auto: input.ai.isAuto,
      is_relic: input.ai.isRelic,
      condition_guess: input.ai.conditionGuess,

      confidence: input.ai.confidence,

      search_query: input.searchQuery,
      backup_queries: input.backupQueries,

      active_low: input.stats.low,
      active_median: input.stats.median,
      active_average: input.stats.average,
      active_high: input.stats.high,
      suggested_price: input.stats.suggestedPrice,

      ebay_sold_url: input.links.ebaySoldUrl,
      ebay_active_url: input.links.ebayActiveUrl,
      one30point_url: input.links.one30pointUrl,
      comc_url: input.links.comcUrl,
      myslabs_url: input.links.myslabsUrl,
      pwcc_url: input.links.pwccUrl,
      goldin_url: input.links.goldinUrl,
      fanatics_url: input.links.fanaticsUrl,

      raw_ai_result: input.ai as any,
      raw_comp_results: {
        providers: input.providers,
        allResults,
        sourceCoverage: input.sourceCoverage,
        marketValueComps: input.marketValueComps,
        soldComps: input.soldComps,
        soldStats: input.soldStats,
        remainingCards: input.remainingCards,
        sourceLinks: input.links,
        catalogEvidence: input.catalogEvidence || null,
      } as any,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase InstaComp™ save error:", error);
    return null;
  }

  return data?.id || null;
}

function buildSourceCoverage(
  links: ReturnType<typeof buildCompLinks>,
  providers: InstaCompProviderResult[]
): InstaCompSourceCoverage[] {
  const resultCounts = new Map<string, number>();
  const allResults = providers.flatMap((provider) => provider.results);

  for (const result of allResults) {
    const key = result.sourceLabel.toLowerCase();
    resultCounts.set(key, (resultCounts.get(key) || 0) + 1);
  }

  const directProviderBySourceLabel = new Map<string, InstaCompProviderResult>();

  for (const provider of providers) {
    if (provider.label === "eBay Active") {
      directProviderBySourceLabel.set("ebay active", provider);
    }
    if (provider.label === "SportsCardsPro Guide") {
      directProviderBySourceLabel.set("sportscardspro guide", provider);
      directProviderBySourceLabel.set("sportscardspro", provider);
      directProviderBySourceLabel.set("pricecharting", provider);
    }
  }

  const externalProvider = providers.find(
    (provider) => provider.source === "external_comp_search"
  );

  const sourceCoverage = links.sourceDirectory.map<InstaCompSourceCoverage>(
    (source) => {
      const count = resultCounts.get(source.label.toLowerCase()) || 0;
      const directProvider = directProviderBySourceLabel.get(
        source.label.toLowerCase()
      );

      let status: InstaCompSourceCoverage["status"] = "registered";
      let message: string | null =
        "Registered InstaComp™ source. Live result ingestion is ready when provider access is configured.";

      if (count > 0) {
        status = "included";
        message = null;
      } else if (directProvider) {
        status =
          directProvider.status === "live" ? "no_matches" : directProvider.status;
        message = directProvider.message;
      } else if (externalProvider?.status === "not_configured") {
        status = "not_configured";
        message = externalProvider.message;
      } else if (externalProvider?.status === "error") {
        status = "error";
        message = externalProvider.message;
      } else if (externalProvider?.status === "live") {
        status = "no_matches";
        message = "External provider ran, but this source had no priced match.";
      } else if (externalProvider?.status === "no_matches") {
        status = "no_matches";
        message = externalProvider.message;
      }

      return {
        label: source.label,
        category: source.category,
        status,
        includedInMarketValue: count > 0 && source.category !== "reference",
        resultCount: count,
        message,
      };
    }
  );

  const tcosProvider = providers.find(
    (provider) => provider.source === "tcos_inventory"
  );

  if (!tcosProvider) {
    return sourceCoverage;
  }

  return [
    {
      label: tcosProvider.label,
      category: "marketplace",
      status: tcosProvider.results.length
        ? "included"
        : tcosProvider.status === "live"
          ? "no_matches"
          : tcosProvider.status,
      includedInMarketValue: tcosProvider.results.length > 0,
      resultCount: tcosProvider.results.length,
      message: tcosProvider.message,
    },
    ...sourceCoverage,
  ];
}

function isMarketValueComp(comp: InstaCompComp) {
  return comp.sourceCategory !== "reference";
}

function isExactListingGuidanceComp(comp: InstaCompComp) {
  return (
    (comp.sourceCategory === "sold" || comp.sourceCategory === "marketplace") &&
    comp.price > 0 &&
    !comp.flags.includes("excluded") &&
    !comp.flags.includes("guidance comp") &&
    !comp.flags.includes("not used for pricing")
  );
}

function isRemainingCardComp(comp: InstaCompComp) {
  return (
    comp.sourceCategory === "marketplace" ||
    comp.sourceCategory === "auction" ||
    comp.sourceCategory === "broad" ||
    comp.sourceCategory === "reference"
  );
}

type PersistentJobScanContext = {
  supabase: ReturnType<typeof requireInstaCompJobSupabase>;
  jobId: string;
  itemId: string;
  leaseToken: string;
  pairingConfidence: number | null;
};

async function downloadInstaCompJobImage(params: {
  supabase: PersistentJobScanContext["supabase"];
  path: string | null;
  fileName: string | null;
  contentType: string | null;
  expectedSizeBytes: number | null;
  expectedSha256: string | null;
  required: boolean;
  side: "front" | "back";
}) {
  if (!params.path) {
    if (params.required) {
      throw new InstaCompJobServerError(
        `The queued card is missing its ${params.side} image.`,
        409,
        "INSTACOMP_JOB_IMAGE_MISSING"
      );
    }

    return null;
  }

  const { data, error } = await params.supabase.storage
    .from(INSTACOMP_JOB_IMAGE_BUCKET)
    .download(params.path);

  if (error || !data) {
    throw new InstaCompJobServerError(
      error?.message || `Could not load the queued ${params.side} image.`,
      500,
      "INSTACOMP_JOB_IMAGE_DOWNLOAD_FAILED"
    );
  }

  const bytes = await data.arrayBuffer();

  if (
    params.expectedSizeBytes !== null &&
    bytes.byteLength !== params.expectedSizeBytes
  ) {
    throw new InstaCompJobServerError(
      `The queued ${params.side} image size does not match its registration.`,
      409,
      "INSTACOMP_JOB_IMAGE_SIZE_MISMATCH",
    );
  }

  if (params.expectedSha256) {
    const actualSha256 = createHash("sha256")
      .update(Buffer.from(bytes))
      .digest("hex");

    if (actualSha256 !== params.expectedSha256.toLowerCase()) {
      throw new InstaCompJobServerError(
        `The queued ${params.side} image failed its integrity check.`,
        409,
        "INSTACOMP_JOB_IMAGE_HASH_MISMATCH",
      );
    }
  }

  return new File(
    [bytes],
    params.fileName || `${params.side}-card.jpg`,
    { type: params.contentType || data.type || "image/jpeg" }
  );
}

async function loadPersistentJobScan(
  req: NextRequest,
  actor: Awaited<ReturnType<typeof requireInstaCompJobActor>>
) {
  const body = await req.json().catch(() => ({}));
  const jobId = requireUuid(body?.jobId, "Job ID");
  const itemId = requireUuid(body?.itemId, "Item ID");
  const leaseToken = requireUuid(body?.leaseToken, "Lease token");
  const supabase = requireInstaCompJobSupabase();

  await getAccessibleInstaCompJob({ supabase, actor, jobId });

  const { data: itemData, error } = await supabase
    .from(INSTACOMP_JOB_ITEM_TABLE)
    .select(
      [
        "id",
        "job_id",
        "status",
        "lease_token",
        "lease_expires_at",
        "front_storage_path",
        "back_storage_path",
        "front_original_filename",
        "back_original_filename",
        "front_content_type",
        "back_content_type",
        "front_size_bytes",
        "back_size_bytes",
        "front_image_sha256",
        "back_image_sha256",
        "pairing_confidence",
      ].join(",")
    )
    .eq("id", itemId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) throwInstaCompDatabaseError(error);

  const item = itemData as Record<string, any> | null;

  if (!item) {
    throw new InstaCompJobServerError(
      "The queued InstaComp™ card was not found.",
      404,
      "INSTACOMP_JOB_ITEM_NOT_FOUND"
    );
  }

  if (
    item.status !== "processing" ||
    item.lease_token !== leaseToken ||
    !item.lease_expires_at ||
    Date.parse(item.lease_expires_at) <= Date.now()
  ) {
    throw new InstaCompJobServerError(
      "The queued card lease is missing, stale, or expired.",
      409,
      "INSTACOMP_JOB_LEASE_INVALID"
    );
  }

  const [frontImage, backImage] = await Promise.all([
    downloadInstaCompJobImage({
      supabase,
      path: item.front_storage_path,
      fileName: item.front_original_filename,
      contentType: item.front_content_type,
      expectedSizeBytes: Number(item.front_size_bytes),
      expectedSha256: item.front_image_sha256 || null,
      required: true,
      side: "front",
    }),
    downloadInstaCompJobImage({
      supabase,
      path: item.back_storage_path,
      fileName: item.back_original_filename,
      contentType: item.back_content_type,
      expectedSizeBytes:
        item.back_size_bytes === null || item.back_size_bytes === undefined
          ? null
          : Number(item.back_size_bytes),
      expectedSha256: item.back_image_sha256 || null,
      required: false,
      side: "back",
    }),
  ]);

  return {
    frontImage: frontImage!,
    backImage,
    detailImageFiles: [] as File[],
    aiCouncilTier:
      typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : null,
    operatorSerialNumberOverride: normalizeOperatorSerialNumberOverride(
      body?.operatorSerialNumberOverride,
      Object.prototype.hasOwnProperty.call(body, "operatorSerialNumberOverride"),
    ),
    context: {
      supabase,
      jobId,
      itemId,
      leaseToken,
      pairingConfidence:
        item.pairing_confidence === null || item.pairing_confidence === undefined
          ? null
          : Number(item.pairing_confidence),
    } satisfies PersistentJobScanContext,
  };
}

async function finishPersistentJobScan(params: {
  context: PersistentJobScanContext;
  payload: Record<string, unknown>;
  reviewReasons: string[];
}) {
  const payload = compactPersistentScanPayload(params.payload);
  const { error } = await params.context.supabase.rpc(
    "tcos_finish_instacomp_scan_item",
    {
      p_item_id: params.context.itemId,
      p_lease_token: params.context.leaseToken,
      p_result_status: params.reviewReasons.length
        ? "review_required"
        : "completed",
      p_result_payload: payload,
      p_review_reasons: params.reviewReasons,
      p_draft_inventory_item_id: null,
    }
  );

  if (error) throwInstaCompDatabaseError(error);
}

function compactPersistentScanPayload(payload: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") <= MAX_PERSISTED_SCAN_RESULT_BYTES) {
    return payload;
  }

  const record = payload as Record<string, any>;
  const compact = {
    ...record,
    providers: Array.isArray(record.providers)
      ? record.providers.map((provider: any) => ({
          ...provider,
          results: Array.isArray(provider?.results)
            ? provider.results.slice(0, 10)
            : [],
        }))
      : [],
    activeComps: Array.isArray(record.activeComps)
      ? record.activeComps.slice(0, 25)
      : [],
    marketValueComps: Array.isArray(record.marketValueComps)
      ? record.marketValueComps.slice(0, 25)
      : [],
    soldComps: Array.isArray(record.soldComps)
      ? record.soldComps.slice(0, 25)
      : [],
    remainingCards: Array.isArray(record.remainingCards)
      ? record.remainingCards.slice(0, 25)
      : [],
    persistedResultCompacted: true,
  };

  if (Buffer.byteLength(JSON.stringify(compact), "utf8") <= MAX_PERSISTED_SCAN_RESULT_BYTES) {
    return compact;
  }

  return {
    ok: record.ok,
    scanId: record.scanId,
    ai: record.ai,
    ocrDiagnostics: record.ocrDiagnostics,
    searchQuery: record.searchQuery,
    backupQueries: record.backupQueries,
    links: record.links,
    sourceCoverage: record.sourceCoverage,
    stats: record.stats,
    soldStats: record.soldStats,
    queue: record.queue,
    note: record.note,
    providers: [],
    activeComps: [],
    marketValueComps: [],
    soldComps: [],
    remainingCards: [],
    persistedResultCompacted: true,
  };
}

async function failPersistentJobScan(
  context: PersistentJobScanContext,
  error: unknown
) {
  const message = error instanceof Error ? error.message : "InstaComp™ scan failed.";
  const { error: persistenceError } = await context.supabase.rpc(
    "tcos_fail_instacomp_scan_item",
    {
      p_item_id: context.itemId,
      p_lease_token: context.leaseToken,
      p_error_code: "scan_failed",
      p_error_message: message.slice(0, 4000),
      p_retryable: true,
      p_retry_delay_seconds: 5,
    }
  );

  if (persistenceError) {
    console.error("Could not persist InstaComp™ queued scan failure:", persistenceError);
  }
}

export async function POST(req: NextRequest) {
  let persistentContext: PersistentJobScanContext | null = null;
  let requestedAiCouncilTier: string | null = null;
  let operatorSerialNumberOverride: string | null | undefined = undefined;

  try {
    const actor = await requireInstaCompJobActor(req);
    const rateLimit = await checkPublicEndpointRateLimit({
      request: req,
      endpointKey: "instacomp_scan",
      subjectKey:
        actor.type === "seller"
          ? `seller:${actor.sellerAccountId}`
          : `admin:${actor.storeId}`,
      maxAttempts: 1200,
      windowSeconds: 24 * 60 * 60,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(blocked.body, { status: blocked.status });
    }
    const isJsonRequest = (req.headers.get("content-type") || "")
      .toLowerCase()
      .includes("application/json");
    let frontImage: File | null = null;
    let backImage: File | null = null;
    let detailImageFiles: File[] = [];

    if (isJsonRequest) {
      const queuedScan = await loadPersistentJobScan(req, actor);
      frontImage = queuedScan.frontImage;
      backImage = queuedScan.backImage;
      detailImageFiles = queuedScan.detailImageFiles;
      persistentContext = queuedScan.context;
      requestedAiCouncilTier = queuedScan.aiCouncilTier;
      operatorSerialNumberOverride = queuedScan.operatorSerialNumberOverride;
    } else {
      const formData = await req.formData();
      const submittedFront = formData.get("frontImage");
      const submittedBack = formData.get("backImage");
      const submittedAiCouncilTier = formData.get("aiCouncilTier");
      const submittedOperatorSerialNumberOverride = formData.get(
        "operatorSerialNumberOverride",
      );

      frontImage = submittedFront instanceof File ? submittedFront : null;
      backImage = submittedBack instanceof File ? submittedBack : null;
      requestedAiCouncilTier =
        typeof submittedAiCouncilTier === "string" ? submittedAiCouncilTier : null;
      operatorSerialNumberOverride = normalizeOperatorSerialNumberOverride(
        submittedOperatorSerialNumberOverride,
        typeof submittedOperatorSerialNumberOverride === "string",
      );
      detailImageFiles = formData
        .getAll("detailImages")
        .filter((file): file is File => file instanceof File && file.size > 0)
        .slice(0, 24);
    }

    if (!(frontImage instanceof File)) {
      return jsonError("Upload a front card image.", 400);
    }

    if (!ALLOWED_SCAN_IMAGE_TYPES.has(frontImage.type.toLowerCase())) {
      throw new InstaCompJobServerError(
        "Front file must be a JPEG, PNG, or WebP image.",
        400,
        "INSTACOMP_SCAN_IMAGE_TYPE_INVALID"
      );
    }

    if (frontImage.size > MAX_SCAN_SOURCE_IMAGE_BYTES) {
      throw new InstaCompJobServerError(
        "Front card image must be 12MB or smaller.",
        413,
        "INSTACOMP_SCAN_IMAGE_TOO_LARGE"
      );
    }

    let backImageForScan: File | null = null;

    if (backImage instanceof File && backImage.size > 0) {
      if (!ALLOWED_SCAN_IMAGE_TYPES.has(backImage.type.toLowerCase())) {
        throw new InstaCompJobServerError(
          "Back file must be a JPEG, PNG, or WebP image.",
          400,
          "INSTACOMP_SCAN_IMAGE_TYPE_INVALID"
        );
      }

      if (backImage.size > MAX_SCAN_SOURCE_IMAGE_BYTES) {
        throw new InstaCompJobServerError(
          "Back card image must be 12MB or smaller.",
          413,
          "INSTACOMP_SCAN_IMAGE_TOO_LARGE"
        );
      }

      backImageForScan = backImage;
    }

    const detailImageJobs = detailImageFiles.map(async (detailImage) => {
      if (!ALLOWED_SCAN_IMAGE_TYPES.has(detailImage.type.toLowerCase())) {
        throw new InstaCompJobServerError(
          "Detail crops must be JPEG, PNG, or WebP images.",
          400,
          "INSTACOMP_SCAN_IMAGE_TYPE_INVALID"
        );
      }

      if (detailImage.size > MAX_SCAN_DETAIL_IMAGE_BYTES) {
        throw new InstaCompJobServerError(
          "Each InstaComp™ detail crop must be 512KB or smaller.",
          413,
          "INSTACOMP_SCAN_DETAIL_TOO_LARGE"
        );
      }

      return {
        name: detailImage.name || "detail-crop.jpg",
        dataUrl: await fileToDataUrl(detailImage),
      } satisfies InstaCompDetailImage;
    });

    const [frontDataUrl, backDataUrl, detailImages] = await Promise.all([
      fileToDataUrl(frontImage),
      backImageForScan ? fileToDataUrl(backImageForScan) : Promise.resolve(undefined),
      Promise.all(detailImageJobs),
    ]);

    const totalInputBytes =
      frontImage.size +
      (backImage?.size || 0) +
      detailImageFiles.reduce((total, file) => total + file.size, 0);

    if (totalInputBytes > MAX_SCAN_INPUT_BYTES) {
      throw new InstaCompJobServerError(
        "One InstaComp™ card scan may contain at most 20MB of image data.",
        413,
        "INSTACOMP_SCAN_INPUT_TOO_LARGE"
      );
    }

    const externalOcrImages: InstaCompDetailImage[] = [
      { name: "front-full-card", dataUrl: frontDataUrl },
      ...(backDataUrl ? [{ name: "back-full-card", dataUrl: backDataUrl }] : []),
      ...detailImages,
    ];
    const externalOcr = await getBestExternalOcr(externalOcrImages);
    const preflightSerialOcrPromise = shouldPreflightSerialVision({
      externalOcr,
      requestedTier: requestedAiCouncilTier,
    })
      ? detectSerialNumberWithOpenAI(
          frontDataUrl,
          backDataUrl,
          detailImages.slice(0, 16),
          externalOcr
        )
      : null;

    const baseAi = mergeGradingDetection(
      await identifyCardWithOpenAI(
        frontDataUrl,
        backDataUrl,
        detailImages.slice(0, 8),
        externalOcr
      ),
      externalOcr
    );
    const serialOcr =
      (preflightSerialOcrPromise
        ? await preflightSerialOcrPromise
        : shouldRunSerialVision({
              ai: baseAi,
              externalOcr,
              requestedTier: requestedAiCouncilTier,
            })
          ? await detectSerialNumberWithOpenAI(
              frontDataUrl,
              backDataUrl,
              detailImages.slice(0, 16),
              externalOcr
            )
          : null);
    const baseAiForConsensus = applyOperatorSerialNumberOverride(
      baseAi,
      operatorSerialNumberOverride,
    );
    const consensusSerialOcr =
      operatorSerialNumberOverride === undefined
        ? serialOcr
        : operatorSerialNumberOverride
          ? {
              serialNumber: operatorSerialNumberOverride,
              confidence: 1,
              checkedImages: 0,
              evidence: "Operator serial override.",
            }
          : null;
    const mergedSerialAi = applyOperatorSerialNumberOverride(
      mergeSerialOcrResult(baseAi, serialOcr),
      operatorSerialNumberOverride,
    );
    const guardedAi = applyInstaCompIdentityGuard(mergedSerialAi, {
      externalOcrText: externalOcr?.text || null,
    });
    const catalogEvidence = buildInstaCompCuratedChecklistEvidence({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
    });
    const catalogReferee = catalogEvidenceToConsensusReferee(catalogEvidence);
    const consensusEscalation = decideInstaCompConsensusEscalation({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
      hasBackImage: Boolean(backDataUrl),
      pairingConfidence: persistentContext?.pairingConfidence ?? null,
    });
    const aiCouncilRaw = await runInstaCompAiCouncil({
      runSecondaryVision: consensusEscalation.runSecondaryVision,
      requestedTier: requestedAiCouncilTier,
      frontDataUrl,
      backDataUrl,
      detailImages,
      externalOcr,
    });
    const aiCouncil: InstaCompAiCouncilRun = {
      ...aiCouncilRaw,
      readers: aiCouncilRaw.readers.map((reader) => ({
        ...reader,
        ai: applyInstaCompIdentityGuard(
          applyOperatorSerialNumberOverride(
            mergeGradingDetection(mergeSerialOcrResult(reader.ai, serialOcr), externalOcr),
            operatorSerialNumberOverride,
          ),
          {
            externalOcrText: externalOcr?.text || null,
          },
        ),
      })),
    };

    const consensusReaders = buildInstaCompConsensusReaders({
      baseAi: baseAiForConsensus,
      mergedSerialAi,
      guardedAi,
      aiCouncil,
      serialOcr: consensusSerialOcr,
      externalOcr,
    });
    const consensus = buildInstaCompMultiScannerConsensus({
      readers: consensusReaders,
      baseIdentity: guardedAi,
      catalogReferee,
      escalation: consensusEscalation,
    });
    const ai = applyInstaCompConsensusToAi(guardedAi, consensus);

    const queries = buildInstaCompQueries(ai);
    const links = buildCompLinks(queries.primary);
    const compQueries = [queries.primary, ...queries.backupQueries];

    const [
      ebayProvider,
      tcosProvider,
      priceChartingProvider,
      externalSearchProvider,
    ] =
      await Promise.all([
        getBestEbayProvider(compQueries, ai, links.ebayActiveUrl),
        getTcosInventoryProvider(queries.primary, ai),
        getPriceChartingProvider(queries.primary, ai),
        getExternalSearchProvider(queries.primary, ai, links.broadCardMarketUrl),
      ]);

    const providers = [
      ebayProvider,
      tcosProvider,
      priceChartingProvider,
      externalSearchProvider,
    ];

    const allLiveComps = providers.flatMap((provider) => provider.results);
    const rawMarketValueComps = allLiveComps.filter(isMarketValueComp);
    const rawSoldComps = allLiveComps.filter(
      (comp) => comp.sourceCategory === "sold"
    );
    const remainingCards = allLiveComps
      .filter(isRemainingCardComp)
      .sort((left, right) => left.price - right.price);
    const rawStats = calculateCompStats(rawMarketValueComps);
    const rawSoldStats = calculateCompStats(rawSoldComps);
    const scanReview = buildInstaCompScanReview({
      ai,
      stats: rawStats,
      marketValueComps: rawMarketValueComps,
      hasBackImage: Boolean(backDataUrl),
      pairingConfidence: persistentContext?.pairingConfidence ?? null,
      externalOcrText: externalOcr?.text || null,
      consensus,
    });
    const exactListingGuidanceComps = rawMarketValueComps.filter(
      isExactListingGuidanceComp
    );
    const canUseListingGuidance =
      scanReview.trustedForPricing || exactListingGuidanceComps.length > 0;
    const marketValueComps = canUseListingGuidance ? rawMarketValueComps : [];
    const soldComps = canUseListingGuidance ? rawSoldComps : [];
    const stats = canUseListingGuidance ? rawStats : calculateCompStats([]);
    const soldStats = canUseListingGuidance
      ? rawSoldStats
      : calculateCompStats([]);
    const sourceCoverage = buildSourceCoverage(links, providers);

    const scanId = await saveScanToSupabase({
      imageFilename: frontImage.name || null,
      ai,
      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      stats,
      soldStats,
      links,
      providers,
      sourceCoverage,
      marketValueComps,
      soldComps,
      remainingCards,
      catalogEvidence,
    });

    const reviewReasons = scanReview.reviewReasons;
    const responsePayload = {
      ok: true,
      scanId,
      ai,
      review: scanReview,
      consensus,
      consensusEscalation,
      catalogEvidence,
      ocrDiagnostics: {
        paddleOcrConfigured: Boolean(PADDLEOCR_API_URL),
        googleVisionConfigured: Boolean(GOOGLE_VISION_API_KEY),
        provider: externalOcr?.provider || null,
        checkedImages: externalOcr?.checkedImages || 0,
        speedLane: consensusEscalation.speedLane,
        councilMode: consensusEscalation.councilMode,
        consensusRiskTier: consensusEscalation.riskTier,
        scannerPlan: consensusEscalation.scannerPlan,
        secondaryVisionRan: aiCouncil.completedReaders > 0,
        secondaryVisionReasons: consensusEscalation.reasons,
        aiCouncil,
        extractedSerialNumber: externalOcr?.serialNumber || null,
        serialVisionMode: normalizedSerialVisionMode(),
        serialVisionSkipped: !serialOcr,
        serialVisionCheckedImages: serialOcr?.checkedImages || 0,
        serialVisionSerialNumber: serialOcr?.serialNumber || ai.serialNumber || null,
        serialVisionEvidence: serialOcr?.evidence || null,
        gradingCompany: ai.gradingCompany || null,
        gradeValue: ai.gradeValue || null,
        certificationNumber: ai.certificationNumber || null,
        certificationLookupUrl: ai.certificationLookupUrl || null,
        gradingEvidence: ai.gradingEvidence || null,
        operatorSerialNumberOverride:
          operatorSerialNumberOverride === undefined
            ? null
            : operatorSerialNumberOverride,
        textExcerpt: externalOcr?.text ? externalOcr.text.slice(0, 1200) : null,
      },
      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      links,
      providers,
      sourceCoverage,
      activeComps: allLiveComps,
      marketValueComps,
      soldComps,
      soldStats,
      remainingCards,
      stats,
      note:
        scanReview.trustedForPricing
          ? "Market value, high, low, and sold ranges are calculated from included live matches only. Registered sources remain visible until provider access is configured."
          : canUseListingGuidance
            ? "InstaComp™ found exact active marketplace listing guidance. Sold comps may still be unavailable, so review the row before trusting market value, draft title, activation, or comps."
          : "InstaComp™ found provider candidates, but exact card identity/pricing evidence is not strong enough. Review the row before trusting market value, draft title, activation, or comps.",
      ...(persistentContext
        ? {
            queue: {
              jobId: persistentContext.jobId,
              itemId: persistentContext.itemId,
              status: reviewReasons.length ? "review_required" : "completed",
              reviewReasons,
            },
          }
        : {}),
    };

    if (persistentContext) {
      await finishPersistentJobScan({
        context: persistentContext,
        payload: responsePayload,
        reviewReasons,
      });
    }

    return NextResponse.json(responsePayload);
  } catch (error: any) {
    console.error("InstaComp™ scan error:", error);

    if (persistentContext) {
      await failPersistentJobScan(persistentContext, error);
    }

    if (
      error?.name === "InstaCompJobServerError" ||
      String(error?.code || "").startsWith("INSTACOMP_")
    ) {
      return instaCompJobErrorResponse(error);
    }

    return jsonError(
      error?.message || "InstaComp™ scan failed.",
      500,
      process.env.NODE_ENV === "development" ? error : undefined
    );
  }
}
