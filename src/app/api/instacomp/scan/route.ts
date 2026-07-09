import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
  buildCompLinks,
  buildInstaCompQueries,
  calculateCompStats,
  filterAndRankExactMatches,
  looksLikeBadCompTitle,
} from "../../../../lib/instacomp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const COMC_APIFY_ACTOR_ID =
  process.env.COMC_APIFY_ACTOR_ID || "lulzasaur/comc-scraper";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      details,
    },
    { status }
  );
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";

  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function identifyCardWithOpenAI(frontDataUrl: string, backDataUrl?: string) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const content: any[] = [
    {
      type: "text",
      text: `
You are InstaComp™, an AI sports card identification assistant for TCOS.

Analyze the uploaded card image or images. Identify the exact collectible card as accurately as possible.

Return JSON only.

Rules:
- If you are unsure about a field, use null.
- Confidence must be between 0 and 1.
- Do not hallucinate serial numbers. Only return a serial number if visible.
- Be careful with parallels, refractors, prizms, color, autos, relics, and rookie status.
- If the image is not a sports card, still describe what it appears to be and lower confidence.
      `.trim(),
    },
    {
      type: "image_url",
      image_url: {
        url: frontDataUrl,
      },
    },
  ];

  if (backDataUrl) {
    content.push({
      type: "image_url",
      image_url: {
        url: backDataUrl,
      },
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "instacomp_card_scan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              player: { type: ["string", "null"] },
              year: { type: ["string", "null"] },
              brand: { type: ["string", "null"] },
              setName: { type: ["string", "null"] },
              cardNumber: { type: ["string", "null"] },
              parallel: { type: ["string", "null"] },
              serialNumber: { type: ["string", "null"] },
              team: { type: ["string", "null"] },
              sport: { type: ["string", "null"] },
              isRookie: { type: "boolean" },
              isAuto: { type: "boolean" },
              isRelic: { type: "boolean" },
              conditionGuess: { type: ["string", "null"] },
              confidence: { type: "number" },
              notes: { type: ["string", "null"] },
            },
            required: [
              "player",
              "year",
              "brand",
              "setName",
              "cardNumber",
              "parallel",
              "serialNumber",
              "team",
              "sport",
              "isRookie",
              "isAuto",
              "isRelic",
              "conditionGuess",
              "confidence",
              "notes",
            ],
          },
        },
      },
      messages: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI scan failed: ${errorText}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("OpenAI returned no scan content.");
  }

  const parsed = JSON.parse(text) as InstaCompAiResult;

  return {
    ...parsed,
    confidence:
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0,
  };
}

async function getEbayAppToken() {
  if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    return null;
  }

  const auth = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString(
    "base64"
  );

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }).toString(),
  });

  if (!response.ok) {
    console.error("eBay token error:", await response.text());
    return null;
  }

  const data = await response.json();

  return data?.access_token || null;
}

async function getEbayProvider(
  query: string,
  ai: InstaCompAiResult,
  searchUrl: string
): Promise<InstaCompProviderResult> {
  const token = await getEbayAppToken();

  if (!token) {
    return {
      source: "ebay_active",
      label: "eBay Active",
      status: "not_configured",
      message: "eBay API token was not available.",
      results: [],
      searchUrl,
    };
  }

  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "25");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "Accept-Language": "en-US",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    console.error("eBay Browse search error:", await response.text());

    return {
      source: "ebay_active",
      label: "eBay Active",
      status: "error",
      message: "eBay search failed.",
      results: [],
      searchUrl,
    };
  }

  const data = await response.json();
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = items
    .map((item: any) => {
      const value = Number(item?.price?.value);

      return {
        title: String(item?.title || ""),
        price: Number.isFinite(value) ? value : 0,
        currency: String(item?.price?.currency || "USD"),
        url: String(item?.itemWebUrl || ""),
        imageUrl: item?.image?.imageUrl ? String(item.image.imageUrl) : null,
        source: "ebay_active" as const,
        sourceLabel: "eBay Active",
      };
    })
    .filter((item) => {
      if (!item.title || !item.url || !item.price) return false;
      if (looksLikeBadCompTitle(item.title, ai)) return false;

      return true;
    });

  const results = filterAndRankExactMatches(rawComps, ai, 3, 55);

  return {
    source: "ebay_active",
    label: "eBay Active",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? null
      : "No exact raw matches passed the InstaComp™ filter.",
    results,
    searchUrl,
  };
}

