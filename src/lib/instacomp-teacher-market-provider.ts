import type {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
} from "./instacomp";
import { filterStrictExactMarketMatches } from "./instacomp-exact-market-provider";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

const GEMINI_API_KEY = String(
  process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || "",
).trim();
const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || "").trim();
const XAI_API_KEY = String(process.env.XAI_API_KEY || "").trim();
const PERPLEXITY_API_KEY = String(process.env.PERPLEXITY_API_KEY || "").trim();

const GEMINI_MODEL = String(
  process.env.INSTACOMP_TEACHER_GEMINI_MODEL || "gemini-3.6-flash",
).trim();
const ANTHROPIC_MODEL = String(
  process.env.INSTACOMP_TEACHER_ANTHROPIC_MODEL || "claude-sonnet-4-6",
).trim();
const XAI_MODEL = String(
  process.env.INSTACOMP_TEACHER_XAI_MODEL || "grok-4.5",
).trim();
const TEACHER_TIMEOUT_MS = 120_000;
const MAX_ROWS_PER_TEACHER = 12;

export type TeacherName = "gemini" | "anthropic" | "xai" | "perplexity";

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
  if (!GEMINI_API_KEY) {
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
            responseSchema: geminiSchema(),
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
            allowed_domains: ["ebay.com", "130point.com"],
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
            allowed_domains: ["ebay.com", "130point.com"],
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
        query: `${exactTitle} eBay sold completed`,
        max_results: 20,
        search_context_size: "high",
        country: "US",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Perplexity HTTP ${response.status}`);
    }
    const sold = (Array.isArray(payload?.results) ? payload.results : [])
      .map((row: any): TeacherMarketRow | null => {
        const url = directEbayItemUrl(row?.url);
        const text = `${clean(row?.title)} ${clean(row?.snippet)}`;
        const itemPrice = priceFromText(text);
        const soldAt = validDate(row?.date || row?.last_updated);
        if (!url || itemPrice === null || !soldAt) return null;
        return {
          title: clean(row?.title),
          itemPrice,
          shippingPrice: 0,
          url,
          imageUrl: null,
          soldAt,
          listedAt: null,
          identityEvidence: clean(row?.snippet).slice(0, 1000),
        };
      })
      .filter((row: TeacherMarketRow | null): row is TeacherMarketRow => Boolean(row));
    return {
      teacher: "perplexity",
      configured: true,
      ok: true,
      sold,
      active: [],
      notes: "Perplexity Search discovery only; rows still require cross-teacher agreement.",
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
    Array<{ teacher: TeacherName; comp: InstaCompComp }>
  >();
  for (const attempt of attempts.filter((row) => row.ok)) {
    for (const comp of strictTeacherRows(attempt, "sold", ai)) {
      const key = itemKey(comp.url);
      const group = byItem.get(key) || [];
      if (!group.some((row) => row.teacher === attempt.teacher)) {
        group.push({ teacher: attempt.teacher, comp });
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
    .filter((row): row is InstaCompComp => Boolean(row))
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, 12);
}

export async function getTeacherExactMarketProviders(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
}): Promise<TeacherConsensusMarketResult> {
  const prompt = teacherPrompt(params.exactTitle, params.ai);
  const attempts = await Promise.all([
    runGemini(prompt),
    runAnthropic(prompt),
    runXai(prompt),
    runPerplexity(params.exactTitle),
  ]);
  const configuredTeachers = attempts
    .filter((attempt) => attempt.configured)
    .map((attempt) => attempt.teacher);
  const requiredVotes = requiredTeacherVotes(configuredTeachers.length);
  const sold = consensusSold(attempts, params.ai, requiredVotes);
  const discoverySold = attempts.flatMap((attempt) =>
    attempt.ok ? strictTeacherRows(attempt, "sold", params.ai) : [],
  );
  const discoveryActive = attempts.flatMap((attempt) =>
    attempt.ok ? strictTeacherRows(attempt, "active", params.ai) : [],
  );
  const healthy = attempts.filter((attempt) => attempt.ok).length;

  return {
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
