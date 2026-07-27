import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  filterAndRankExactMatches,
  type InstaCompAiResult,
  type InstaCompComp,
  type InstaCompProviderResult,
} from "./instacomp";

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SOLD_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const ACTIVE_CACHE_TTL_MS = 45 * 60 * 1000;
const RESULT_LIMIT = 100;
const MAX_QUERY_ATTEMPTS = 5;

type EbayLane = "sold" | "active";

export type EbaySerpItem = {
  title: string;
  link: string;
  productId: string | null;
  itemPrice: number;
  shippingPrice: number | null;
  price: number;
  priceIncludesShipping: boolean;
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

type ProviderAttempt = {
  query: string;
  rawCount: number;
  exactCount: number;
  cached: boolean;
  message: string | null;
};

function cleanSpaces(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedText(value: string | null | undefined) {
  return cleanSpaces(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/#+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string) {
  return normalizedText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function cacheKey(query: string, lane: EbayLane) {
  return createHash("sha256")
    .update(`serpapi_ebay_v6_${lane}:${normalizeKey(query)}`)
    .digest("hex");
}

function moneyFromRecord(value: unknown, allowZero = false): number | null {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const direct = Number(record.extracted);
  if (Number.isFinite(direct) && (allowZero ? direct >= 0 : direct > 0)) return direct;

  const raw = typeof record.raw === "string" ? record.raw : "";
  if (allowZero && /free/i.test(raw)) return 0;
  const rawMatch = raw.replace(/,/g, "").match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
  const rawNumber = rawMatch ? Number(rawMatch[1]) : NaN;
  if (Number.isFinite(rawNumber) && (allowZero ? rawNumber >= 0 : rawNumber > 0)) {
    return rawNumber;
  }

  const from =
    record.from && typeof record.from === "object"
      ? Number((record.from as Record<string, unknown>).extracted)
      : NaN;
  const to =
    record.to && typeof record.to === "object"
      ? Number((record.to as Record<string, unknown>).extracted)
      : NaN;
  if (Number.isFinite(from) && from > 0 && Number.isFinite(to) && to > 0) {
    return Math.round(((from + to) / 2) * 100) / 100;
  }
  if (Number.isFinite(from) && from > 0) return from;
  if (Number.isFinite(to) && to > 0) return to;
  return null;
}

function itemLink(item: Record<string, unknown>) {
  const direct = typeof item.link === "string" && item.link.trim() ? item.link.trim() : null;
  if (direct) return direct;
  const productId = typeof item.product_id === "string" ? item.product_id.trim() : "";
  return productId ? `https://www.ebay.com/itm/${encodeURIComponent(productId)}` : null;
}

export function normalizeEbaySerpItems(value: unknown): EbaySerpItem[] {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rows = Array.isArray(root.organic_results) ? root.organic_results : [];

  return rows
    .map((row): EbaySerpItem | null => {
      const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const title = typeof item.title === "string" ? item.title.trim() : "";
      const itemPrice = moneyFromRecord(item.price);
      const shippingPrice = moneyFromRecord(item.shipping, true);
      const link = itemLink(item);
      if (!title || !itemPrice || !link) return null;
      const priceIncludesShipping = shippingPrice !== null;
      const deliveredPrice = Math.round((itemPrice + (shippingPrice || 0)) * 100) / 100;

      return {
        title,
        link,
        productId: typeof item.product_id === "string" ? item.product_id : null,
        itemPrice,
        shippingPrice,
        price: deliveredPrice,
        priceIncludesShipping,
        thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : null,
        soldDate: typeof item.sold_date === "string" ? item.sold_date : null,
        listingDate: typeof item.listing_date === "string" ? item.listing_date : null,
        condition: typeof item.condition === "string" ? item.condition : null,
      };
    })
    .filter((item): item is EbaySerpItem => Boolean(item));
}

export function buildSerpApiEbayRequestUrl(
  query: string,
  lane: EbayLane,
  apiKey = "test-key",
) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "ebay");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("ebay_domain", "ebay.com");
  url.searchParams.set("_nkw", query);
  url.searchParams.set("_ipg", String(RESULT_LIMIT));
  url.searchParams.set("_blrs", "spell_auto_correct");
  if (lane === "sold") url.searchParams.set("show_only", "Sold");
  else url.searchParams.set("_sop", "10");
  return url;
}

function verificationUrl(query: string, lane: EbayLane) {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", query);
  if (lane === "sold") {
    url.searchParams.set("LH_Sold", "1");
    url.searchParams.set("LH_Complete", "1");
  }
  return url.toString();
}

async function readCache(query: string, lane: EbayLane) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload")
    .eq("query_hash", cacheKey(query, lane))
    .eq("provider", `serpapi_ebay_exact_${lane}`)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data?.result_payload) return null;
  const payload = data.result_payload as CachedPayload;
  return Array.isArray(payload.items) && payload.items.length ? payload.items : null;
}

