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
  looksLikeBadCompTitle,
} from "../../../../lib/instacomp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INSTACOMP_OPENAI_MODEL =
  process.env.INSTACOMP_OPENAI_MODEL || "gpt-4.1";
const INSTACOMP_OPENAI_FALLBACK_MODEL =
  process.env.INSTACOMP_OPENAI_FALLBACK_MODEL ||
  process.env.OPENAI_MODEL ||
  "gpt-4.1-mini";

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const COMC_APIFY_ACTOR_ID =
  process.env.COMC_APIFY_ACTOR_ID || "lulzasaur/comc-scraper";

const GOOGLE_CSE_API_KEY =
  process.env.GOOGLE_CSE_API_KEY || process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
const GOOGLE_CSE_CX =
  process.env.GOOGLE_CSE_CX || process.env.GOOGLE_CUSTOM_SEARCH_CX;
const GOOGLE_VISION_API_KEY =
  process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_CLOUD_VISION_API_KEY;
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const requestedExternalSearchLimit = Number(
  process.env.INSTACOMP_EXTERNAL_SEARCH_LIMIT || 15
);
const EXTERNAL_SEARCH_LIMIT = Number.isFinite(requestedExternalSearchLimit)
  ? Math.max(1, Math.min(requestedExternalSearchLimit, 25))
  : 15;
const EXTERNAL_SEARCH_CACHE_TTL_DAYS = 7;

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
  const normalized = normalizeOcrText(text);
  const candidates = [
    ...normalized.matchAll(
      /\b(?:serial\s*(?:no\.?|number)?\s*)?([0-9O]{1,4})\s*(?:\/|of)\s*([0-9O]{1,4})\b/gi
    ),
  ];

  for (const candidate of candidates) {
    const numerator = candidate[1].replace(/O/gi, "0");
    const denominator = candidate[2].replace(/O/gi, "0");

    if (!Number.isFinite(Number(numerator)) || !Number.isFinite(Number(denominator))) {
      continue;
    }

    if (Number(denominator) <= 1 && Number(numerator) !== 1) continue;

    return `${numerator}/${denominator}`;
  }

  if (/\b(?:one\s+of\s+one|1\s+of\s+1|1\/1)\b/i.test(normalized)) {
    return "1/1";
  }

  return null;
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

async function identifyCardWithOpenAI(
  frontDataUrl: string,
  backDataUrl?: string,
  detailImages: InstaCompDetailImage[] = [],
  externalOcr: ExternalOcrResult | null = null
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
2. Read the back second for copyright year, printed card number, set/subset name, team, manufacturer text, and tiny serial-number stamps.
3. Serial numbers are often foil-stamped and tiny. Inspect both images for formats like 7/25, 07/50, 007/199, 1 of 1, one-of-one, /5, /10, /25, /49, /50, /75, /99, /100, /149, /150, /199, /250, /299, /399, /499, /999. Return the exact visible format in serialNumber.
4. Parallel matters for price. If a visible design cue strongly indicates the parallel, return the best collector-market name in parallel, such as "Silver Prizm", "Green Prizm", "Blue Refractor", "Gold Wave", "Orange Ice", "Purple Shimmer", "Red White Blue Prizm", "Holo", "Refractor", "Chrome Refractor", "Mosaic Reactive Orange", "Sepia Refractor", "X-Fractor", "Atomic Refractor", or "Base".
5. Use "Base" only when the card appears to be the normal base version and there are no visible special foil/color/numbering cues. Use null only when the image quality prevents a fair call.
6. Do not hallucinate serial numbers. Only return serialNumber when visible or explicitly printed/stamped.
7. Do not overclaim exact parallels. If the color/finish is visible but the exact market name is uncertain, use a cautious descriptive value like "Blue parallel - exact type uncertain" instead of null.
8. If front/back disagree, prefer the printed back for card number/year/set, and explain the conflict in notes.
9. If the image is not a sports card, still describe what it appears to be and lower confidence.

Field rules:
- Confidence must be between 0 and 1.
- player, year, brand, setName, cardNumber, parallel, serialNumber, team, sport, conditionGuess, and notes may be null only when not visible/inferable.
- notes must include short evidence for parallel and serial-number decisions, for example: "Parallel evidence: green prizm border. Serial evidence: visible 07/50 stamp on back." If absent, say what was checked.
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
    ...(externalOcr?.text
      ? [
          {
            type: "text",
            text: `OCR TEXT EXTRACTED FROM FRONT/BACK/CROPS (${externalOcr.provider}, ${externalOcr.checkedImages} image(s)): ${externalOcr.text.slice(0, 6000)} Use this text heavily for exact player, set, card number, copyright year, manufacturer, parallel wording, and serial number.`,
          },
        ]
      : []),
    {
      type: "text",
      text: "FRONT IMAGE: inspect player, product line, rookie logo, color/foil/refractor/prizm/parallel cues, autograph/relic cues, and visible serial stamp.",
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
      text: "BACK IMAGE: inspect copyright year, manufacturer text, set/subset, printed card number, team, odds text, and tiny foil serial-number stamps.",
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
      text: "ZOOM DETAIL IMAGES: these are cropped closeups from the same card images. Prioritize these for serial-number OCR, foil stamps, color/parallel names, and tiny printed identifiers. If a serial number is visible in any crop, return it exactly.",
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
    new Set([INSTACOMP_OPENAI_MODEL, INSTACOMP_OPENAI_FALLBACK_MODEL].filter(Boolean))
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

  const parsed = JSON.parse(text) as InstaCompAiResult;

  return {
    ...parsed,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
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

  if (!OPENAI_API_KEY || !detailImages.length) return null;

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
    text: "FULL FRONT IMAGE for context only. Prefer close-up crops for OCR.",
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
      text: "FULL BACK IMAGE for context only. Prefer close-up crops for OCR.",
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
    new Set([INSTACOMP_OPENAI_MODEL, INSTACOMP_OPENAI_FALLBACK_MODEL].filter(Boolean))
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
    console.error("InstaComp serial OCR failed:", errorText);
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
        : detailImages.length,
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

async function getEbayAppToken() {
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    return null;
  }

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

  return data?.access_token || null;
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
      };
    })
    .filter((item: Omit<InstaCompComp, "matchScore" | "flags">) => {
      if (!item.title || !item.url || !item.price) return false;
      if (looksLikeBadCompTitle(item.title, ai)) return false;

      return true;
    });

  const results = filterAndRankExactMatches(rawComps, ai, 3, 55);

  return {
    source: "ebay_active",
    label: "eBay Active",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? null
      : "No exact raw matches passed the InstaComp™ filter.",
    results,
    searchUrl,
  };
}

