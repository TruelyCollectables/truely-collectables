import "server-only";

import { getEbayClientAccessToken } from "./ebay";
import {
  filterAndRankExactMatches,
  type InstaCompAiResult,
  type InstaCompComp,
  type InstaCompProviderResult,
} from "./instacomp";

const EBAY_API = "https://api.ebay.com";
const EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope";
const MARKETPLACE_ID = "EBAY_US";
const CARD_CATEGORY_ID = "261328";
const POSTAL = process.env.INSTACOMP_MARKET_POSTAL_CODE || process.env.EBAY_MARKET_POSTAL_CODE || "80202";

type JsonRecord = Record<string, any>;
type RawActiveComp = Omit<InstaCompComp, "matchScore" | "flags"> & { itemId?: string | null };

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function money(value: unknown, allowZero = false) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0)
    ? Math.round(parsed * 100) / 100
    : null;
}

function shippingCost(value: unknown) {
  const options = Array.isArray(value) ? value : [];
  const costs = options
    .map((entry) => money(record(record(entry).shippingCost).value, true))
    .filter((entry): entry is number => entry !== null)
    .sort((left, right) => left - right);
  return costs[0] ?? null;
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
    "X-EBAY-C-ENDUSERCTX": `contextualLocation=country=US,zip=${POSTAL}`,
    "Accept-Language": "en-US",
    "Content-Type": "application/json",
  };
}

function searchUrl(query: string) {
  const url = new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("category_ids", CARD_CATEGORY_ID);
  url.searchParams.set("limit", "50");
  url.searchParams.set("fieldgroups", "EXTENDED");
  url.searchParams.set("filter", "deliveryCountry:US");
  return url;
}

function rawComp(item: JsonRecord): RawActiveComp | null {
  const title = String(item.title || "").trim();
  const itemPrice = money(record(item.price).value);
  const url = String(item.itemWebUrl || "").trim();
  if (!title || !itemPrice || !url) return null;
  const shipping = shippingCost(item.shippingOptions);
  return {
    itemId: String(item.itemId || "").trim() || null,
    title,
    price: Math.round((itemPrice + (shipping || 0)) * 100) / 100,
    itemPrice,
    shippingPrice: shipping,
    priceIncludesShipping: shipping !== null,
    currency: String(record(item.price).currency || "USD"),
    url,
    imageUrl: item.image?.imageUrl ? String(item.image.imageUrl) : null,
    source: "ebay_active",
    sourceLabel: "eBay Active · Official Browse API",
    sourceCategory: "marketplace",
    soldAt: null,
    listedAt: item.itemCreationDate ? String(item.itemCreationDate) : null,
    observedAt: new Date().toISOString(),
  } as RawActiveComp;
}

async function hydrateShipping(token: string, itemId: string) {
  const response = await fetch(`${EBAY_API}/buy/browse/v1/item/${encodeURIComponent(itemId)}`, {
    headers: headers(token),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return shippingCost(payload?.shippingOptions);
}

export async function getOfficialEbayActiveExactProvider(params: {
  query: string;
  ai: InstaCompAiResult;
  limit?: number;
}): Promise<InstaCompProviderResult> {
  const query = String(params.query || "").trim();
  const fallbackUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
  if (!query) {
    return {
      source: "ebay_active",
      label: "eBay Active · Official Browse API",
      status: "no_matches",
      message: "No exact-card query was available for eBay active search.",
      results: [],
      searchUrl: fallbackUrl,
    };
  }

  try {
    const token = await getEbayClientAccessToken(EBAY_SCOPE);
    const url = searchUrl(query);
    const response = await fetch(url, {
      headers: headers(token),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`eBay Browse ${response.status}: ${String(payload?.errors?.[0]?.message || payload?.error || response.statusText).slice(0, 240)}`);
    }

    const raw: RawActiveComp[] = (Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : [])
      .map((item: JsonRecord) => rawComp(item))
      .filter((item: RawActiveComp | null): item is RawActiveComp => Boolean(item));
    const itemIds = new Map<string, string | null>(
      raw.map((item: RawActiveComp) => [item.url, item.itemId || null]),
    );
    let exact = filterAndRankExactMatches(raw, params.ai, Math.max(6, params.limit || 12), 55);

    const missingShipping = exact
      .filter((item) => !item.priceIncludesShipping)
      .slice(0, 8);
    const hydrated = await Promise.all(
      missingShipping.map(async (item) => {
        const itemId = itemIds.get(item.url);
        if (!itemId) return [item.url, null] as const;
        return [item.url, await hydrateShipping(token, itemId)] as const;
      }),
    );
    const shippingByUrl = new Map(hydrated);

    exact = exact.map((item) => {
      const shipping = item.shippingPrice ?? shippingByUrl.get(item.url) ?? null;
      const priceIncludesShipping = shipping !== null;
      return {
        ...item,
        shippingPrice: shipping,
        priceIncludesShipping,
        price: Math.round((Number(item.itemPrice || item.price) + (shipping || 0)) * 100) / 100,
        flags: Array.from(
          new Set([
            ...item.flags,
            "official eBay Browse API",
            ...(priceIncludesShipping ? ["pricing eligible"] : ["shipping unknown", "not used for pricing"]),
          ]),
        ),
      };
    });

    return {
      source: "ebay_active",
      label: "eBay Active · Official Browse API",
      status: exact.length ? "live" : "no_matches",
      message: exact.length
        ? `${exact.length} strict exact active listing${exact.length === 1 ? "" : "s"} passed the eBay Browse filter.`
        : "No strict exact active eBay listings passed the InstaComp identity filter.",
      results: exact.slice(0, params.limit || 12),
      searchUrl: fallbackUrl,
    };
  } catch (error) {
    return {
      source: "ebay_active",
      label: "eBay Active · Official Browse API",
      status: "error",
      message: error instanceof Error ? error.message : "eBay Browse active search failed.",
      results: [],
      searchUrl: fallbackUrl,
    };
  }
}
