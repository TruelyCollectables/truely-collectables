import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) throw new Error(`Could not find ${label}.`);
  return content.replace(search, replacement);
}

const scanPath = "src/app/api/instacomp/scan/route.ts";
let scan = read(scanPath);
scan = replaceOnce(
  scan,
  `      searchQuery: queries.primary,
      exactStoredTitleQuery: universalEbay.query,
      backupQueries: queries.backupQueries,
      stats,`,
  `      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      stats,`,
  "remove response-only field from scan persistence call",
);
scan = replaceOnce(
  scan,
  `      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      links,
      providers,`,
  `      searchQuery: queries.primary,
      exactStoredTitleQuery: universalEbay.query,
      backupQueries: queries.backupQueries,
      links,
      providers,`,
  "add exact stored title to response payload",
);
scan = replaceOnce(
  scan,
  `    if (provider.label === "eBay Active") {
      directProviderBySourceLabel.set("ebay active", provider);
    }`,
  `    if (provider.label === "eBay Active") {
      directProviderBySourceLabel.set("ebay active", provider);
    }
    if (provider.label === "eBay Sold") {
      directProviderBySourceLabel.set("ebay sold", provider);
    }`,
  "eBay sold source coverage",
);
write(scanPath, scan);

const providerPath = "src/lib/instacomp-ebay-serp-provider.ts";
let provider = read(providerPath);
provider = replaceOnce(
  provider,
  `const CACHE_TTL_DAYS = 7;
const RESULT_LIMIT = 50;`,
  `const SOLD_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const RESULT_LIMIT = 50;`,
  "lane-specific cache TTL constants",
);
provider = replaceOnce(
  provider,
  `      expires_at: new Date(now.getTime() + CACHE_TTL_DAYS * 86_400_000).toISOString(),`,
  `      expires_at: new Date(
        now.getTime() + (lane === "sold" ? SOLD_CACHE_TTL_MS : ACTIVE_CACHE_TTL_MS),
      ).toISOString(),`,
  "lane-specific cache expiration",
);
provider = replaceOnce(
  provider,
  `export async function getUniversalEbaySerpProviders(params: {
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
}`,
  `function hasExactResult(result: InstaCompProviderResult) {
  return result.results.some(
    (comp) =>
      !comp.flags.includes("guidance comp") &&
      !comp.flags.includes("not used for pricing") &&
      !comp.flags.some((flag) => /parallel mismatch|not exact parallel/i.test(flag)),
  );
}

function mergeProviderResults(
  primary: InstaCompProviderResult,
  fallback: InstaCompProviderResult | null,
) {
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
    message: [primary.message, fallback.message]
      .filter(Boolean)
      .join(" Fallback identity query: "),
  } satisfies InstaCompProviderResult;
}

export async function getUniversalEbaySerpProviders(params: {
  exactTitle: string | null | undefined;
  fallbackQuery: string;
  ai: InstaCompAiResult;
}) {
  const primaryQuery = String(params.exactTitle || params.fallbackQuery || "").trim();
  const fallbackQuery = String(params.fallbackQuery || "").trim();
  const [primarySold, primaryActive] = await Promise.all([
    provider(primaryQuery, params.ai, "sold"),
    provider(primaryQuery, params.ai, "active"),
  ]);

  const fallbackIsDifferent =
    normalizeKey(fallbackQuery) && normalizeKey(fallbackQuery) !== normalizeKey(primaryQuery);
  const [fallbackSold, fallbackActive] = fallbackIsDifferent
    ? await Promise.all([
        hasExactResult(primarySold) ? Promise.resolve(null) : provider(fallbackQuery, params.ai, "sold"),
        hasExactResult(primaryActive)
          ? Promise.resolve(null)
          : provider(fallbackQuery, params.ai, "active"),
      ])
    : [null, null];

  return {
    query: primaryQuery,
    fallbackQuery: fallbackIsDifferent ? fallbackQuery : null,
    sold: mergeProviderResults(primarySold, fallbackSold),
    active: mergeProviderResults(primaryActive, fallbackActive),
  };
}`,
  "exact-title-first fallback provider search",
);
write(providerPath, provider);

fs.rmSync("scripts/finalize-instacomp-universal-ebay-sold.mjs");
console.log("Finalized universal eBay sold/active search with exact-title-first fallback and lane-specific caching.");
