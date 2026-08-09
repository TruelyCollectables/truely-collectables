import { filterStrictExactMarketMatches } from "./instacomp-exact-market-provider";
import type { InstaCompAiResult, InstaCompComp } from "./instacomp";

export type EbayPriceInsightsCaptureRow = {
  title: string;
  soldAt: string;
  itemPrice: number;
  shippingPrice: number;
  url: string;
  imageUrl?: string | null;
  condition?: string | null;
  buyingOption?: string | null;
  capturedAt?: string | null;
};

export type EbayPriceInsightsRejectedRow = {
  index: number;
  title: string | null;
  url: string | null;
  reason: string;
};

export type EbayPriceInsightsExactResult = {
  received: number;
  normalized: number;
  accepted: InstaCompComp[];
  rejected: EbayPriceInsightsRejectedRow[];
};

function clean(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function soldDate(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

export function directEbayPriceInsightsItemUrl(value: unknown) {
  try {
    const url = new URL(clean(value));
    if (!/(^|\.)ebay\.com$/i.test(url.hostname)) return null;
    const itemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:[/?]|$)/i)?.[1];
    return itemId ? `https://www.ebay.com/itm/${itemId}` : null;
  } catch {
    return null;
  }
}

function normalizeRow(raw: unknown, index: number) {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const title = clean(row.title);
  const url = directEbayPriceInsightsItemUrl(row.url);
  const itemPrice = money(row.itemPrice);
  const shippingPrice = money(row.shippingPrice);
  const soldAt = soldDate(row.soldAt);
  const condition = clean(row.condition) || null;
  const buyingOption = clean(row.buyingOption) || null;
  const capturedAt = soldDate(row.capturedAt) || new Date().toISOString().slice(0, 10);

  if (!title) return { row: null, rejected: { index, title: null, url, reason: "title is required" } };
  if (!url) return { row: null, rejected: { index, title, url: clean(row.url) || null, reason: "direct ebay.com/itm item URL is required" } };
  if (itemPrice === null || itemPrice <= 0) {
    return { row: null, rejected: { index, title, url, reason: "positive itemPrice is required" } };
  }
  if (shippingPrice === null) {
    return { row: null, rejected: { index, title, url, reason: "shippingPrice must be known; use 0 only for explicit free shipping" } };
  }
  if (!soldAt) return { row: null, rejected: { index, title, url, reason: "valid soldAt date is required" } };

  const landed = Number((itemPrice + shippingPrice).toFixed(2));
  const comp: Omit<InstaCompComp, "matchScore" | "flags"> = {
    title,
    price: landed,
    itemPrice,
    shippingPrice,
    priceIncludesShipping: true,
    currency: "USD",
    url,
    imageUrl: clean(row.imageUrl) || null,
    source: "ebay_price_insights_owner_capture",
    sourceLabel: "eBay Price Insights Sold",
    sourceCategory: "sold",
    soldAt,
    listedAt: null,
    observedAt: capturedAt,
  };
  return {
    row: { comp, index, condition, buyingOption },
    rejected: null,
  };
}

export function filterExactEbayPriceInsightsRows(
  value: unknown,
  ai: InstaCompAiResult,
  limit = 50,
): EbayPriceInsightsExactResult {
  const input = Array.isArray(value) ? value.slice(0, 100) : [];
  const rejected: EbayPriceInsightsRejectedRow[] = [];
  const normalized = input
    .map((raw, index) => {
      const result = normalizeRow(raw, index);
      if (result.rejected) rejected.push(result.rejected);
      return result.row;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const exact = filterStrictExactMarketMatches(
    normalized.map((row) => row.comp),
    ai,
    limit,
  );
  const exactUrls = new Set(exact.map((row) => row.url));
  const metadata = new Map(normalized.map((row) => [row.comp.url, row]));

  for (const row of normalized) {
    if (!exactUrls.has(row.comp.url)) {
      rejected.push({
        index: row.index,
        title: row.comp.title,
        url: row.comp.url,
        reason: "rejected by InstaComp strict exact-card identity/parallel/print-run gate",
      });
    }
  }

  const accepted = exact.map((comp) => {
    const meta = metadata.get(comp.url);
    return {
      ...comp,
      flags: Array.from(
        new Set([
          ...comp.flags,
          "eBay Price Insights owner-authorized capture",
          "sold date supplied by eBay Price Insights",
          "landed price = item + shipping",
          ...(meta?.condition ? [`condition: ${meta.condition}`] : []),
          ...(meta?.buyingOption ? [`buying option: ${meta.buyingOption}`] : []),
        ]),
      ).slice(0, 20),
    };
  });

  return {
    received: input.length,
    normalized: normalized.length,
    accepted,
    rejected: rejected.sort((left, right) => left.index - right.index),
  };
}