function extractComcPrice(item: any) {
  const raw =
    item?.price ??
    item?.askingPrice ??
    item?.salePrice ??
    item?.lowestPrice ??
    item?.listPrice ??
    item?.priceText;

  if (typeof raw === "number") return raw;

  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function extractComcUrl(item: any) {
  return (
    item?.url ||
    item?.listingUrl ||
    item?.cardUrl ||
    item?.productUrl ||
    item?.href ||
    ""
  );
}

function extractComcImage(item: any) {
  return (
    item?.image ||
    item?.imageUrl ||
    item?.thumbnail ||
    item?.thumbnailUrl ||
    item?.frontImage ||
    null
  );
}

function extractComcTitle(item: any) {
  return (
    item?.title ||
    item?.name ||
    item?.cardTitle ||
    [
      item?.year,
      item?.set,
      item?.player,
      item?.subject,
      item?.cardNumber ? `#${item.cardNumber}` : null,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

async function getComcProvider(
  query: string,
  ai: InstaCompAiResult,
  searchUrl: string
): Promise<InstaCompProviderResult> {
  if (!APIFY_TOKEN) {
    return {
      source: "comc_active",
      label: "COMC Active",
      status: "not_configured",
      message: "Missing APIFY_TOKEN in .env.local.",
      results: [],
      searchUrl,
    };
  }

  const actorIdForUrl = COMC_APIFY_ACTOR_ID.replace("/", "~");
  const endpoint = `https://api.apify.com/v2/acts/${actorIdForUrl}/run-sync-get-dataset-items?token=${encodeURIComponent(
    APIFY_TOKEN
  )}`;

  const input = {
    searchQueries: [query],
    maxResults: 25,
    scrapeDetails: false,
    proxyConfiguration: {
      useApifyProxy: false,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("COMC Apify error:", errorText);

      return {
        source: "comc_active",
        label: "COMC Active",
        status: "error",
        message:
          "COMC Apify actor failed. Check Apify token, actor access, or credits.",
        results: [],
        searchUrl,
      };
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : [];

    const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = items
      .map((item: any) => {
        const title = String(extractComcTitle(item) || "");
        const price = extractComcPrice(item);
        const url = String(extractComcUrl(item) || "");
        const imageUrl = extractComcImage(item);

        return {
          title,
          price,
          currency: "USD",
          url,
          imageUrl: imageUrl ? String(imageUrl) : null,
          source: "comc_active" as const,
          sourceLabel: "COMC Active",
          sourceCategory: "marketplace" as const,
        };
      })
      .filter((item) => {
        if (!item.title || !item.price) return false;
        if (looksLikeBadCompTitle(item.title, ai)) return false;

        return true;
      });

    let results = filterAndRankExactMatches(rawComps, ai, 3, 25);

    if (!results.length) {
      results = rawComps
        .map((comp) => ({
          ...comp,
          matchScore: 1,
          flags: ["review needed", "COMC returned but filter rejected"],
        }))
        .filter((comp) => comp.price > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, 3);
    }

    return {
      source: "comc_active",
      label: "COMC Active",
      status: results.length ? "live" : "no_matches",
      message: results.length
        ? "COMC returned these as review-needed candidates. We still need to tune exact matching."
        : "COMC returned no usable priced results.",
      results,
      searchUrl,
    };
  } catch (error) {
    console.error("COMC provider exception:", error);

    return {
      source: "comc_active",
      label: "COMC Active",
      status: "error",
      message: "COMC provider threw an error.",
      results: [],
      searchUrl,
    };
  }
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
    console.error("InstaComp cache read error:", error);
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
    console.error("InstaComp cache write error:", error);
  }
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
  { label: "Sportlots", domain: "sportlots.com", category: "marketplace" },
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
      console.error("Google CSE InstaComp error:", await response.text());

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
    console.error("Google CSE InstaComp exception:", error);

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
      console.error("SerpApi InstaComp error:", await response.text());

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
    console.error("SerpApi InstaComp exception:", error);

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

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = searchItems
    .map((item) => {
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
      } as any,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase InstaComp save error:", error);
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

    if (provider.label === "COMC Active") {
      directProviderBySourceLabel.set("comc", provider);
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
        "Registered InstaComp source. Live result ingestion is ready when provider access is configured.";

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

function isRemainingCardComp(comp: InstaCompComp) {
  return (
    comp.sourceCategory === "marketplace" ||
    comp.sourceCategory === "auction" ||
    comp.sourceCategory === "broad"
  );
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const frontImage = formData.get("frontImage");
    const backImage = formData.get("backImage");
    const detailImageFiles = formData
      .getAll("detailImages")
      .filter((file): file is File => file instanceof File && file.size > 0)
      .slice(0, 24);

    if (!(frontImage instanceof File)) {
      return jsonError("Upload a front card image.", 400);
    }

    if (!frontImage.type.startsWith("image/")) {
      return jsonError("Front file must be an image.", 400);
    }

    const frontDataUrl = await fileToDataUrl(frontImage);

    let backDataUrl: string | undefined;

    if (backImage instanceof File && backImage.size > 0) {
      if (!backImage.type.startsWith("image/")) {
        return jsonError("Back file must be an image.", 400);
      }

      backDataUrl = await fileToDataUrl(backImage);
    }

    const detailImages: InstaCompDetailImage[] = [];

    for (const detailImage of detailImageFiles) {
      if (!detailImage.type.startsWith("image/")) {
        return jsonError("Detail crop files must be images.", 400);
      }

      detailImages.push({
        name: detailImage.name || "detail-crop.jpg",
        dataUrl: await fileToDataUrl(detailImage),
      });
    }

    const externalOcrImages: InstaCompDetailImage[] = [
      { name: "front-full-card", dataUrl: frontDataUrl },
      ...(backDataUrl ? [{ name: "back-full-card", dataUrl: backDataUrl }] : []),
      ...detailImages,
    ];
    const externalOcr = await getGoogleVisionOcr(externalOcrImages);

    const baseAi = await identifyCardWithOpenAI(
      frontDataUrl,
      backDataUrl,
      detailImages.slice(0, 8),
      externalOcr
    );
    const serialOcr = await detectSerialNumberWithOpenAI(
      frontDataUrl,
      backDataUrl,
      detailImages,
      externalOcr
    );
    const ai = mergeSerialOcrResult(baseAi, serialOcr);

    const queries = buildInstaCompQueries(ai);
    const links = buildCompLinks(queries.primary);

    const [ebayProvider, comcProvider, tcosProvider, externalSearchProvider] =
      await Promise.all([
        getEbayProvider(queries.primary, ai, links.ebayActiveUrl),
        getComcProvider(queries.primary, ai, links.comcUrl),
        getTcosInventoryProvider(queries.primary, ai),
        getExternalSearchProvider(queries.primary, ai, links.broadCardMarketUrl),
      ]);

    const providers = [
      ebayProvider,
      comcProvider,
      tcosProvider,
      externalSearchProvider,
    ];

    const allLiveComps = providers.flatMap((provider) => provider.results);
    const marketValueComps = allLiveComps.filter(isMarketValueComp);
    const soldComps = allLiveComps.filter(
      (comp) => comp.sourceCategory === "sold"
    );
    const remainingCards = allLiveComps
      .filter(isRemainingCardComp)
      .sort((left, right) => left.price - right.price);
    const stats = calculateCompStats(marketValueComps);
    const soldStats = calculateCompStats(soldComps);
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
    });

    return NextResponse.json({
      ok: true,
      scanId,
      ai,
      ocrDiagnostics: {
        googleVisionConfigured: Boolean(GOOGLE_VISION_API_KEY),
        provider: externalOcr?.provider || null,
        checkedImages: externalOcr?.checkedImages || 0,
        extractedSerialNumber: externalOcr?.serialNumber || null,
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
        "Market value, high, low, and sold ranges are calculated from included live matches only. Registered sources remain visible until provider access is configured.",
    });
  } catch (error: any) {
    console.error("InstaComp scan error:", error);

    return jsonError(
      error?.message || "InstaComp scan failed.",
      500,
      process.env.NODE_ENV === "development" ? error : undefined
    );
  }
}