function extractComcPrice(item: any) {
  const raw =
    item?.price ??
    item?.askingPrice ??
    item?.salePrice ??
    item?.lowestPrice ??
    item?.listPrice ??
    item?.priceText;

  if (typeof raw === "number") return raw;

  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parsed = Number(cleaned);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function extractComcUrl(item: any) {
  return (
    item?.url ||
    item?.listingUrl ||
    item?.cardUrl ||
    item?.productUrl ||
    item?.href ||
    ""
  );
}

function extractComcImage(item: any) {
  return (
    item?.image ||
    item?.imageUrl ||
    item?.thumbnail ||
    item?.thumbnailUrl ||
    item?.frontImage ||
    null
  );
}

function extractComcTitle(item: any) {
  return (
    item?.title ||
    item?.name ||
    item?.cardTitle ||
    [
      item?.year,
      item?.set,
      item?.player,
      item?.subject,
      item?.cardNumber ? `#${item.cardNumber}` : null,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

async function getComcProvider(
  query: string,
  ai: InstaCompAiResult,
  searchUrl: string
): Promise<InstaCompProviderResult> {
  if (!APIFY_TOKEN) {
    return {
      source: "comc_active",
      label: "COMC Active",
      status: "not_configured",
      message: "Missing APIFY_TOKEN in .env.local.",
      results: [],
      searchUrl,
    };
  }

  const actorIdForUrl = COMC_APIFY_ACTOR_ID.replace("/", "~");
  const endpoint = `https://api.apify.com/v2/acts/${actorIdForUrl}/run-sync-get-dataset-items?token=${encodeURIComponent(
    APIFY_TOKEN
  )}`;

  const input = {
    searchQueries: [query],
    maxResults: 25,
    scrapeDetails: false,
    proxyConfiguration: {
      useApifyProxy: false,
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("COMC Apify error:", errorText);

      return {
        source: "comc_active",
        label: "COMC Active",
        status: "error",
        message:
          "COMC Apify actor failed. Check Apify token, actor access, or credits.",
        results: [],
        searchUrl,
      };
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : [];

    const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = items
      .map((item: any) => {
        const title = String(extractComcTitle(item) || "");
        const price = extractComcPrice(item);
        const url = String(extractComcUrl(item) || "");
        const imageUrl = extractComcImage(item);

        return {
          title,
          price,
          currency: "USD",
          url,
          imageUrl: imageUrl ? String(imageUrl) : null,
          source: "comc_active" as const,
          sourceLabel: "COMC Active",
        };
      })
      .filter((item) => {
        if (!item.title || !item.price) return false;
        if (looksLikeBadCompTitle(item.title, ai)) return false;

        return true;
      });

    let results = filterAndRankExactMatches(rawComps, ai, 3, 25);

    if (!results.length) {
      results = rawComps
        .map((comp) => ({
          ...comp,
          matchScore: 1,
          flags: ["review needed", "COMC returned but filter rejected"],
        }))
        .filter((comp) => comp.price > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, 3);
    }

    return {
      source: "comc_active",
      label: "COMC Active",
      status: results.length ? "live" : "no_matches",
      message: results.length
        ? "COMC returned these as review-needed candidates. We still need to tune exact matching."
        : "COMC returned no usable priced results.",
      results,
      searchUrl,
    };
  } catch (error) {
    console.error("COMC provider exception:", error);

    return {
      source: "comc_active",
      label: "COMC Active",
      status: "error",
      message: "COMC provider threw an error.",
      results: [],
      searchUrl,
    };
  }
}

async function getTcosInventoryProvider(
  query: string,
  ai: InstaCompAiResult
): Promise<InstaCompProviderResult> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "not_configured",
      message: "Supabase env vars missing.",
      results: [],
    };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const words = query
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 2)
    .slice(0, 6);

  if (!words.length) {
    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "no_matches",
      message: "Not enough query words for internal search.",
      results: [],
    };
  }

  const searchTerm = words.join(" ");

  const { data, error } = await supabase
    .from("products")
    .select("id, title, price, image_url, quantity")
    .ilike("title", `%${searchTerm}%`)
    .gt("price", 0)
    .limit(25);

  if (error) {
    console.error("TCOS internal comp search error:", error);

    return {
      source: "tcos_inventory",
      label: "TCOS Inventory",
      status: "error",
      message: "TCOS inventory search failed.",
      results: [],
    };
  }

  const rawComps: Omit<InstaCompComp, "matchScore" | "flags">[] = (data || [])
    .filter((item: any) => item?.title && Number(item?.price) > 0)
    .map((item: any) => ({
      title: String(item.title),
      price: Number(item.price),
      currency: "USD",
      url: `/product/${item.id}`,
      imageUrl: item.image_url ? String(item.image_url) : null,
      source: "tcos_inventory" as const,
      sourceLabel: "TCOS Inventory",
    }));

  const results = filterAndRankExactMatches(rawComps, ai, 3, 45);

  return {
    source: "tcos_inventory",
    label: "TCOS Inventory",
    status: results.length ? "live" : "no_matches",
    message: results.length
      ? null
      : "No exact TCOS inventory matches passed the filter.",
    results,
  };
}

async function saveScanToSupabase(input: {
  imageFilename: string | null;
  ai: InstaCompAiResult;
  searchQuery: string;
  backupQueries: string[];
  stats: ReturnType<typeof calculateCompStats>;
  links: ReturnType<typeof buildCompLinks>;
  providers: InstaCompProviderResult[];
}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  const allResults = input.providers.flatMap((provider) => provider.results);

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data, error } = await supabase
    .from("instacomp_scans")
    .insert({
      image_filename: input.imageFilename,

      player: input.ai.player,
      year: input.ai.year,
      brand: input.ai.brand,
      set_name: input.ai.setName,
      card_number: input.ai.cardNumber,
      parallel: input.ai.parallel,
      serial_number: input.ai.serialNumber,
      team: input.ai.team,
      sport: input.ai.sport,
      is_rookie: input.ai.isRookie,
      is_auto: input.ai.isAuto,
      is_relic: input.ai.isRelic,
      condition_guess: input.ai.conditionGuess,

      confidence: input.ai.confidence,

      search_query: input.searchQuery,
      backup_queries: input.backupQueries,

      active_low: input.stats.low,
      active_median: input.stats.median,
      active_average: input.stats.average,
      active_high: input.stats.high,
      suggested_price: input.stats.suggestedPrice,

      ebay_sold_url: input.links.ebaySoldUrl,
      ebay_active_url: input.links.ebayActiveUrl,
      one30point_url: input.links.one30pointUrl,
      comc_url: input.links.comcUrl,
      myslabs_url: input.links.myslabsUrl,
      pwcc_url: input.links.pwccUrl,
      goldin_url: input.links.goldinUrl,
      fanatics_url: input.links.fanaticsUrl,

      raw_ai_result: input.ai as any,
      raw_comp_results: {
        providers: input.providers,
        allResults,
      } as any,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Supabase InstaComp save error:", error);
    return null;
  }

  return data?.id || null;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const frontImage = formData.get("frontImage");
    const backImage = formData.get("backImage");

    if (!(frontImage instanceof File)) {
      return jsonError("Upload a front card image.", 400);
    }

    if (!frontImage.type.startsWith("image/")) {
      return jsonError("Front file must be an image.", 400);
    }

    const frontDataUrl = await fileToDataUrl(frontImage);

    let backDataUrl: string | undefined;

    if (backImage instanceof File && backImage.size > 0) {
      if (!backImage.type.startsWith("image/")) {
        return jsonError("Back file must be an image.", 400);
      }

      backDataUrl = await fileToDataUrl(backImage);
    }

    const ai = await identifyCardWithOpenAI(frontDataUrl, backDataUrl);

    const queries = buildInstaCompQueries(ai);
    const links = buildCompLinks(queries.primary);

    const [ebayProvider, comcProvider, tcosProvider] = await Promise.all([
      getEbayProvider(queries.primary, ai, links.ebayActiveUrl),
      getComcProvider(queries.primary, ai, links.comcUrl),
      getTcosInventoryProvider(queries.primary, ai),
    ]);

    const providers = [ebayProvider, comcProvider, tcosProvider];

    const allLiveComps = providers.flatMap((provider) => provider.results);
    const stats = calculateCompStats(allLiveComps);

    const scanId = await saveScanToSupabase({
      imageFilename: frontImage.name || null,
      ai,
      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      stats,
      links,
      providers,
    });

    return NextResponse.json({
      ok: true,
      scanId,
      ai,
      searchQuery: queries.primary,
      backupQueries: queries.backupQueries,
      links,
      providers,
      activeComps: allLiveComps,
      stats,
      note:
        "eBay, COMC, and TCOS results are active asking-price comps. Use sold-search links to verify true sold prices.",
    });
  } catch (error: any) {
    console.error("InstaComp scan error:", error);

    return jsonError(
      error?.message || "InstaComp scan failed.",
      500,
      process.env.NODE_ENV === "development" ? error : undefined
    );
  }
}