import type { InstaCompAiResult } from "./instacomp";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || "").trim();
const CLOUDFLARE_ACCOUNT_ID = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const CLOUDFLARE_AUTH_TOKEN = String(
  process.env.CLOUDFLARE_AUTH_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "",
).trim();

const GROQ_BROWSER_MODEL = String(
  process.env.INSTACOMP_TEACHER_GROQ_BROWSER_MODEL || "openai/gpt-oss-20b",
).trim();
const OPENROUTER_MODEL = String(
  process.env.INSTACOMP_TEACHER_OPENROUTER_MODEL || "openrouter/free",
).trim();
const CLOUDFLARE_MODEL = String(
  process.env.INSTACOMP_TEACHER_CLOUDFLARE_MODEL || "@cf/meta/llama-3.2-11b-vision-instruct",
).trim();

const TIMEOUT_MS = 90_000;
const MAX_ROWS = 8;

export type FreeCompTeacherName = "groq_browser" | "openrouter" | "cloudflare";

export type FreeTeacherMarketRow = {
  title: string;
  itemPrice: number;
  shippingPrice: number;
  url: string;
  imageUrl: string | null;
  soldAt: string | null;
  listedAt: string | null;
  identityEvidence: string;
};

export type FreeCompTeacherAttempt = {
  teacher: FreeCompTeacherName;
  configured: boolean;
  ok: boolean;
  sold: FreeTeacherMarketRow[];
  active: FreeTeacherMarketRow[];
  notes: string;
  error: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function validDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
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
  if (!Array.isArray(value)) return [] as FreeTeacherMarketRow[];
  return value
    .slice(0, MAX_ROWS)
    .map((raw): FreeTeacherMarketRow | null => {
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
    .filter((row): row is FreeTeacherMarketRow => Boolean(row));
}

function parsePayload(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Teacher returned no JSON object.");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    sold: normalizeRows(record.sold, "sold"),
    active: normalizeRows(record.active, "active"),
    notes: clean(record.notes).slice(0, 2000),
  };
}

function emptyAttempt(teacher: FreeCompTeacherName): FreeCompTeacherAttempt {
  return { teacher, configured: false, ok: false, sold: [], active: [], notes: "", error: null };
}

export async function runGroqBrowserTeacher(prompt: string): Promise<FreeCompTeacherAttempt> {
  if (!GROQ_API_KEY) return emptyAttempt("groq_browser");
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_BROWSER_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_completion_tokens: 2600,
        reasoning_effort: "low",
        tool_choice: "required",
        tools: [{ type: "browser_search" }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Groq browser HTTP ${response.status}`);
    }
    const parsed = parsePayload(clean(payload?.choices?.[0]?.message?.content));
    return { teacher: "groq_browser", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "groq_browser",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function buildFreeCriticPrompt(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
  soldCandidates: FreeTeacherMarketRow[];
  activeCandidates: FreeTeacherMarketRow[];
}) {
  return [
    "You are a non-authoritative sports-card comp critic for InstaComp AI.",
    "You have NO web-search authority in this step. Evaluate ONLY the supplied candidate rows; never invent a URL, sale, price, date, shipping amount, or candidate.",
    "Retain a candidate only if it is compatible with the canonical exact card identity. Reject different year/set/card number/parallel/serial denominator/autograph/relic/grade states.",
    "Preserve every retained row's URL, title, prices and dates exactly as supplied. This critic output can help train the student but can NEVER create trusted sold truth or pricing authority.",
    "Return JSON only with sold, active, notes. Each row must have title,itemPrice,shippingPrice,url,imageUrl,soldAt,listedAt,identityEvidence.",
    `EXACT TITLE: ${params.exactTitle}`,
    `CANONICAL IDENTITY: ${JSON.stringify({
      player: params.ai.player,
      year: params.ai.year,
      brand: params.ai.brand,
      setName: params.ai.setName,
      cardNumber: params.ai.cardNumber,
      parallel: params.ai.parallel,
      serialNumber: params.ai.serialNumber,
      gradingCompany: params.ai.gradingCompany,
      gradeValue: params.ai.gradeValue,
      isRookie: params.ai.isRookie,
      isAuto: params.ai.isAuto,
      isRelic: params.ai.isRelic,
    })}`,
    `SUPPLIED SOLD CANDIDATES: ${JSON.stringify(params.soldCandidates.slice(0, 20))}`,
    `SUPPLIED ACTIVE CANDIDATES: ${JSON.stringify(params.activeCandidates.slice(0, 20))}`,
  ].join("\n");
}

export async function runOpenRouterCritic(prompt: string): Promise<FreeCompTeacherAttempt> {
  if (!OPENROUTER_API_KEY) return emptyAttempt("openrouter");
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
        provider: { require_parameters: true },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `OpenRouter HTTP ${response.status}`);
    }
    const parsed = parsePayload(clean(payload?.choices?.[0]?.message?.content));
    return { teacher: "openrouter", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "openrouter",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

export async function runCloudflareCritic(prompt: string): Promise<FreeCompTeacherAttempt> {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AUTH_TOKEN) return emptyAttempt("cloudflare");
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CLOUDFLARE_ACCOUNT_ID)}/ai/run/${CLOUDFLARE_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CLOUDFLARE_AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 2200,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.success === false) {
      const apiError = Array.isArray(payload?.errors) ? payload.errors.map((row: any) => clean(row?.message)).filter(Boolean).join("; ") : "";
      throw new Error(apiError || `Cloudflare Workers AI HTTP ${response.status}`);
    }
    const text = clean(payload?.result?.response || payload?.result);
    const parsed = parsePayload(text);
    return { teacher: "cloudflare", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "cloudflare",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}
