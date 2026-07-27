import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  buildInstaCompQueries,
  filterAndRankExactMatches,
  filterAndRankGuidanceMatches,
  normalizeInstaCompParallelForExactMatching,
  type InstaCompAiResult,
  type InstaCompComp,
  type InstaCompProviderResult,
} from "./instacomp";

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SOLD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const RESULT_LIMIT = 50;

type EbayLane = "sold" | "active";

export type EbaySerpItem = {
  title: string;
  link: string;
  productId: string | null;
  price: number;
  itemPrice: number;
  shippingPrice: number;
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
    .update(`serpapi_ebay_v6_${lane}:${normalizeKey(query)}`)
    .digest("hex");
}

function extractedPrice(value: unknown): number {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const direct = Number(record.extracted);
  if (Number.isFinite(direct) && direct > 0) return direct;

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
  return 0;
}

function extractedShipping(value: unknown): number {
  if (typeof value === "string") {
    if (/free/i.test(value)) return 0;
    const match = value.replace(/,/g, "").match(/(?:\$|USD\s*)(\d+(?:\.\d{1,2})?)/i);
    const parsed = match ? Number(match[1]) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return extractedPrice(value);
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
      const itemPrice = extractedPrice(item.price);
      const shippingPrice = extractedShipping(item.shipping);
      const price = Math.round((itemPrice + shippingPrice) * 100) / 100;
      const link = itemLink(item);
      if (!title || !itemPrice || !price || !link) return null;

      return {
        title,
        link,
        productId: typeof item.product_id === "string" ? item.product_id : null,
        price,
        itemPrice,
        shippingPrice,
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
  if (process.env.INSTACOMP_BYPASS_CACHE === "1") url.searchParams.set("no_cache", "true");
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
  if (process.env.INSTACOMP_BYPASS_CACHE === "1") return null;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload")
    .eq("query_hash", cacheKey(query, lane))
    .eq("provider", `serpapi_ebay_${lane}`)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data?.result_payload) return null;
  const payload = data.result_payload as CachedPayload;
  return Array.isArray(payload.items) && payload.items.length ? payload.items : null;
}

async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (process.env.INSTACOMP_BYPASS_CACHE === "1") return;
  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const now = new Date();
  const ttl = lane === "sold" ? SOLD_CACHE_TTL_MS : ACTIVE_CACHE_TTL_MS;
  const { error } = await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: cacheKey(query, lane),
      provider: `serpapi_ebay_${lane}`,
      normalized_query: normalizeKey(query),
      result_payload: { query, lane, items } satisfies CachedPayload,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl).toISOString(),
      hit_count: 0,
    },
    { onConflict: "query_hash" },
  );
  if (error) console.error(`InstaComp eBay ${lane} cache write failed:`, error.message);
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

function setImpliesRelic(ai: InstaCompAiResult) {
  return /\b(swatch|swatches|material|materials|memorabilia|relic|relics|jersey|jerseys|patch|patches)\b/i.test(
    String(ai.setName || ""),
  );
}

function setImpliesAutograph(ai: InstaCompAiResult) {
  return /\b(autograph|autographs|signature|signatures|signed)\b/i.test(
    String(ai.setName || ""),
  );
}

function titleForMatching(title: string, ai: InstaCompAiResult) {
  const additions: string[] = [];
  if (
    ai.isRelic &&
    setImpliesRelic(ai) &&
    !/\b(relic|patch|jersey|memorabilia|mem)\b/i.test(title)
  ) {
    additions.push("memorabilia");
  }
  if (
    ai.isAuto &&
    setImpliesAutograph(ai) &&
    !/\b(auto|autograph|autographed|signed|signature)\b/i.test(title)
  ) {
    additions.push("autograph");
  }
  return additions.length ? `${title} ${additions.join(" ")}` : title;
}

