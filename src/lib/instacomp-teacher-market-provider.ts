import { getVercelOidcToken } from "@vercel/oidc";
import type {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
} from "./instacomp";
import { filterStrictExactMarketMatches } from "./instacomp-exact-market-provider";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";
import {
  buildFreeCriticPrompt,
  runCloudflareCritic,
  runGroqBrowserTeacher,
  runOpenRouterCritic,
} from "./instacomp-free-comp-teachers";
import {
  requestInstaCompStudentCompHypothesis,
  type InstaCompStudentCompHypothesis,
} from "./instacomp-student-comp-bridge";

const GEMINI_API_KEY = String(
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || "",
).trim();
const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || "").trim();
const XAI_API_KEY = String(process.env.XAI_API_KEY || "").trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const PERPLEXITY_API_KEY = String(process.env.PERPLEXITY_API_KEY || "").trim();
const AI_GATEWAY_TOKEN = String(
  process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "",
).trim();

function gatewayPlatformAvailable() {
  return Boolean(AI_GATEWAY_TOKEN || process.env.VERCEL === "1");
}

async function gatewayBearerToken() {
  if (AI_GATEWAY_TOKEN) return AI_GATEWAY_TOKEN;
  if (process.env.VERCEL !== "1") return "";
  return String(await getVercelOidcToken()).trim();
}
const DIRECT_GEMINI_DISABLED =
  String(process.env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() === "true";
const GATEWAY_GEMINI_DISABLED =
  String(process.env.INSTACOMP_GATEWAY_GEMINI_DISABLED || "").trim().toLowerCase() === "true";

const GEMINI_MODEL = String(
  process.env.INSTACOMP_TEACHER_GEMINI_MODEL || "gemini-3.6-flash",
).trim();
const ANTHROPIC_MODEL = String(
  process.env.INSTACOMP_TEACHER_ANTHROPIC_MODEL || "claude-sonnet-4-6",
).trim();
const XAI_MODEL = String(
  process.env.INSTACOMP_TEACHER_XAI_MODEL || "grok-4.5",
).trim();
const GROQ_MODEL = String(
  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound-mini",
).trim();
const GATEWAY_PERPLEXITY_MODEL = String(
  process.env.INSTACOMP_GATEWAY_PERPLEXITY_MODEL || "perplexity/sonar",
).trim();
const GATEWAY_GEMINI_MODEL = String(
  process.env.INSTACOMP_GATEWAY_GEMINI_MODEL || "google/gemini-2.5-flash-lite",
).trim();
const TEACHER_TIMEOUT_MS = 120_000;
const MAX_ROWS_PER_TEACHER = 8;
const TEACHER_MARKET_DOMAINS = ["ebay.com", "130point.com", "psacard.com"];

export type TeacherName =
  | "gemini"
  | "gateway_gemini"
  | "anthropic"
  | "xai"
  | "groq"
  | "groq_browser"
  | "gateway_perplexity"
  | "perplexity"
  | "openrouter"
  | "cloudflare";

type TeacherMarketRow = {
  title: string;
  itemPrice: number;
  shippingPrice: number;
  url: string;
  imageUrl: string | null;
  soldAt: string | null;
  listedAt: string | null;
  identityEvidence: string;
};

type TeacherPayload = {
  sold: TeacherMarketRow[];
  active: TeacherMarketRow[];
  notes: string;
};

type TeacherAttempt = {
  teacher: TeacherName;
  configured: boolean;
  ok: boolean;
  sold: TeacherMarketRow[];
  active: TeacherMarketRow[];
  notes: string;
  error: string | null;
};

export type TeacherConsensusMarketResult = {
  studentHypothesis: InstaCompStudentCompHypothesis;
  configuredTeachers: TeacherName[];
  requiredVotes: number;
  attempts: Array<{
    teacher: TeacherName;
    configured: boolean;
    ok: boolean;
    soldCount: number;
    activeCount: number;
    notes: string;
    error: string | null;
  }>;
  sold: InstaCompProviderResult;
  active: InstaCompProviderResult;
  discovery: {
    sold: InstaCompComp[];
    active: InstaCompComp[];
  };
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonObject(value: string): TeacherPayload {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Teacher returned no JSON object.");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  return normalizePayload(parsed);
}

function validDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function directEbayItemUrl(value: unknown) {
  try {
    const url = new URL(clean(value));
    if (!/(^|\.)ebay\.com$/i.test(url.hostname)) return null;
    const itemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:\/|$)/i)?.[1];
    return itemId ? `https://www.ebay.com/itm/${itemId}` : null;
  } catch {
    return null;
  }
}

