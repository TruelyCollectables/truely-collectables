import assert from "node:assert/strict";
import fs from "node:fs";
import {
  calculateCompStats,
  type InstaCompAiResult,
  type InstaCompComp,
} from "../src/lib/instacomp";

const exactTitle =
  "2025 Panini Select Shedeur Sanders Rookie Swatches Red Prizm #RSW-SSS";

const soldRows = [
  ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 3.99, "2026-07-18"],
  ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 3.0, "2026-07-16"],
  ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 4.0, "2026-07-16"],
  ["2025 Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 5.0, "2026-07-13"],
  ["2025 Select Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 1.99, "2026-07-10"],
  ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 5.0, "2026-07-07"],
  ["2025 Select Rookie Swatches Shedeur Sanders #RSW-SSS Red Prizm", 2.1, "2026-07-04"],
  ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS Blue Prizm", 6.0, "2026-06-06"],
  ["2025 Panini Select - Rookie Swatches Shedeur Sanders #RSW-SSS White Prizm 21/99", 12.49, "2026-07-19"],
] as const;

function payload(rows: readonly (readonly [string, number, string])[]) {
  return {
    search_information: { total_results: rows.length },
    organic_results: rows.map(([title, price, date], index) => ({
      title,
      link: `https://www.ebay.com/itm/${1000 + index}`,
      product_id: String(1000 + index),
      price: { raw: `$${price}`, extracted: price },
      thumbnail: `https://i.ebayimg.com/images/g/test${index}/s-l225.jpg`,
      sold_date: date,
      listing_date: date,
      condition: "Pre-Owned",
    })),
  };
}

async function main() {
  const originalKey = process.env.SERPAPI_API_KEY;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;

  process.env.SERPAPI_API_KEY = "regression-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const requestedUrls: URL[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    requestedUrls.push(url);
    const sold = url.searchParams.get("show_only") === "Sold";
    return new Response(JSON.stringify(payload(sold ? soldRows : soldRows.slice(0, 3))), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const {
      buildSerpApiEbayRequestUrl,
      getUniversalEbaySerpProviders,
      normalizeEbaySerpItems,
    } = await import("../src/lib/instacomp-ebay-serp-provider");

    const soldUrl = buildSerpApiEbayRequestUrl(exactTitle, "sold", "test-key");
    const activeUrl = buildSerpApiEbayRequestUrl(exactTitle, "active", "test-key");
    assert.equal(soldUrl.searchParams.get("engine"), "ebay");
    assert.equal(soldUrl.searchParams.get("_nkw"), exactTitle);
    assert.equal(soldUrl.searchParams.get("show_only"), "Sold");
    assert.equal(soldUrl.searchParams.get("_ipg"), "50");
    assert.equal(activeUrl.searchParams.get("show_only"), null);
    assert.equal(activeUrl.searchParams.get("_sop"), "10");

    const normalized = normalizeEbaySerpItems(payload(soldRows));
    assert.equal(normalized.length, 9);
    assert.equal(normalized[0].price, 3.99);
    assert.equal(normalized[0].soldDate, "2026-07-18");
    assert.match(normalized[0].link, /^https:\/\/www\.ebay\.com\/itm\//);

    const ai: InstaCompAiResult = {
      player: "Shedeur Sanders",
      year: "2025",
      brand: "Panini",
      setName: "Select Rookie Swatches",
      cardNumber: "RSW-SSS",
      parallel: "Red Prizm",
      serialNumber: null,
      team: "Browns",
      sport: "Football",
      isRookie: true,
      isAuto: false,
      isRelic: true,
      conditionGuess: "Near Mint",
      confidence: 1,
      notes: null,
    };

    const universal = await getUniversalEbaySerpProviders({
      exactTitle,
      fallbackQuery: exactTitle,
      ai,
    });
    assert.equal(requestedUrls.length, 2, "One exact-title sold search and one exact-title active search must run.");
    assert.ok(requestedUrls.some((url) => url.searchParams.get("show_only") === "Sold"));
    assert.ok(requestedUrls.every((url) => url.searchParams.get("_nkw") === exactTitle));

    const exactSold = universal.sold.results.filter(
      (comp) =>
        !comp.flags.includes("guidance comp") &&
        !comp.flags.includes("not used for pricing") &&
        !comp.flags.some((flag) => /parallel mismatch|not exact parallel/i.test(flag)),
    );
    assert.equal(
      exactSold.length,
      7,
      "All seven exact Red Rookie Swatches sales must pass even when seller titles omit relic/MEM wording.",
    );
    assert.ok(exactSold.every((comp) => !/Blue|White/i.test(comp.title)));
    assert.ok(
      exactSold.every((comp) =>
        comp.flags.includes("set name proves relic/autograph evidence"),
      ),
    );
    const stats = calculateCompStats(exactSold as InstaCompComp[]);
    assert.equal(stats.suggestedPrice, 3.99);
    assert.equal(stats.low, 1.99);
    assert.equal(stats.high, 5);

    const universalRoute = fs.readFileSync(
      "src/app/api/account/seller/inventory/instacomp-universal/route.ts",
      "utf8",
    );
    const nextConfig = fs.readFileSync("next.config.ts", "utf8");
    assert.ok(universalRoute.includes("getUniversalEbaySerpProviders"));
    assert.ok(universalRoute.includes("exactTitle: item.title"));
    assert.ok(universalRoute.includes("const suggestedPrice = soldSuggestion(soldCompEvidence)"));
    assert.ok(universalRoute.includes("visualSoldReview") || universalRoute.includes("soldReview"));
    assert.ok(nextConfig.includes("beforeFiles"));
    assert.ok(nextConfig.includes("instacomp-universal"));

    console.log(
      "Universal eBay InstaComp regression passed: every card uses exact stored-title sold and active lanes, seven exact Shedeur Red sales survive omitted MEM wording, Blue/White are excluded, and the accepted sold median is $3.99.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SERPAPI_API_KEY;
    else process.env.SERPAPI_API_KEY = originalKey;
    if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    if (originalSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    if (originalAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
