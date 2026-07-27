from __future__ import annotations

from pathlib import Path


BENCHMARK_ROUTE = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
SCAN_ROUTE = Path("src/app/api/instacomp/scan/route.ts")
EXACT_PROVIDER = Path("src/lib/instacomp-exact-market-provider.ts")
OPENAI_PROVIDER = Path("src/lib/instacomp-openai-web-market-provider.ts")
VISUAL_VERIFIER = Path("src/lib/instacomp-comp-visual-verification.ts")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Could not locate {label} in {path}")
    path.write_text(text.replace(old, new, 1))


def patch_benchmark_tier() -> None:
    replace_once(
        BENCHMARK_ROUTE,
        '    formData.append("aiCouncilTier", "adaptive");\n',
        '''    formData.append(
      "aiCouncilTier",
      clean(process.env.INSTACOMP_BENCHMARK_COUNCIL_TIER) || "adaptive",
    );
''',
        "benchmark AI-council tier",
    )


def patch_ephemeral_legacy_providers() -> None:
    old = '''    const [
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
'''
    new = '''    let ebayProvider: InstaCompProviderResult;
    let tcosProvider: InstaCompProviderResult;
    let priceChartingProvider: InstaCompProviderResult;
    let externalSearchProvider: InstaCompProviderResult;

    if (ephemeralBenchmark) {
      const skippedProvider = (
        source: string,
        label: string,
      ): InstaCompProviderResult => ({
        source,
        label,
        status: "not_configured",
        message:
          "Skipped duplicate legacy market discovery during the signed exact-market benchmark.",
        results: [],
      });
      ebayProvider = skippedProvider("ebay_active", "eBay Active");
      tcosProvider = skippedProvider("tcos_inventory", "TCOS Inventory");
      priceChartingProvider = skippedProvider(
        "pricecharting_api",
        "SportsCardsPro Guide",
      );
      externalSearchProvider = skippedProvider(
        "external_comp_search",
        "External Comp Search",
      );
    } else {
      [
        ebayProvider,
        tcosProvider,
        priceChartingProvider,
        externalSearchProvider,
      ] = await Promise.all([
        getBestEbayProvider(compQueries, ai, links.ebayActiveUrl),
        getTcosInventoryProvider(queries.primary, ai),
        getPriceChartingProvider(queries.primary, ai),
        getExternalSearchProvider(queries.primary, ai, links.broadCardMarketUrl),
      ]);
    }
'''
    replace_once(SCAN_ROUTE, old, new, "ephemeral legacy-provider bypass")


def patch_primary_timeout() -> None:
    old = '''    response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
'''
    new = '''    response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
'''
    replace_once(SCAN_ROUTE, old, new, "primary OpenAI timeout")


def patch_exact_cache_bypass() -> None:
    replace_once(
        EXACT_PROVIDER,
        '''async function readCache(query: string, lane: EbayLane) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
''',
        '''async function readCache(query: string, lane: EbayLane) {
  if (
    process.env.INSTACOMP_BYPASS_CACHE === "1" ||
    !SUPABASE_URL ||
    !SUPABASE_KEY
  ) {
    return null;
  }
''',
        "exact-market cache read bypass",
    )
    replace_once(
        EXACT_PROVIDER,
        '''async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !items.length) return;
''',
        '''async function writeCache(query: string, lane: EbayLane, items: EbaySerpItem[]) {
  if (
    process.env.INSTACOMP_BYPASS_CACHE === "1" ||
    !SUPABASE_URL ||
    !SUPABASE_KEY ||
    !items.length
  ) {
    return;
  }
''',
        "exact-market cache write bypass",
    )


def patch_openai_discovery_bypass() -> None:
    replace_once(
        OPENAI_PROVIDER,
        '''async function readCache(key: string) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
''',
        '''async function readCache(key: string) {
  if (
    process.env.INSTACOMP_BYPASS_CACHE === "1" ||
    !SUPABASE_URL ||
    !SUPABASE_KEY
  ) {
    return null;
  }
''',
        "OpenAI market cache read bypass",
    )
    replace_once(
        OPENAI_PROVIDER,
        '''async function writeCache(key: string, exactTitle: string, result: OpenAiWebMarketProviderResult) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
''',
        '''async function writeCache(key: string, exactTitle: string, result: OpenAiWebMarketProviderResult) {
  if (
    process.env.INSTACOMP_BYPASS_CACHE === "1" ||
    !SUPABASE_URL ||
    !SUPABASE_KEY
  ) {
    return;
  }
''',
        "OpenAI market cache write bypass",
    )
    replace_once(
        OPENAI_PROVIDER,
        '''}): Promise<OpenAiWebMarketProviderResult> {
  if (!OPENAI_API_KEY) return errorResult("OPENAI_API_KEY is not configured for exact web market search.");
''',
        '''}): Promise<OpenAiWebMarketProviderResult> {
  if (process.env.INSTACOMP_SKIP_OPENAI_WEB === "1") {
    const message =
      "OpenAI web discovery was intentionally skipped for this signed benchmark; SerpApi exact-market evidence remains authoritative.";
    return {
      model: null,
      responseId: null,
      citedItemIds: [],
      notes: message,
      sold: providerResult({
        lane: "sold",
        results: [],
        message,
        status: "no_matches",
      }),
      active: providerResult({
        lane: "active",
        results: [],
        message,
        status: "no_matches",
      }),
      cached: false,
    };
  }
  if (!OPENAI_API_KEY) return errorResult("OPENAI_API_KEY is not configured for exact web market search.");
''',
        "OpenAI discovery benchmark bypass",
    )


def patch_visual_limit() -> None:
    replace_once(
        VISUAL_VERIFIER,
        '''const MAX_VISUAL_CANDIDATES = 6;
const VISUAL_REVIEW_CONCURRENCY = 2;
''',
        '''const requestedVisualCandidates = Number(
  process.env.INSTACOMP_VISUAL_MAX_CANDIDATES || 6,
);
const MAX_VISUAL_CANDIDATES = Number.isFinite(requestedVisualCandidates)
  ? Math.max(1, Math.min(6, Math.floor(requestedVisualCandidates)))
  : 6;
const VISUAL_REVIEW_CONCURRENCY = 2;
''',
        "visual candidate limit",
    )


def main() -> None:
    patch_benchmark_tier()
    patch_ephemeral_legacy_providers()
    patch_primary_timeout()
    patch_exact_cache_bypass()
    patch_openai_discovery_bypass()
    patch_visual_limit()


if __name__ == "__main__":
    main()
