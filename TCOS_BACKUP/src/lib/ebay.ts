import { getActiveStoreId } from "./stores";
import { getStoreSettings } from "./store-settings";
import { createSupabaseServerClient } from "./supabase-server";

const EBAY_API = "https://api.ebay.com";
const EBAY_FINDING_API = "https://svcs.ebay.com/services/search/FindingService/v1";

function getSupabase() {
  return createSupabaseServerClient({ admin: true });
}

function ebayReadHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

async function getLatestRefreshToken(storeId = getActiveStoreId()) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.refresh_token) {
    throw new Error("No eBay refresh token found");
  }

  return data.refresh_token;
}

export async function getEbayAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const refreshToken = await getLatestRefreshToken();

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`eBay token refresh failed: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

export async function syncEbayQuantityAfterSale(params: {
  sku?: string | null;
  ebayItemId?: string | null;
  newQuantity: number;
}) {
  const { sku, ebayItemId, newQuantity } = params;
  const storeId = getActiveStoreId();
  const supabase = getSupabase();
  const storeSettings = await getStoreSettings(supabase, storeId);

  if (!storeSettings.ebaySyncEnabled) {
    return {
      success: false,
      skipped: true,
      reason: "eBay sync is disabled for this store",
    };
  }

  if (!sku && !ebayItemId) {
    return {
      success: false,
      skipped: true,
      reason: "Missing sku and ebayItemId",
    };
  }

  const accessToken = await getEbayAccessToken();

  let finalSku = sku || null;

  if (!finalSku && ebayItemId) {
    const offerRes = await fetch(
      `${EBAY_API}/sell/inventory/v1/offer?limit=200`,
      { headers: ebayReadHeaders(accessToken) }
    );

    const offerData = await offerRes.json();

    if (!offerRes.ok) {
      throw new Error(`Could not list eBay offers: ${JSON.stringify(offerData)}`);
    }

    const matchingOffer = offerData.offers?.find(
      (offer: any) => String(offer?.listing?.listingId) === String(ebayItemId)
    );

    finalSku = matchingOffer?.sku || null;
  }

  if (!finalSku) {
    return {
      success: false,
      skipped: true,
      reason: "Could not determine SKU for eBay update",
    };
  }

  const updateRes = await fetch(
    `${EBAY_API}/sell/inventory/v1/bulk_update_price_quantity`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            sku: finalSku,
            shipToLocationAvailability: {
              quantity: Math.max(0, newQuantity),
            },
          },
        ],
      }),
    }
  );

  const updateData = await updateRes.json().catch(() => ({}));

  if (!updateRes.ok) {
    throw new Error(
      `Could not bulk update eBay quantity: ${JSON.stringify(updateData)}`
    );
  }

  return {
    success: true,
    sku: finalSku,
    ebayItemId,
    newQuantity: Math.max(0, newQuantity),
  };
}

async function getEbayClientAccessToken(scope: string) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`eBay client token failed: ${JSON.stringify(data)}`);
  }

  return data.access_token as string;
}

export type EbaySoldComp = {
  title: string;
  price: number;
  currency: string;
  soldAt: string | null;
  itemUrl: string | null;
  imageUrl: string | null;
  source: "ebay" | "pricecharting";
};

export type SalesCompSearchResult = {
  title: string;
  snippet: string | null;
  url: string;
  source: "google";
};

export type SalesCompResearchLink = {
  label: string;
  url: string;
  source: string;
};

export type SalesCompSummary = {
  query: string;
  comps: EbaySoldComp[];
  googleResults: SalesCompSearchResult[];
  researchLinks: SalesCompResearchLink[];
  count: number;
  averagePrice: number | null;
  medianPrice: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  suggestedPrice: number | null;
  suggestedPriceMethod: string | null;
  recentCompCount: number;
  sourceStatus: "live" | "fallback" | "unavailable";
  sourceMessage: string | null;
  point130Url: string;
  googleStatus: "live" | "not_configured" | "unavailable";
  googleMessage: string | null;
  priceGuideStatus: "live" | "not_configured" | "unavailable";
  priceGuideMessage: string | null;
  snapshotStatus: "not_requested" | "saved" | "unavailable";
  snapshotMessage: string | null;
  snapshotId: number | null;
};

export type SalesCompHistoryEntry = {
  id: number;
  legacyProductId: number;
  query: string;
  suggestedPrice: number | null;
  suggestedPriceMethod: string | null;
  averagePrice: number | null;
  medianPrice: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  compCount: number;
  recentCompCount: number;
  sourceStatus: SalesCompSummary["sourceStatus"];
  googleStatus: SalesCompSummary["googleStatus"];
  priceGuideStatus: SalesCompSummary["priceGuideStatus"];
  createdAt: string;
};

export type SalesCompHistoryResult = {
  entries: SalesCompHistoryEntry[];
  status: "live" | "unavailable";
  message: string | null;
};

function salesCompQuery(input: {
  title: string;
  player?: string | null;
  sport?: string | null;
}) {
  return [input.title, input.player, input.sport]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function toPrice(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildResearchLinks(query: string): SalesCompResearchLink[] {
  const encoded = encodeURIComponent(query);
  const googleSoldQuery = encodeURIComponent(`${query} sold price sports card`);

  return [
    {
      label: "CollX",
      source: "collx",
      url: `https://www.google.com/search?q=${encodeURIComponent(
        `${query} site:collx.app`
      )}`,
    },
    {
      label: "130point Sales",
      source: "130point",
      url: `https://130point.com/sales/?search=${encoded}`,
    },
    {
      label: "Google Sold Search",
      source: "google",
      url: `https://www.google.com/search?q=${googleSoldQuery}`,
    },
    {
      label: "PriceCharting",
      source: "pricecharting",
      url: `https://www.pricecharting.com/search-products?q=${encoded}&type=prices`,
    },
    {
      label: "PSA Auction Prices",
      source: "psa",
      url: `https://www.psacard.com/auctionprices?search=${encoded}`,
    },
    {
      label: "Card Ladder",
      source: "cardladder",
      url: `https://www.cardladder.com/search?q=${encoded}`,
    },
    {
      label: "ALT Market",
      source: "alt",
      url: `https://www.alt.xyz/search?q=${encoded}`,
    },
    {
      label: "COMC",
      source: "comc",
      url: `https://www.comc.com/Cards,sl,i100,=${encoded}`,
    },
    {
      label: "eBay Sold Search",
      source: "ebay",
      url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`,
    },
  ];
}

function summarizeComps(params: {
  query: string;
  comps: EbaySoldComp[];
  googleResults?: SalesCompSearchResult[];
  sourceStatus: SalesCompSummary["sourceStatus"];
  sourceMessage: string | null;
  googleStatus?: SalesCompSummary["googleStatus"];
  googleMessage?: string | null;
  priceGuideStatus?: SalesCompSummary["priceGuideStatus"];
  priceGuideMessage?: string | null;
}) {
  const now = Date.now();
  const sixMonthsAgo = now - 183 * 24 * 60 * 60 * 1000;
  const datedComps = params.comps
    .filter((comp) => comp.soldAt)
    .map((comp) => ({
      ...comp,
      soldTime: new Date(String(comp.soldAt)).getTime(),
    }))
    .filter((comp) => Number.isFinite(comp.soldTime));
  const recentPrices = datedComps
    .filter((comp) => comp.soldTime >= sixMonthsAgo)
    .sort((a, b) => b.soldTime - a.soldTime)
    .slice(0, 10)
    .map((comp) => comp.price)
    .filter((price) => Number.isFinite(price) && price > 0);
  const prices = params.comps
    .map((comp) => comp.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);

  const averagePrice =
    prices.length > 0
      ? prices.reduce((sum, price) => sum + price, 0) / prices.length
      : null;

  const medianPrice =
    prices.length === 0
      ? null
      : prices.length % 2 === 1
      ? prices[Math.floor(prices.length / 2)]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
  const recentAverage =
    recentPrices.length > 0
      ? recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length
      : null;
  const lastKnownSale =
    datedComps.sort((a, b) => b.soldTime - a.soldTime)[0]?.price ?? null;
  const suggestedPrice = recentAverage ?? lastKnownSale ?? medianPrice;
  const suggestedPriceMethod = recentAverage
    ? "Average of up to 10 recent sold comps in the last six months"
    : lastKnownSale
    ? "Last known sold comp because no six-month comp set was available"
    : medianPrice
    ? "Median of available pricing comps"
    : null;

  return {
    query: params.query,
    comps: params.comps,
    count: params.comps.length,
    averagePrice,
    medianPrice,
    lowPrice: prices[0] ?? null,
    highPrice: prices[prices.length - 1] ?? null,
    suggestedPrice,
    suggestedPriceMethod,
    recentCompCount: recentPrices.length,
    sourceStatus: params.sourceStatus,
    sourceMessage: params.sourceMessage,
    googleResults: params.googleResults ?? [],
    researchLinks: buildResearchLinks(params.query),
    point130Url: `https://130point.com/sales/?search=${encodeURIComponent(
      params.query
    )}`,
    googleStatus: params.googleStatus ?? "not_configured",
    googleMessage: params.googleMessage ?? null,
    priceGuideStatus: params.priceGuideStatus ?? "not_configured",
    priceGuideMessage: params.priceGuideMessage ?? null,
    snapshotStatus: "not_requested" as const,
    snapshotMessage: null,
    snapshotId: null,
  };
}

async function saveSalesCompSnapshot(params: {
  legacyProductId: number;
  summary: SalesCompSummary;
  storeId?: string;
}): Promise<SalesCompSummary> {
  const supabase = getSupabase();
  const storeId = params.storeId ?? getActiveStoreId();

  const { data, error } = await supabase
    .from("sales_comp_snapshots")
    .insert({
      store_id: storeId,
      legacy_product_id: params.legacyProductId,
      query: params.summary.query,
      suggested_price: params.summary.suggestedPrice,
      suggested_price_method: params.summary.suggestedPriceMethod,
      average_price: params.summary.averagePrice,
      median_price: params.summary.medianPrice,
      low_price: params.summary.lowPrice,
      high_price: params.summary.highPrice,
      comp_count: params.summary.count,
      recent_comp_count: params.summary.recentCompCount,
      source_status: params.summary.sourceStatus,
      source_message: params.summary.sourceMessage,
      google_status: params.summary.googleStatus,
      google_message: params.summary.googleMessage,
      price_guide_status: params.summary.priceGuideStatus,
      price_guide_message: params.summary.priceGuideMessage,
      comps: params.summary.comps,
      google_results: params.summary.googleResults,
      research_links: params.summary.researchLinks,
    })
    .select("id")
    .single();

  if (error) {
    return {
      ...params.summary,
      snapshotStatus: "unavailable",
      snapshotMessage: error.message,
      snapshotId: null,
    };
  }

  return {
    ...params.summary,
    snapshotStatus: "saved",
    snapshotMessage: null,
    snapshotId: Number(data.id),
  };
}

async function maybeSaveSalesCompSnapshot(params: {
  legacyProductId?: number;
  summary: SalesCompSummary;
  storeId?: string;
}) {
  if (!params.legacyProductId) {
    return params.summary;
  }

  return saveSalesCompSnapshot({
    legacyProductId: params.legacyProductId,
    summary: params.summary,
    storeId: params.storeId,
  });
}

async function searchGoogleComps(query: string, limit: number) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    return {
      status: "not_configured" as const,
      message: "Google Programmable Search is not configured.",
      results: [] as SalesCompSearchResult[],
    };
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", searchEngineId);
  url.searchParams.set("q", `${query} sold price sports card`);
  url.searchParams.set("num", String(Math.min(Math.max(limit, 1), 10)));

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        status: "unavailable" as const,
        message: `Google search failed: ${JSON.stringify(data)}`,
        results: [] as SalesCompSearchResult[],
      };
    }

    return {
      status: "live" as const,
      message: null,
      results: (data.items ?? []).map((item: any) => ({
        title: String(item.title || "Untitled"),
        snippet: item.snippet ?? null,
        url: String(item.link || "#"),
        source: "google" as const,
      })),
    };
  } catch (error: any) {
    return {
      status: "unavailable" as const,
      message: `Google search failed: ${error.message}`,
      results: [] as SalesCompSearchResult[],
    };
  }
}

async function searchPriceCharting(query: string) {
  const token = process.env.PRICECHARTING_API_TOKEN;

  if (!token) {
    return {
      status: "not_configured" as const,
      message: "PriceCharting API token is not configured.",
      comps: [] as EbaySoldComp[],
    };
  }

  const url = new URL("https://www.pricecharting.com/api/products");
  url.searchParams.set("t", token);
  url.searchParams.set("q", query);

  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.status === "error") {
      return {
        status: "unavailable" as const,
        message: `PriceCharting failed: ${JSON.stringify(data)}`,
        comps: [] as EbaySoldComp[],
      };
    }

    const products = data.products || [];
    const comps = products
      .map((product: any): EbaySoldComp | null => {
        const priceInCents =
          toPrice(product["loose-price"]) ??
          toPrice(product["cib-price"]) ??
          toPrice(product["new-price"]);

        if (!priceInCents) return null;

        return {
          title: String(product["product-name"] || product.name || query),
          price: priceInCents / 100,
          currency: "USD",
          soldAt: null,
          itemUrl: product["product-url"] || null,
          imageUrl: null,
          source: "pricecharting",
        };
      })
      .filter(Boolean) as EbaySoldComp[];

    return {
      status: "live" as const,
      message: null,
      comps,
    };
  } catch (error: any) {
    return {
      status: "unavailable" as const,
      message: `PriceCharting failed: ${error.message}`,
      comps: [] as EbaySoldComp[],
    };
  }
}

async function searchMarketplaceInsights(query: string, limit: number) {
  const accessToken = await getEbayClientAccessToken(
    "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"
  );

  const url = new URL(
    `${EBAY_API}/buy/marketplace_insights/v1_beta/item_sales/search`
  );
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Marketplace Insights failed: ${JSON.stringify(data)}`);
  }

  const items = data.itemSales || data.itemSummaries || [];

  return items
    .map((item: any): EbaySoldComp | null => {
      const price = toPrice(item.price?.value || item.itemPrice?.value);

      if (!price) return null;

      return {
        title: String(item.title || "Untitled"),
        price,
        currency: String(item.price?.currency || item.itemPrice?.currency || "USD"),
        soldAt: item.itemEndDate || item.lastSoldDate || null,
        itemUrl: item.itemWebUrl || item.itemAffiliateWebUrl || null,
        imageUrl: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
        source: "ebay",
      };
    })
    .filter(Boolean) as EbaySoldComp[];
}