function normalizedWords(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " " )
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function compactIdentity(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function titleSerialDenominator(value: string | null | undefined) {
  const matches = Array.from(String(value || "").matchAll(/(?:\b\d{1,6}\s*)?\/\s*(\d{1,6})\b/g));
  const parsed = matches
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
  return parsed.length ? parsed[parsed.length - 1] : null;
}

function compactSearchPart(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  const special = "\\^$.*+?()[]{}|";
  return value
    .split("")
    .map((character) => special.includes(character) ? `\\${character}` : character)
    .join("");
}

function sanitizeExactSearchQuery(value: string, ai: InstaCompAiResult) {
  let query = compactSearchPart(value);
  const denominator = titleSerialDenominator(ai.serialNumber);
  if (denominator) {
    query = query
      .replace(
        new RegExp(`\\b\\d{1,6}\\s*\\/\\s*0*${denominator}\\b`, "gi"),
        `/${denominator}`,
      )
      .replace(
        new RegExp(`\\b(?:serial(?:ly)?[-\\s]?numbered|numbered)\\s*(?:to|\\/)?\\s*0*${denominator}\\b`, "gi"),
        `/${denominator}`,
      );
  }
  const cert = compactIdentity(ai.certificationNumber);
  if (cert) {
    query = query.replace(new RegExp(escapeRegExp(cert), "gi"), " ");
  }
  return query
    .replace(/\bcert(?:ification)?\s*[#:.-]*\s*[a-z0-9-]{5,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildExactEbayQueryLadder(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const ai = params.ai;
  const built = buildInstaCompQueries(ai);
  const denominator = titleSerialDenominator(ai.serialNumber);
  const serialRun = denominator ? `/${denominator}` : "";
  const parallel = normalizeInstaCompParallelForExactMatching(ai.parallel);
  const grade = [ai.gradingCompany, ai.gradeValue].map(compactSearchPart).filter(Boolean).join(" ");
  const cardNumber = compactSearchPart(ai.cardNumber)
    ? `#${compactSearchPart(ai.cardNumber).replace(/^#/, "")}`
    : "";
  const identityFeatures = [
    ai.isRookie ? "rookie" : "",
    ai.isAuto ? "auto" : "",
    ai.isRelic ? "patch" : "",
  ].filter(Boolean);

  const candidates = [
    [
      grade,
      compactSearchPart(ai.year),
      compactSearchPart(ai.player),
      cardNumber,
      parallel,
      serialRun,
      ...identityFeatures,
    ].filter(Boolean).join(" "),
    [
      grade,
      compactSearchPart(ai.year),
      compactSearchPart(ai.brand),
      compactSearchPart(ai.setName),
      compactSearchPart(ai.player),
      cardNumber,
      parallel,
      serialRun,
    ].filter(Boolean).join(" "),
    sanitizeExactSearchQuery(String(params.exactTitle || ""), ai),
    sanitizeExactSearchQuery(String(params.fallbackQuery || ""), ai),
    sanitizeExactSearchQuery(built.primary, ai),
    ...built.backupQueries.map((query) => sanitizeExactSearchQuery(query, ai)),
  ];

  const seen = new Set<string>();
  return candidates
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query.length >= 4)
    .filter((query) => {
      const key = normalizeKey(query);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function deterministicExactTitle(
  title: string,
  query: string,
  ai: InstaCompAiResult,
  flags: string[],
) {
  if (flags.some((flag) => /parallel mismatch|wrong parallel|excluded/i.test(flag))) return false;
  const normalizedTitle = " " + normalizedWords(title).join(" " ) + " ";
  const titleCompact = compactIdentity(title);
  const player = normalizedWords(String(ai.player || ""));
  if (player.length && !player.every((token) => normalizedTitle.includes(" " + token + " "))) return false;
  const year = compactIdentity(ai.year);
  if (year && !titleCompact.includes(year)) return false;
  const cardNumber = compactIdentity(ai.cardNumber);
  if (cardNumber && !titleCompact.includes(cardNumber)) return false;

  const distinctiveParallelTokens = normalizedWords(
    normalizeInstaCompParallelForExactMatching(ai.parallel),
  ).filter(
    (token) => !["prizm", "refractor", "parallel", "foil", "holo"].includes(token),
  );
  if (
    distinctiveParallelTokens.length &&
    !distinctiveParallelTokens.every((token) => normalizedTitle.includes(" " + token + " "))
  ) return false;

  const targetDenominator = titleSerialDenominator(ai.serialNumber);
  const candidateDenominator = titleSerialDenominator(title);
  if (targetDenominator) {
    if (candidateDenominator !== targetDenominator) return false;
  } else if (candidateDenominator !== null) {
    return false;
  }

  if (ai.gradingCompany && !flags.includes("grader")) return false;
  if (ai.gradeValue && !flags.includes("grade")) return false;
  if (ai.isAuto && !flags.includes("autograph")) return false;
  if (ai.isRelic && !flags.includes("relic")) return false;

  const queryTokens = normalizedWords(query).filter(
    (token) => !["panini", "topps", "upper", "deck", "rookie", "card"].includes(token),
  );
  const covered = queryTokens.filter((token) => normalizedTitle.includes(" " + token + " " )).length;
  const coverage = queryTokens.length ? covered / queryTokens.length : 0;
  return coverage >= 0.68;
}

function promoteDeterministicExact(
  comps: InstaCompComp[],
  query: string,
  ai: InstaCompAiResult,
  lane: EbayLane,
) {
  return comps.map((comp) => {
    if (!deterministicExactTitle(comp.title, query, ai, comp.flags)) return comp;
    const flags = comp.flags.filter(
      (flag) => !/guidance comp|not used for pricing|not exact parallel/i.test(flag),
    );
    flags.push("deterministic exact identity");
    return {
      ...comp,
      sourceCategory: lane === "sold" ? ("sold" as const) : ("marketplace" as const),
      flags: Array.from(new Set(flags)).slice(0, 20),
    };
  });
}

function rawComps(items: EbaySerpItem[], lane: EbayLane) {
  return items.map((item) => ({
    title: item.title,
    price: item.price,
    itemPrice: item.itemPrice,
    shippingPrice: item.shippingPrice,
    priceIncludesShipping: true,
    currency: "USD",
    url: item.link,
    imageUrl: item.thumbnail,
    source: lane === "sold" ? "ebay_sold_serpapi" : "ebay_active_serpapi",
    sourceLabel: lane === "sold" ? "eBay Sold" : "eBay Active",
    sourceCategory: lane === "sold" ? ("sold" as const) : ("marketplace" as const),
    soldAt: lane === "sold" ? item.soldDate : null,
    listedAt: lane === "active" ? item.listingDate : null,
    observedAt: new Date().toISOString(),
  }));
}

function scoreWithSetEvidence(
  items: EbaySerpItem[],
  lane: EbayLane,
  ai: InstaCompAiResult,
) {
  const originals = rawComps(items, lane);
  const byUrl = new Map(originals.map((comp) => [comp.url, comp]));
  const matchRows = originals.map((comp) => ({
    ...comp,
    title: titleForMatching(comp.title, ai),
  }));
  const exact = filterAndRankExactMatches(matchRows, ai, lane === "sold" ? 40 : 20, 35);
  const exactUrls = new Set(exact.map((comp) => comp.url));
  const guidance = filterAndRankGuidanceMatches(matchRows, ai, 20, 15).filter(
    (comp) => !exactUrls.has(comp.url),
  );

  return [...exact, ...guidance].map((comp) => {
    const original = byUrl.get(comp.url);
    const flags = [...comp.flags];
    if (original && original.title !== comp.title) flags.push("set name proves relic/autograph evidence");
    return {
      ...comp,
      title: original?.title || comp.title,
      flags: Array.from(new Set(flags)).slice(0, 20),
    };
  });
}

async function provider(query: string, ai: InstaCompAiResult, lane: EbayLane) {
  const fetched = await fetchLane(query, lane);
  if (!fetched.ok) {
    return {
      source: lane === "sold" ? "ebay_sold_serpapi" : "ebay_active_serpapi",
      label: lane === "sold" ? "eBay Sold" : "eBay Active",
      status: SERPAPI_API_KEY ? "error" : "not_configured",
      message: fetched.message,
      results: [],
      searchUrl: verificationUrl(query, lane),
    } satisfies InstaCompProviderResult;
  }

  const results = promoteDeterministicExact(
    scoreWithSetEvidence(fetched.items, lane, ai),
    query,
    ai,
    lane,
  ).slice(0, lane === "sold" ? 50 : 30);
  return {
    source: lane === "sold" ? "ebay_sold_serpapi" : "ebay_active_serpapi",
    label: lane === "sold" ? "eBay Sold" : "eBay Active",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? `${fetched.cached ? "Loaded cached" : "Fetched"} structured eBay ${lane} results using the exact stored title.`
      : `eBay returned ${fetched.items.length} structured ${lane} result${fetched.items.length === 1 ? "" : "s"}, but none passed exact-card or review-candidate filtering.`,
    results,
    searchUrl: verificationUrl(query, lane),
  } satisfies InstaCompProviderResult;
}

function hasExactResult(result: InstaCompProviderResult) {
  return result.results.some(
    (comp) =>
      !comp.flags.includes("guidance comp") &&
      !comp.flags.includes("not used for pricing") &&
      !comp.flags.some((flag) => /parallel mismatch|not exact parallel/i.test(flag)),
  );
}

function mergeProviders(primary: InstaCompProviderResult, fallback: InstaCompProviderResult | null) {
  if (!fallback) return primary;
  const seen = new Set<string>();
  const results = [...primary.results, ...fallback.results].filter((comp) => {
    if (seen.has(comp.url)) return false;
    seen.add(comp.url);
    return true;
  });
  return {
    ...primary,
    status: results.length ? "live" : primary.status,
    results,
    message: [primary.message, fallback.message].filter(Boolean).join(" Fallback query: "),
  } satisfies InstaCompProviderResult;
}

async function providerAcrossQueries(
  queries: string[],
  ai: InstaCompAiResult,
  lane: EbayLane,
) {
  let combined: InstaCompProviderResult | null = null;
  const queryAttempts: string[] = [];
  const targetExactCount = lane === "sold" ? 5 : 8;

  for (const query of queries) {
    const next = await provider(query, ai, lane);
    queryAttempts.push(query);
    combined = combined ? mergeProviders(combined, next) : next;
    const exactCount = combined.results.filter(
      (comp) =>
        !comp.flags.includes("guidance comp") &&
        !comp.flags.includes("not used for pricing") &&
        !comp.flags.some((flag) => /parallel mismatch|not exact parallel|excluded/i.test(flag)),
    ).length;
    if (exactCount >= targetExactCount) break;
    if ((next.status === "not_configured" || next.status === "error") && next.results.length === 0) {
      break;
    }
  }

  const fallback = combined || (await provider(queries[0] || "sports card", ai, lane));
  const exactCount = fallback.results.filter(
    (comp) =>
      !comp.flags.includes("guidance comp") &&
      !comp.flags.includes("not used for pricing") &&
      !comp.flags.some((flag) => /parallel mismatch|not exact parallel|excluded/i.test(flag)),
  ).length;
  return {
    ...fallback,
    status: exactCount > 0 ? "live" : fallback.status === "not_configured" || fallback.status === "error"
      ? fallback.status
      : "no_matches",
    queryAttempts,
    message: exactCount > 0
      ? `Found ${exactCount} exact eBay ${lane} match${exactCount === 1 ? "" : "es"} after ${queryAttempts.length} exact-identity quer${queryAttempts.length === 1 ? "y" : "ies"}.`
      : `No exact eBay ${lane} match survived identity, parallel, print-run, grade, and condition gates after ${queryAttempts.length} quer${queryAttempts.length === 1 ? "y" : "ies"}.`,
  };
}

export async function getUniversalEbaySerpProviders(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const queries = buildExactEbayQueryLadder(params);
  const [sold, active] = await Promise.all([
    providerAcrossQueries(queries, params.ai, "sold"),
    providerAcrossQueries(queries, params.ai, "active"),
  ]);

  return {
    query: queries[0] || String(params.exactTitle || params.fallbackQuery || "").trim(),
    fallbackQuery: queries[1] || null,
    queries,
    sold,
    active,
  };
}
