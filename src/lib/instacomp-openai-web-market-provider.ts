import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
} from "./instacomp";
import { filterStrictExactMarketMatches } from "./instacomp-exact-market-provider";

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SUPABASE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
).trim();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RESULTS_PER_LANE = 10;

export type OpenAiWebMarketProviderResult = {
  model: string | null;
  responseId: string | null;
  citedItemIds: string[];
  notes: string;
  sold: InstaCompProviderResult;
  active: InstaCompProviderResult;
  cached: boolean;
};

type MarketRow = {
  title: string;
  itemPrice: number;
  shippingPrice: number | null;
  url: string;
  imageUrl: string | null;
  soldAt: string | null;
  listedAt: string | null;
};

type StructuredMarketResponse = {
  sold: MarketRow[];
  active: MarketRow[];
  notes: string;
};

type CachedResult = {
  result: OpenAiWebMarketProviderResult;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function identityKey(exactTitle: string, ai: InstaCompAiResult) {
  return createHash("sha256")
    .update(
      `openai_web_exact_market_v2:${normalizedKey(exactTitle)}:${JSON.stringify({
        player: ai.player,
        year: ai.year,
        brand: ai.brand,
        setName: ai.setName,
        cardNumber: ai.cardNumber,
        parallel: ai.parallel,
        serialNumber: ai.serialNumber,
        gradingCompany: ai.gradingCompany,
        gradeValue: ai.gradeValue,
        isAuto: ai.isAuto,
        isRelic: ai.isRelic,
      })}`,
    )
    .digest("hex");
}

function directEbayItemUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    if (!/(^|\.)ebay\.com$/i.test(url.hostname)) return null;
    const itemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:\/|$)/i)?.[1];
    return itemId ? `https://www.ebay.com/itm/${itemId}` : null;
  } catch {
    return null;
  }
}

function sourceItemIds(payload: any) {
  const ids = new Set<string>();
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    const sources = Array.isArray(item?.action?.sources) ? item.action.sources : [];
    for (const source of sources) {
      const url = directEbayItemUrl(source?.url);
      const id = url?.match(/\/itm\/(\d+)/)?.[1];
      if (id) ids.add(id);
    }
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const url = directEbayItemUrl(annotation?.url || annotation?.url_citation?.url);
        const id = url?.match(/\/itm\/(\d+)/)?.[1];
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

function outputText(payload: any) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((content: any) => content?.type === "output_text" && typeof content?.text === "string")
    .map((content: any) => content.text)
    .join("\n")
    .trim();
}

function marketSchema() {
  const row = {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "itemPrice",
      "shippingPrice",
      "url",
      "imageUrl",
      "soldAt",
      "listedAt",
    ],
    properties: {
      title: { type: "string" },
      itemPrice: { type: "number" },
      shippingPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
      url: { type: "string" },
      imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      soldAt: { anyOf: [{ type: "string" }, { type: "null" }] },
      listedAt: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["sold", "active", "notes"],
    properties: {
      sold: { type: "array", items: row, maxItems: MAX_RESULTS_PER_LANE },
      active: { type: "array", items: row, maxItems: MAX_RESULTS_PER_LANE },
      notes: { type: "string" },
    },
  };
}

function providerResult(params: {
  lane: "sold" | "active";
  results: InstaCompComp[];
  message: string;
  status?: InstaCompProviderResult["status"];
}) {
  return {
    source: params.lane === "sold" ? "openai_web_ebay_sold_exact" : "openai_web_ebay_active_exact",
    label: params.lane === "sold" ? "eBay Sold via OpenAI Web" : "eBay Active via OpenAI Web",
    status: params.status || (params.results.length ? "live" : "no_matches"),
    message: params.message,
    results: params.results,
  } satisfies InstaCompProviderResult;
}

function errorResult(message: string): OpenAiWebMarketProviderResult {
  return {
    model: null,
    responseId: null,
    citedItemIds: [],
    notes: message,
    sold: providerResult({ lane: "sold", results: [], message, status: OPENAI_API_KEY ? "error" : "not_configured" }),
    active: providerResult({ lane: "active", results: [], message, status: OPENAI_API_KEY ? "error" : "not_configured" }),
    cached: false,
  };
}

async function readCache(key: string) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload")
    .eq("query_hash", key)
    .eq("provider", "openai_web_ebay_exact")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data?.result_payload) return null;
  const payload = data.result_payload as CachedResult;
  if (!payload?.result?.sold || !payload?.result?.active) return null;
  return { ...payload.result, cached: true } satisfies OpenAiWebMarketProviderResult;
}

async function writeCache(key: string, exactTitle: string, result: OpenAiWebMarketProviderResult) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const now = new Date();
  const { error } = await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: key,
      provider: "openai_web_ebay_exact",
      normalized_query: normalizedKey(exactTitle),
      result_payload: { result } satisfies CachedResult,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CACHE_TTL_MS).toISOString(),
      hit_count: 0,
    },
    { onConflict: "query_hash" },
  );
  if (error) console.error("OpenAI exact market cache write failed:", error.message);
}

