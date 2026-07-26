import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  filterAndRankExactMatches,
  filterAndRankGuidanceMatches,
  type InstaCompAiResult,
  type InstaCompComp,
  type InstaCompProviderResult,
} from "./instacomp";

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CACHE_TTL_DAYS = 7;
const RESULT_LIMIT = 50;

type EbayLane = "sold" | "active";

type EbaySerpItem = {
  title: string;
  link: string;
  productId: string | null;
  price: number;
  thumbnail: string | null;
  soldDate: string | null;
  listingDate: string | null;
  condition: string | null;
};

type CachedPayload = {
  query: string;
  lane: EbayLane;
  items: EbaySerpItem[];
};

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function cacheKey(query: string, lane: EbayLane) {
  return createHash("sha256")
    .update(`serpapi_ebay_${lane}:${normalizeKey(query)}`)
    .digest("hex");
}

function extractedPrice(value: unknown): number {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const direct = Number(record.extracted);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const from = record.from && typeof record.from === "object"
    ? Number((record.from as Record<string, unknown>).extracted)
    : NaN;
  const to = record.to && typeof record.to === "object"
    ? Number((record.to as Record<string, unknown>).extracted)
    : NaN;

  if (Number.isFinite(from) && from > 0 && Number.isFinite(to) && to > 0) {
    return Math.round(((from + to) / 2) * 100) / 100;
  }
  if (Number.isFinite(from) && from > 0) return from;
  if (Number.isFinite(to) && to > 0) return to;
  return 0;
}

function itemLink(item: Record<string, unknown>) {
  const direct = typeof item.link === "string" && item.link.trim() ? item.link.trim() : null;
  if (direct) return direct;
  const productId = typeof item.product_id === "string" ? item.product_id.trim() : "";
  return productId ? `https://www.ebay.com/itm/${encodeURIComponent(productId)}` : null;
}

function normalizeItems(value: unknown): EbaySerpItem[] {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rows = Array.isArray(root.organic_results) ? root.organic_results : [];

  return rows
    .map((row): EbaySerpItem | null => {
      const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const price = extractedPrice(item.price);
      const link = itemLink(item);
      if (!title || !price || !link) return null;

      return {
        title,
        link,
        productId: typeof item.product_id === "string" ? item.product_id : null,
        price,
        thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : null,
        soldDate: typeof item.sold_date === "string" ? item.sold_date : null,
        listingDate: typeof item.listing_date === "string" ? item.listing_date : null,
        condition: typeof item.condition === "string" ? item.condition : null,
      };
    })
    .filter((item): item is EbaySerpItem => Boolean(item));
}

async function readCache(query: string, lane: EbayLane) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const key = cacheKey(query, lane);
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload,expires_at")
    .eq("query_hash", key)
    .eq("provider", `serpapi_ebay_${lane}`)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data?.result_payload) return null;
  const payload = data.result_payload as CachedPayload;
  return Array.isArray(payload.items) ? payload.items : null;
}

async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const now = new Date();
  await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: cacheKey(query, lane),
      provider: `serpapi_ebay_${lane}`,
      normalized_query: normalizeKey(query),
      result_payload: { query, lane, items } satisfies CachedPayload,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + CACHE_TTL_DAYS * 86_400_000).toISOString(),
      hit_count: 0,
    },
    { onConflict: "query_hash" },
  );
}

async function fetchLane(query: string, lane: EbayLane) {
  if (!SERPAPI_API_KEY) {
    return {
      ok: false as const,
      items: [] as EbaySerpItem[],
      cached: false,
      message: "SERPAPI_API_KEY is not configured.",
    };
  }

  const cached = await readCache(query, lane);
  if (cached) return { ok: true as const, items: cached, cached: true, message: null };

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "ebay");
  url.searchParams.set("api_key", SERPAPI_API_KEY);
  url.searchParams.set("ebay_domain", "ebay.com");
  url.searchParams.set("_nkw", query);
  url.searchParams.set("_ipg", String(RESULT_LIMIT));
  url.searchParams.set("_blrs", "spell_auto_correct");
  if (lane === "sold") url.searchParams.set("show_only", "Sold");
  else url.searchParams.set("_sop", "10");

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      return {
        ok: false as const,
        items: [] as EbaySerpItem[],
        cached: false,
        message: `SerpApi eBay ${lane} search failed: ${String(payload?.error || response.statusText)}`,
      };
    }
    const items = normalizeItems(payload);
    await writeCache(query, lane, items);
    return { ok: true as const, items, cached: false, message: null };
  } catch (error) {
    return {
      ok: false as const,
      items: [] as EbaySerpItem[],
      cached: false,
      message: `SerpApi eBay ${lane} search failed: ${error instanceof Error ? error.message : "request error"}`,
    };
  }
}

function rawComps(items: EbaySerpItem[], lane: EbayLane): Omit<InstaCompComp, "matchScore" | "flags">[] {
  return items.map((item) => ({
    title: item.title,
    price: item.price,
    currency: "USD",
    url: item.link,
    imageUrl: item.thumbnail,
    source: lane === "sold" ? "ebay_sold_serpapi" : "ebay_active_serpapi",
    sourceLabel: lane === "sold" ? "eBay Sold" : "eBay Active",
    sourceCategory: lane === "sold" ? "sold" : "marketplace",
    soldAt: lane === "sold" ? item.soldDate : null,
    listedAt: lane === "active" ? item.listingDate : null,
    observedAt: new Date().toISOString(),
  }));
}

function searchUrl(query: string, lane: EbayLane) {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", query);
  if (lane === "sold") {
    url.searchParams.set("LH_Sold", "1");
    url.searchParams.set("LH_Complete", "1");
  }
  return url.toString();
}

async function provider(
  query: string,
  ai: InstaCompAiResult,
  lane: EbayLane,
): Promise<InstaCompProviderResult> {
  const fetched = await fetchLane(query, lane);
  if (!fetched.ok) {
    return {
      source: lane === "sold" ? "ebay_sold_serpapi" : "ebay_active_serpapi",
      label: lane === "sold" ? "eBay Sold" : "eBay Active",
      status: SERPAPI_API_KEY ? "error" : "not_configured",
      message: fetched.message,
      results: [],
      searchUrl: searchUrl(query, lane),
    };
  }

  const raw = rawComps(fetched.items, lane);
  const exact = filterAndRankExactMatches(raw, ai, lane === "sold" ? 40 : 20, 35);
  const exactUrls = new Set(exact.map((comp) => comp.url));
  const guidance = filterAndRankGuidanceMatches(raw, ai, 20, 15)
    .filter((comp) => !exactUrls.has(comp.url));
  const results = [...exact, ...guidance].slice(0, lane === "sold" ? 50 : 30);

  return {
    source: lane === "sold" ? "ebay_sold_serpapi" : "ebay_active_serpapi",
    label: lane === "sold" ? "eBay Sold" : "eBay Active",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? `${fetched.cached ? "Loaded cached" : "Fetched"} structured eBay ${lane} results using the exact stored title; exact and review-needed candidates are separated downstream.`
      : `eBay returned ${fetched.items.length} structured ${lane} result${fetched.items.length === 1 ? "" : "s"}, but none passed exact-card or review-candidate filtering.`,
    results,
    searchUrl: searchUrl(query, lane),
  };
}

export async function getUniversalEbaySerpProviders(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const query = String(params.exactTitle || params.fallbackQuery || "").trim();
  const [sold, active] = await Promise.all([
    provider(query, params.ai, "sold"),
    provider(query, params.ai, "active"),
  ]);
  return { query, sold, active };
}