function normalizeRows(value: unknown, lane: "sold" | "active") {
  if (!Array.isArray(value)) return [] as TeacherMarketRow[];
  return value
    .slice(0, MAX_ROWS_PER_TEACHER)
    .map((raw): TeacherMarketRow | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const title = clean(row.title);
      const url = directEbayItemUrl(row.url);
      const itemPrice = money(row.itemPrice);
      const shippingPrice = money(row.shippingPrice);
      const soldAt = lane === "sold" ? validDate(row.soldAt) : null;
      const listedAt = lane === "active" ? validDate(row.listedAt) : null;
      if (!title || !url || itemPrice === null || shippingPrice === null) return null;
      if (lane === "sold" && !soldAt) return null;
      return {
        title,
        itemPrice,
        shippingPrice,
        url,
        imageUrl: clean(row.imageUrl) || null,
        soldAt,
        listedAt,
        identityEvidence: clean(row.identityEvidence).slice(0, 1000),
      };
    })
    .filter((row): row is TeacherMarketRow => Boolean(row));
}

function normalizePayload(value: unknown): TeacherPayload {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    sold: normalizeRows(record.sold, "sold"),
    active: normalizeRows(record.active, "active"),
    notes: clean(record.notes).slice(0, 2000),
  };
}

function teacherPrompt(exactTitle: string, ai: InstaCompAiResult) {
  return [
    "You are an independent sports-card market teacher for Truely Collectables InstaComp.",
    "Search the live web. eBay sold/completed listings are the primary target; 130point may be used only to corroborate an eBay sale.",
    "For PSA-graded cards, also inspect psacard.com Auction Prices Realized and PSA cert Sales History as independent identity and realized-sale evidence. PSA Estimate and PSA Price Guide values are reference-only and are NEVER sold comps. If PSA corroborates an eBay sale, return the direct eBay item URL only after the exact PSA card identity and PSA grade match.",
    "The local InstaComp AI is a STUDENT and must not be treated as authority. The identity JSON below is the canonical target supplied by the verified InstaComp Registry/workflow.",
    "Never return a similar card. Player, year/season, manufacturer/brand/product, exact set/insert, card number, parallel/variation, print-run denominator, autograph/relic state, raw/graded state, grading company and grade must match whenever applicable.",
    "A /199 card is never a comp for /299. A numbered card is never a comp for an unnumbered card. A different insert/set is never a comp even when player and card number look similar.",
    "Open and inspect the direct listing evidence. Use listing images when available. Seller titles are clues, not ground truth.",
    "Return only direct ebay.com/itm/<item-id> URLs. Do not invent URLs, prices, shipping, dates, images, or sold status.",
    "For sold rows, soldAt is required and shippingPrice must be known; use 0 only when free shipping is explicit.",
    "For active rows, return only currently purchasable exact matches.",
    "If exact proof is unavailable, return an empty array instead of guessing.",
    "Return JSON only with keys sold, active, notes. Each row must have title,itemPrice,shippingPrice,url,imageUrl,soldAt,listedAt,identityEvidence.",
    `EXACT TITLE: ${exactTitle}`,
    `CANONICAL IDENTITY: ${JSON.stringify({
      player: ai.player,
      year: ai.year,
      brand: ai.brand,
      setName: ai.setName,
      cardNumber: ai.cardNumber,
      parallel: ai.parallel,
      serialNumber: ai.serialNumber,
      gradingCompany: ai.gradingCompany,
      gradeValue: ai.gradeValue,
      isRookie: ai.isRookie,
      isAuto: ai.isAuto,
      isRelic: ai.isRelic,
    })}`,
  ].join("\n");
}

function geminiSchema() {
  const nullableString = { type: ["string", "null"] };
  const row = {
    type: "object",
    required: [
      "title",
      "itemPrice",
      "shippingPrice",
      "url",
      "imageUrl",
      "soldAt",
      "listedAt",
      "identityEvidence",
    ],
    properties: {
      title: { type: "string" },
      itemPrice: { type: "number" },
      shippingPrice: { type: "number" },
      url: { type: "string" },
      imageUrl: nullableString,
      soldAt: nullableString,
      listedAt: nullableString,
      identityEvidence: { type: "string" },
    },
  };
  return {
    type: "object",
    required: ["sold", "active", "notes"],
    properties: {
      sold: { type: "array", items: row, maxItems: MAX_ROWS_PER_TEACHER },
      active: { type: "array", items: row, maxItems: MAX_ROWS_PER_TEACHER },
      notes: { type: "string" },
    },
  };
}