function normalizedRows(params: {
  rows: MarketRow[];
  lane: "sold" | "active";
  citedIds: Set<string>;
}) {
  return params.rows
    .map((row) => {
      const url = directEbayItemUrl(row.url);
      const itemId = url?.match(/\/itm\/(\d+)/)?.[1];
      if (!url || !itemId || !params.citedIds.has(itemId)) return null;
      const title = clean(row.title);
      const imageUrl = clean(row.imageUrl);
      const itemPrice = Number(row.itemPrice);
      const shippingPrice = row.shippingPrice === null ? null : Number(row.shippingPrice);
      if (!title || !imageUrl || !/^https?:\/\//i.test(imageUrl)) return null;
      if (!Number.isFinite(itemPrice) || itemPrice <= 0) return null;
      if (shippingPrice === null || !Number.isFinite(shippingPrice) || shippingPrice < 0) return null;
      const soldAt = clean(row.soldAt) || null;
      const listedAt = clean(row.listedAt) || null;
      if (params.lane === "sold" && !soldAt) return null;
      const deliveredPrice = Math.round((itemPrice + shippingPrice) * 100) / 100;
      return {
        title,
        price: deliveredPrice,
        itemPrice,
        shippingPrice,
        priceIncludesShipping: true,
        currency: "USD",
        url,
        imageUrl,
        source: params.lane === "sold" ? "openai_web_ebay_sold_exact" : "openai_web_ebay_active_exact",
        sourceLabel: params.lane === "sold" ? "eBay Sold via OpenAI Web" : "eBay Active via OpenAI Web",
        sourceCategory: "reference" as const,
        soldAt: params.lane === "sold" ? soldAt : null,
        listedAt: params.lane === "active" ? listedAt : null,
        observedAt: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function getOpenAiExactEbayMarketProviders(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
  bypassCache?: boolean;
}): Promise<OpenAiWebMarketProviderResult> {
  if (!OPENAI_API_KEY) return errorResult("OPENAI_API_KEY is not configured for exact web market search.");

  const key = identityKey(params.exactTitle, params.ai);
  if (!params.bypassCache) {
    const cached = await readCache(key);
    if (cached) return cached;
  }

  const model = String(process.env.INSTACOMP_WEB_SEARCH_MODEL || "gpt-5-mini").trim();
  const body = {
    model,
    store: false,
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
        filters: { allowed_domains: ["ebay.com"] },
      },
    ],
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a strict sports-card market evidence researcher. Never return similar cards. Player, year, product/set, card number, parallel, print-run denominator, autograph/relic state, raw/graded state, grading company, and grade must match exactly. A /199 card is never evidence for /299. A numbered card is never evidence for an unnumbered card. Only return a direct eBay item URL that your web search opened or cited. Do not invent a URL, title, price, shipping amount, sale date, listing date, or image. A sold row must explicitly show that the listing sold/completed and must include its sold date. An active row must be currently for sale. Include the direct listing image URL. Omit any row whose image or shipping cost cannot be verified. Return an empty array when exact proof is unavailable.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Find exact eBay sold listings and exact currently active eBay listings for this card identity:\n${JSON.stringify(
              { exactTitle: params.exactTitle, identity: params.ai },
              null,
              2,
            )}\nReturn up to ${MAX_RESULTS_PER_LANE} exact sold and ${MAX_RESULTS_PER_LANE} exact active direct item pages. Use 0 shipping for explicitly free shipping. Do not return a row when shipping, image, exact identity, sold status, or active status is uncertain.`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "exact_ebay_market_evidence",
        strict: true,
        schema: marketSchema(),
      },
    },
    max_output_tokens: 6000,
  };

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return errorResult(
        `OpenAI exact web market search failed (${response.status}): ${clean(payload?.error?.message) || response.statusText}`,
      );
    }
    const text = outputText(payload);
    if (!text) return errorResult("OpenAI exact web market search returned no structured evidence.");
    const parsed = JSON.parse(text) as StructuredMarketResponse;
    const citedIds = sourceItemIds(payload);
    const sold = filterStrictExactMarketMatches(
      normalizedRows({ rows: Array.isArray(parsed.sold) ? parsed.sold : [], lane: "sold", citedIds }),
      params.ai,
      MAX_RESULTS_PER_LANE,
    ).map((row) => ({
      ...row,
      flags: Array.from(
        new Set([
          ...row.flags,
          "direct cited eBay sold discovery candidate",
          "not independently verified for pricing",
        ]),
      ).slice(0, 20),
    }));
    const active = filterStrictExactMarketMatches(
      normalizedRows({ rows: Array.isArray(parsed.active) ? parsed.active : [], lane: "active", citedIds }),
      params.ai,
      MAX_RESULTS_PER_LANE,
    ).map((row) => ({
      ...row,
      flags: Array.from(
        new Set([
          ...row.flags,
          "direct cited eBay active discovery candidate",
          "not independently verified for pricing",
        ]),
      ).slice(0, 20),
    }));
    const result: OpenAiWebMarketProviderResult = {
      model: clean(payload?.model) || model,
      responseId: clean(payload?.id) || null,
      citedItemIds: Array.from(citedIds),
      notes: clean(parsed.notes),
      sold: providerResult({
        lane: "sold",
        results: sold,
        message: sold.length
          ? `${sold.length} direct-cited, strict exact eBay sold listing${sold.length === 1 ? "" : "s"} passed initial identity screening but remain discovery-only until independently cross-verified.`
          : "OpenAI web search found no direct-cited eBay sold listing that passed every exact-card, image, sale-date, and shipping gate.",
      }),
      active: providerResult({
        lane: "active",
        results: active,
        message: active.length
          ? `${active.length} direct-cited, strict exact active eBay listing${active.length === 1 ? "" : "s"} passed initial identity screening but remain discovery-only until independently cross-verified.`
          : "OpenAI web search found no direct-cited active eBay listing that passed every exact-card, image, status, and shipping gate.",
      }),
      cached: false,
    };
    await writeCache(key, params.exactTitle, result);
    return result;
  } catch (error) {
    return errorResult(
      `OpenAI exact web market search failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