async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const now = new Date();
  const ttl = lane === "sold" ? SOLD_CACHE_TTL_MS : ACTIVE_CACHE_TTL_MS;
  const { error } = await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: cacheKey(query, lane),
      provider: `serpapi_ebay_exact_${lane}`,
      normalized_query: normalizeKey(query),
      result_payload: { query, lane, items } satisfies CachedPayload,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl).toISOString(),
      hit_count: 0,
    },
    { onConflict: "query_hash" },
  );
  if (error) console.error(`InstaComp exact eBay ${lane} cache write failed:`, error.message);
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

  try {
    const response = await fetch(
      buildSerpApiEbayRequestUrl(query, lane, SERPAPI_API_KEY).toString(),
      { cache: "no-store", signal: AbortSignal.timeout(45_000) },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      return {
        ok: false as const,
        items: [] as EbaySerpItem[],
        cached: false,
        message: `SerpApi eBay ${lane} search failed: ${String(payload?.error || response.statusText)}`,
      };
    }
    const items = normalizeEbaySerpItems(payload);
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

function cleanSearchPart(value: string | null | undefined) {
  return cleanSpaces(value)
    .replace(/\b(?:cert|certification)\s*(?:number|#|no\.?|num)?\s*[a-z0-9-]{5,}\b/gi, " ")
    .replace(/\b\d{1,6}\s*\/\s*(\d{1,6})\b/g, "/$1")
    .replace(/\s+/g, " ")
    .trim();
}

function serialDenominator(value: string | null | undefined) {
  const matches = Array.from(String(value || "").matchAll(/(?:\b\d{1,6}\s*)?\/\s*(\d{1,6})\b/g));
  const parsed = matches
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
  return parsed.length ? parsed[parsed.length - 1] : null;
}

function titleDenominators(value: string | null | undefined) {
  const withoutSeasons = String(value || "").replace(
    /\b(?:19|20)\d{2}\s*[-/]\s*\d{2,4}\b/g,
    " ",
  );
  return Array.from(
    withoutSeasons.matchAll(/(?:\b\d{1,6}\s*)?\/\s*(\d{1,6})\b/g),
  )
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
}

export function normalizeInstaCompParallelForExactMatching(
  value: string | null | undefined,
) {
  const normalized = normalizedText(value)
    .replace(/\bserial(?:ly)? numbered\b/g, " ")
    .replace(/\bnumbered\b/g, " ")
    .replace(/\bissue\b/g, " ")
    .replace(/\bcard\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (/^base\b/.test(normalized)) return "";
  const withoutRun = normalized.replace(/\/?\b\d{1,6}\b/g, " ").replace(/\s+/g, " ").trim();
  if (
    !withoutRun ||
    /^(memorabilia|relic|jersey|patch|autograph|auto|rookie|raw|standard|regular)(\s+(memorabilia|relic|jersey|patch|autograph|auto|rookie|raw|standard|regular))*$/.test(
      withoutRun,
    )
  ) {
    return "";
  }
  return withoutRun;
}

function marketAi(ai: InstaCompAiResult): InstaCompAiResult {
  const parallel = normalizeInstaCompParallelForExactMatching(ai.parallel);
  return { ...ai, parallel: parallel || null };
}

function gradeSearchPart(ai: InstaCompAiResult) {
  const company = cleanSearchPart(ai.gradingCompany);
  const grade = cleanSearchPart(ai.gradeValue);
  return [company, grade].filter(Boolean).join(" ");
}

export function buildExactEbayQueryLadder(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const ai = marketAi(params.ai);
  const denominator = serialDenominator(ai.serialNumber);
  const parallel = normalizeInstaCompParallelForExactMatching(ai.parallel);
  const grade = gradeSearchPart(ai);
  const cardNumber = cleanSearchPart(ai.cardNumber);
  const typeParts = [ai.isRookie ? "rookie" : "", ai.isAuto ? "auto" : "", ai.isRelic ? "relic" : ""];
  const exactTitle = cleanSearchPart(params.exactTitle);
  const fallback = cleanSearchPart(params.fallbackQuery);
  const canonical = [
    grade,
    cleanSearchPart(ai.year),
    cleanSearchPart(ai.brand),
    cleanSearchPart(ai.setName),
    cleanSearchPart(ai.player),
    ...typeParts,
    parallel,
    cardNumber ? `#${cardNumber.replace(/^#/, "")}` : "",
    denominator ? `/${denominator}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const setFocused = [
    grade,
    cleanSearchPart(ai.year),
    cleanSearchPart(ai.setName),
    cleanSearchPart(ai.player),
    parallel,
    cardNumber ? `#${cardNumber.replace(/^#/, "")}` : "",
    denominator ? `/${denominator}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const identityFocused = [
    grade,
    cleanSearchPart(ai.player),
    cleanSearchPart(ai.year),
    cleanSearchPart(ai.brand),
    parallel,
    cardNumber ? `#${cardNumber.replace(/^#/, "")}` : "",
    denominator ? `/${denominator}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const narrow = [
    cleanSearchPart(ai.player),
    cardNumber ? `#${cardNumber.replace(/^#/, "")}` : "",
    parallel,
    denominator ? `/${denominator}` : "",
    grade,
  ]
    .filter(Boolean)
    .join(" ");

  return [exactTitle, canonical, setFocused, identityFocused, fallback, narrow]
    .map(cleanSearchPart)
    .filter((query) => query.length >= 4)
    .filter((query, index, all) => all.findIndex((candidate) => normalizeKey(candidate) === normalizeKey(query)) === index)
    .slice(0, MAX_QUERY_ATTEMPTS);
}

function rawComps(items: EbaySerpItem[], lane: EbayLane): Omit<InstaCompComp, "matchScore" | "flags">[] {
  return items.map((item) => ({
    title: item.title,
    price: item.price,
    itemPrice: item.itemPrice,
    shippingPrice: item.shippingPrice,
    priceIncludesShipping: item.priceIncludesShipping,
    currency: "USD",
    url: item.link,
    imageUrl: item.thumbnail,
    source: lane === "sold" ? "ebay_sold_serpapi_exact" : "ebay_active_serpapi_exact",
    sourceLabel: lane === "sold" ? "eBay Sold" : "eBay Active",
    sourceCategory: lane === "sold" ? ("sold" as const) : ("marketplace" as const),
    soldAt: lane === "sold" ? item.soldDate : null,
    listedAt: lane === "active" ? item.listingDate : null,
    observedAt: new Date().toISOString(),
  }));
}

function strictNumberingGate(title: string, ai: InstaCompAiResult) {
  const target = serialDenominator(ai.serialNumber);
  const listing = titleDenominators(title);
  if (target) return listing.length > 0 && listing.every((denominator) => denominator === target);
  return listing.length === 0;
}

export function filterStrictExactMarketMatches(
  comps: Omit<InstaCompComp, "matchScore" | "flags">[],
  targetAi: InstaCompAiResult,
  limit = 50,
) {
  const ai = marketAi(targetAi);
  return filterAndRankExactMatches(comps, ai, limit, 35)
    .filter((comp) => strictNumberingGate(comp.title, ai))
    .map((comp) => ({
      ...comp,
      flags: Array.from(
        new Set([
          ...comp.flags,
          "strict exact identity",
          serialDenominator(ai.serialNumber)
            ? `exact print run /${serialDenominator(ai.serialNumber)}`
            : "exact non-numbered issue",
        ]),
      ).slice(0, 20),
    }));
}

function dedupeComps(values: InstaCompComp[], limit: number) {
  const seen = new Set<string>();
  return values
    .filter((comp) => {
      const key = comp.url || `${normalizeKey(comp.title)}|${comp.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) return right.matchScore - left.matchScore;
      return left.price - right.price;
    })
    .slice(0, limit);
}

export async function providerAcrossQueries(params: {
  queries: string[];
  ai: InstaCompAiResult;
  lane: EbayLane;
  targetExactCount: number;
}) {
  const attempts: ProviderAttempt[] = [];
  let results: InstaCompComp[] = [];
  let firstError: string | null = null;

  for (const query of params.queries) {
    const fetched = await fetchLane(query, params.lane);
    if (!fetched.ok) {
      firstError ||= fetched.message;
      attempts.push({ query, rawCount: 0, exactCount: 0, cached: false, message: fetched.message });
      if (!SERPAPI_API_KEY) break;
      continue;
    }
    const exact = filterStrictExactMarketMatches(rawComps(fetched.items, params.lane), params.ai, 50).map(
      (comp) => ({
        ...comp,
        flags: Array.from(
          new Set([
            ...comp.flags,
            fetched.items.find((item) => item.link === comp.url)?.priceIncludesShipping
              ? "price includes reported shipping"
              : "shipping not reported",
          ]),
        ).slice(0, 20),
      }),
    );
    results = dedupeComps([...results, ...exact], params.lane === "sold" ? 50 : 30);
    attempts.push({
      query,
      rawCount: fetched.items.length,
      exactCount: exact.length,
      cached: fetched.cached,
      message: null,
    });
    if (results.length >= params.targetExactCount) break;
  }

  const primaryQuery = params.queries[0] || "sports card";
  const status = !SERPAPI_API_KEY
    ? "not_configured"
    : results.length
      ? "live"
      : firstError
        ? "error"
        : "no_matches";
  return {
    source: params.lane === "sold" ? "ebay_sold_serpapi_exact" : "ebay_active_serpapi_exact",
    label: params.lane === "sold" ? "eBay Sold" : "eBay Active",
    status,
    message: results.length
      ? `${results.length} strict exact ${params.lane} result${results.length === 1 ? "" : "s"} passed after ${attempts.length} query attempt${attempts.length === 1 ? "" : "s"}.`
      : firstError || `No strict exact ${params.lane} results passed after ${attempts.length} query attempt${attempts.length === 1 ? "" : "s"}.`,
    results,
    searchUrl: verificationUrl(primaryQuery, params.lane),
    attempts,
  } satisfies InstaCompProviderResult & { attempts: ProviderAttempt[] };
}

export async function getExactEbayMarketProviders(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const queries = buildExactEbayQueryLadder(params);
  const [sold, active] = await Promise.all([
    providerAcrossQueries({ queries, ai: params.ai, lane: "sold", targetExactCount: 8 }),
    providerAcrossQueries({ queries, ai: params.ai, lane: "active", targetExactCount: 8 }),
  ]);
  return {
    query: queries[0] || params.fallbackQuery,
    queries,
    sold,
    active,
  };
}