async function runGemini(prompt: string): Promise<TeacherAttempt> {
  if (!GEMINI_API_KEY || DIRECT_GEMINI_DISABLED) {
    return { teacher: "gemini", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }, { url_context: {} }],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Gemini HTTP ${response.status}`);
    }
    const text = (Array.isArray(payload?.candidates?.[0]?.content?.parts)
      ? payload.candidates[0].content.parts
      : [])
      .map((part: any) => clean(part?.text))
      .filter(Boolean)
      .join("\n");
    const parsed = parseJsonObject(text);
    return { teacher: "gemini", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "gemini",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}


function gatewayResponsesOutputText(payload: any) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((part: any) => part?.type === "output_text" && typeof part?.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function gatewayGeminiGroundingObserved(payload: any) {
  const metadata = payload?.provider_metadata || payload?.providerMetadata || null;
  if (!metadata) return false;
  const serialized = JSON.stringify(metadata);
  return /groundingMetadata|webSearchQueries|searchEntryPoint|groundingChunks|groundingSupports/i.test(serialized);
}

async function runGatewayGemini(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayPlatformAvailable() && !GATEWAY_GEMINI_DISABLED;
  if (!configured) {
    return { teacher: "gateway_gemini", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const token = await gatewayBearerToken();
    if (!token) throw new Error("Vercel AI Gateway credential unavailable at request time.");
    const response = await fetch("https://ai-gateway.vercel.sh/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GATEWAY_GEMINI_MODEL,
        input: [{ type: "message", role: "user", content: prompt }],
        max_output_tokens: 6000,
        temperature: 0,
        tools: [{ type: "google_search" }],
        tool_choice: "required",
        providerOptions: { gateway: { only: ["vertex"] } },
      }),
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Vercel Gateway Gemini HTTP ${response.status}`);
    }
    if (!gatewayGeminiGroundingObserved(payload)) {
      throw new Error("Vercel Gateway Gemini returned without native Google Search grounding metadata.");
    }
    const text = gatewayResponsesOutputText(payload);
    if (!text) throw new Error("Vercel Gateway Gemini returned no output text.");
    const parsed = parseJsonObject(text);
    return {
      teacher: "gateway_gemini",
      configured: true,
      ok: true,
      ...parsed,
      notes: [parsed.notes, `Vercel Gateway ${GATEWAY_GEMINI_MODEL} with native Google Search grounding.`]
        .filter(Boolean)
        .join(" "),
      error: null,
    };
  } catch (error) {
    return {
      teacher: "gateway_gemini",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function runAnthropic(prompt: string): Promise<TeacherAttempt> {
  if (!ANTHROPIC_API_KEY) {
    return { teacher: "anthropic", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 6000,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        tools: [
          {
            type: "web_search_20260318",
            name: "web_search",
            max_uses: 10,
            allowed_domains: TEACHER_MARKET_DOMAINS,
            allowed_callers: ["direct"],
          },
        ],
      }),
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Anthropic HTTP ${response.status}`);
    }
    const text = (Array.isArray(payload?.content) ? payload.content : [])
      .filter((part: any) => part?.type === "text")
      .map((part: any) => clean(part?.text))
      .filter(Boolean)
      .join("\n");
    const parsed = parseJsonObject(text);
    return { teacher: "anthropic", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "anthropic",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function xaiOutputText(payload: any) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((part: any) => part?.type === "output_text" && typeof part?.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

async function runXai(prompt: string): Promise<TeacherAttempt> {
  if (!XAI_API_KEY) {
    return { teacher: "xai", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${XAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: XAI_MODEL,
        input: prompt,
        tools: [
          {
            type: "web_search",
            filters: { allowed_domains: TEACHER_MARKET_DOMAINS },
            enable_image_understanding: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `xAI HTTP ${response.status}`);
    }
    const parsed = parseJsonObject(xaiOutputText(payload));
    return { teacher: "xai", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "xai",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function runGroq(prompt: string): Promise<TeacherAttempt> {
  if (!GROQ_API_KEY) {
    return { teacher: "groq", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        compound_custom: {
          tools: {
            enabled_tools: ["web_search"],
          },
        },
        search_settings: {
          include_domains: TEACHER_MARKET_DOMAINS,
          country: "united states",
        },
      }),
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Groq HTTP ${response.status}`);
    }
    const parsed = parseJsonObject(clean(payload?.choices?.[0]?.message?.content));
    return { teacher: "groq", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "groq",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function priceFromText(value: string) {
  const match = value.replace(/,/g, "").match(/(?:US\s*)?\$\s*(\d+(?:\.\d{1,2})?)/i);
  return match?.[1] ? money(match[1]) : null;
}

async function runPerplexity(exactTitle: string): Promise<TeacherAttempt> {
  if (!PERPLEXITY_API_KEY) {
    return { teacher: "perplexity", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `${exactTitle} eBay sold completed PSA Auction Prices Realized`,
        max_results: 20,
        country: "US",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Perplexity HTTP ${response.status}`);
    }
    const resultCount = Array.isArray(payload?.results) ? payload.results.length : 0;
    return {
      teacher: "perplexity",
      configured: true,
      ok: true,
      sold: [],
      active: [],
      notes: `Perplexity Search returned ${resultCount} discovery result${resultCount === 1 ? "" : "s"}; it is corroboration-only until exact sold date and shipping are explicitly proven.`,
      error: null,
    };
  } catch (error) {
    return {
      teacher: "perplexity",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}


async function runGatewayPerplexity(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayPlatformAvailable();
  if (!configured) {
    return { teacher: "gateway_perplexity", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const gatewayToken = await gatewayBearerToken();
    if (!gatewayToken) throw new Error("Vercel Gateway OIDC token was unavailable at request time.");
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GATEWAY_PERPLEXITY_MODEL,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2400,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Vercel Gateway Perplexity HTTP ${response.status}`);
    }
    const parsed = parseJsonObject(clean(payload?.choices?.[0]?.message?.content));
    return { teacher: "gateway_perplexity", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "gateway_perplexity",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function toComp(row: TeacherMarketRow, teacher: TeacherName, lane: "sold" | "active") {
  return {
    title: row.title,
    price: Number((row.itemPrice + row.shippingPrice).toFixed(2)),
    itemPrice: row.itemPrice,
    shippingPrice: row.shippingPrice,
    priceIncludesShipping: true,
    currency: "USD",
    url: row.url,
    imageUrl: row.imageUrl,
    source: `teacher_${teacher}_${lane}`,
    sourceLabel: `${teacher} teacher ${lane}`,
    sourceCategory: "reference" as const,
    soldAt: lane === "sold" ? row.soldAt : null,
    listedAt: lane === "active" ? row.listedAt : null,
    observedAt: new Date().toISOString(),
  };
}

function strictTeacherRows(
  attempt: TeacherAttempt,
  lane: "sold" | "active",
  ai: InstaCompAiResult,
) {
  const rows = lane === "sold" ? attempt.sold : attempt.active;
  return filterStrictExactMarketMatches(
    rows.map((row) => toComp(row, attempt.teacher, lane)),
    ai,
    MAX_ROWS_PER_TEACHER,
  );
}

function itemKey(url: string) {
  return directEbayItemUrl(url) || url;
}

function teacherVoteFamily(teacher: TeacherName) {
  // Groq Compound and Groq GPT-OSS browser search are distinct discovery
  // methods, but they share one provider credential and therefore contribute
  // at most one independent trust vote for any sold listing.
  if (teacher === "gemini" || teacher === "gateway_gemini") return "gemini";
  if (teacher === "groq" || teacher === "groq_browser") return "groq";
  if (teacher === "gateway_perplexity") return "perplexity";
  return teacher;
}

function requiredTeacherVotes(configuredCount: number) {
  if (configuredCount < 2) return 2;
  return Math.floor(configuredCount / 2) + 1;
}

function consensusSold(
  attempts: TeacherAttempt[],
  ai: InstaCompAiResult,
  requiredVotes: number,
) {
  const byItem = new Map<
    string,
    Array<{ teacher: TeacherName; voteFamily: string; comp: InstaCompComp }>
  >();
  for (const attempt of attempts.filter((row) => row.ok)) {
    const voteFamily = teacherVoteFamily(attempt.teacher);
    for (const comp of strictTeacherRows(attempt, "sold", ai)) {
      const key = itemKey(comp.url);
      const group = byItem.get(key) || [];
      if (!group.some((row) => row.voteFamily === voteFamily)) {
        group.push({ teacher: attempt.teacher, voteFamily, comp });
      }
      byItem.set(key, group);
    }
  }

  return Array.from(byItem.values())
    .filter((group) => group.length >= requiredVotes)
    .map((group) => {
      const prices = group.map((row) => row.comp.price);
      const priceSpread = Math.max(...prices) - Math.min(...prices);
      if (priceSpread > 0.02) return null;
      const soldDates = new Set(group.map((row) => row.comp.soldAt).filter(Boolean));
      if (soldDates.size > 1) return null;
      const base = group[0].comp;
      return {
        ...base,
        source: "teacher_consensus_exact_sold",
        sourceLabel: "Outside AI Teacher Consensus Sold",
        sourceCategory: "sold" as const,
        matchScore: Math.max(base.matchScore, 300 + group.length * 10),
        flags: Array.from(
          new Set([
            ...base.flags,
            "outside teacher consensus",
            `teacher votes ${group.length}/${requiredVotes}`,
            ...group.map((row) => `teacher:${row.teacher}`),
            "eligible to teach InstaComp AI",
          ]),
        ).slice(0, 20),
      } satisfies InstaCompComp;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 12);
}

export async function getTeacherExactMarketProviders(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
}): Promise<TeacherConsensusMarketResult> {
  const prompt = teacherPrompt(params.exactTitle, params.ai);
  const [studentHypothesis, searchAttempts] = await Promise.all([
    requestInstaCompStudentCompHypothesis({ exactTitle: params.exactTitle, ai: params.ai }),
    Promise.all([
      runGemini(prompt),
      runGatewayGemini(prompt),
      runAnthropic(prompt),
      runXai(prompt),
      runGroq(prompt),
      runGroqBrowserTeacher(prompt),
      runGatewayPerplexity(prompt),
      runPerplexity(params.exactTitle),
    ]),
  ]);

  const criticPrompt = buildFreeCriticPrompt({
    exactTitle: params.exactTitle,
    ai: params.ai,
    soldCandidates: searchAttempts.flatMap((attempt) => attempt.ok ? attempt.sold : []).slice(0, 20),
    activeCandidates: searchAttempts.flatMap((attempt) => attempt.ok ? attempt.active : []).slice(0, 20),
  });
  const criticAttempts = await Promise.all([
    runOpenRouterCritic(criticPrompt),
    runCloudflareCritic(criticPrompt),
  ]);
  const attempts: TeacherAttempt[] = [...searchAttempts, ...criticAttempts];
  const votingAttempts = searchAttempts.filter((attempt) => attempt.teacher !== "perplexity");
  const configuredTeachers = votingAttempts
    .filter((attempt) => attempt.configured)
    .map((attempt) => attempt.teacher);
  const configuredVoteFamilies = new Set(configuredTeachers.map(teacherVoteFamily));
  const requiredVotes = requiredTeacherVotes(configuredVoteFamilies.size);
  const sold = consensusSold(votingAttempts, params.ai, requiredVotes);
  const discoverySold = searchAttempts.flatMap((attempt) =>
    attempt.ok ? strictTeacherRows(attempt, "sold", params.ai) : [],
  );
  const discoveryActive = searchAttempts.flatMap((attempt) =>
    attempt.ok ? strictTeacherRows(attempt, "active", params.ai) : [],
  );
  const healthy = attempts.filter((attempt) => attempt.ok).length;

  return {
    studentHypothesis,
    configuredTeachers,
    requiredVotes,
    attempts: attempts.map((attempt) => ({
      teacher: attempt.teacher,
      configured: attempt.configured,
      ok: attempt.ok,
      soldCount: attempt.sold.length,
      activeCount: attempt.active.length,
      notes: attempt.notes,
      error: attempt.error,
    })),
    sold: {
      source: "teacher_consensus_exact_sold",
      label: "Outside AI Teacher Consensus Sold",
      status: sold.length
        ? "live"
        : configuredTeachers.length < 2
          ? "not_configured"
          : healthy
            ? "no_matches"
            : "error",
      message: sold.length
        ? `${sold.length} exact sold comp${sold.length === 1 ? "" : "s"} reached independent teacher consensus.`
        : configuredTeachers.length < 2
          ? "At least two independent outside teachers must be configured before teacher findings can become trusted sold truth."
          : healthy
            ? `Outside teachers ran, but no sold listing reached the required ${requiredVotes}-teacher consensus.`
            : "Configured outside teacher providers failed.",
      results: sold,
    },
    active: {
      source: "teacher_discovery_active",
      label: "Outside AI Teacher Active Discovery",
      status: discoveryActive.length ? "live" : healthy ? "no_matches" : configuredTeachers.length ? "error" : "not_configured",
      message: discoveryActive.length
        ? `${discoveryActive.length} strict exact active discovery candidate${discoveryActive.length === 1 ? "" : "s"} found by outside teachers; official marketplace state remains authoritative for availability.`
        : "No strict exact active teacher candidates were retained.",
      results: discoveryActive.map((comp) => ({
        ...comp,
        flags: Array.from(new Set([...comp.flags, "teacher discovery only", "not used for sold pricing"])).slice(0, 20),
      })),
    },
    discovery: {
      sold: discoverySold,
      active: discoveryActive,
    },
  };
}