async function searchFindingCompletedItems(query: string, limit: number) {
  const appId = process.env.EBAY_CLIENT_ID;

  if (!appId) {
    throw new Error("Missing eBay app ID");
  }

  const url = new URL(EBAY_FINDING_API);
  url.searchParams.set("OPERATION-NAME", "findCompletedItems");
  url.searchParams.set("SERVICE-VERSION", "1.13.0");
  url.searchParams.set("SECURITY-APPNAME", appId);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "true");
  url.searchParams.set("keywords", query);
  url.searchParams.set("paginationInput.entriesPerPage", String(limit));
  url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
  url.searchParams.set("itemFilter(0).value", "true");

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Finding API failed: ${JSON.stringify(data)}`);
  }

  const items =
    data.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item ?? [];

  return items
    .map((item: any): EbaySoldComp | null => {
      const sellingStatus = item.sellingStatus?.[0];
      const price = toPrice(sellingStatus?.currentPrice?.[0]?.__value__);

      if (!price) return null;

      return {
        title: String(item.title?.[0] || "Untitled"),
        price,
        currency: String(
          sellingStatus?.currentPrice?.[0]?.["@currencyId"] || "USD"
        ),
        soldAt: item.listingInfo?.[0]?.endTime?.[0] || null,
        itemUrl: item.viewItemURL?.[0] || null,
        imageUrl: item.galleryURL?.[0] || null,
        source: "ebay",
      };
    })
    .filter(Boolean) as EbaySoldComp[];
}

export async function getSalesComps(input: {
  title: string;
  player?: string | null;
  sport?: string | null;
  limit?: number;
  legacyProductId?: number;
  storeId?: string;
}): Promise<SalesCompSummary> {
  const query = salesCompQuery(input);
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 25);
  const storeId = input.storeId ?? getActiveStoreId();

  if (!query) {
    return maybeSaveSalesCompSnapshot({
      legacyProductId: input.legacyProductId,
      storeId,
      summary: summarizeComps({
        query,
        comps: [],
        sourceStatus: "unavailable",
        sourceMessage: "No searchable card data found.",
      }),
    });
  }

  const [googleSearch, priceGuideSearch] = await Promise.all([
    searchGoogleComps(query, 6),
    searchPriceCharting(query),
  ]);

  try {
    const comps = await searchMarketplaceInsights(query, limit);

    return maybeSaveSalesCompSnapshot({
      legacyProductId: input.legacyProductId,
      storeId,
      summary: summarizeComps({
        query,
        comps: [...comps, ...priceGuideSearch.comps],
        googleResults: googleSearch.results,
        sourceStatus: "live",
        sourceMessage: null,
        googleStatus: googleSearch.status,
        googleMessage: googleSearch.message,
        priceGuideStatus: priceGuideSearch.status,
        priceGuideMessage: priceGuideSearch.message,
      }),
    });
  } catch (insightsError: any) {
    try {
      const comps = await searchFindingCompletedItems(query, limit);

      return maybeSaveSalesCompSnapshot({
        legacyProductId: input.legacyProductId,
        storeId,
        summary: summarizeComps({
          query,
          comps: [...comps, ...priceGuideSearch.comps],
          googleResults: googleSearch.results,
          sourceStatus: "fallback",
          sourceMessage: `Used eBay completed-items fallback because Marketplace Insights was unavailable: ${insightsError.message}`,
          googleStatus: googleSearch.status,
          googleMessage: googleSearch.message,
          priceGuideStatus: priceGuideSearch.status,
          priceGuideMessage: priceGuideSearch.message,
        }),
      });
    } catch (findingError: any) {
      return maybeSaveSalesCompSnapshot({
        legacyProductId: input.legacyProductId,
        storeId,
        summary: summarizeComps({
          query,
          comps: priceGuideSearch.comps,
          googleResults: googleSearch.results,
          sourceStatus: "unavailable",
          sourceMessage: `eBay sold comps unavailable: ${findingError.message}`,
          googleStatus: googleSearch.status,
          googleMessage: googleSearch.message,
          priceGuideStatus: priceGuideSearch.status,
          priceGuideMessage: priceGuideSearch.message,
        }),
      });
    }
  }
}

export async function getSalesCompHistory(
  legacyProductId: number,
  limit = 8,
  storeId = getActiveStoreId()
): Promise<SalesCompHistoryResult> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("sales_comp_snapshots")
    .select(
      "id, legacy_product_id, query, suggested_price, suggested_price_method, average_price, median_price, low_price, high_price, comp_count, recent_comp_count, source_status, google_status, price_guide_status, created_at"
    )
    .eq("legacy_product_id", legacyProductId)
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return {
      entries: [],
      status: "unavailable",
      message: error.message,
    };
  }

  return {
    entries: (data ?? []).map((row: any) => ({
      id: Number(row.id),
      legacyProductId: Number(row.legacy_product_id),
      query: String(row.query || ""),
      suggestedPrice:
        row.suggested_price === null ? null : Number(row.suggested_price),
      suggestedPriceMethod: row.suggested_price_method ?? null,
      averagePrice: row.average_price === null ? null : Number(row.average_price),
      medianPrice: row.median_price === null ? null : Number(row.median_price),
      lowPrice: row.low_price === null ? null : Number(row.low_price),
      highPrice: row.high_price === null ? null : Number(row.high_price),
      compCount: Number(row.comp_count || 0),
      recentCompCount: Number(row.recent_comp_count || 0),
      sourceStatus: row.source_status,
      googleStatus: row.google_status,
      priceGuideStatus: row.price_guide_status,
      createdAt: String(row.created_at),
    })),
    status: "live",
    message: null,
  };
}
