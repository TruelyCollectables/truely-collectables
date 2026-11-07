import type { InstaCompAiResult, InstaCompComp, InstaCompProviderResult } from "./instacomp";
import { buildExactEbayQueryLadder, filterStrictExactMarketMatches } from "./instacomp-exact-market-provider";

const API = "https://sales-history-api.services.fanaticscollect.com/api/v1/pub/sales";
const TIMEOUT_MS = 15_000;

type FanaticsSale = {
  id?: string;
  title?: string;
  purchasePrice?: string | number;
  soldDate?: string;
  paymentStatus?: string;
  listingUuid?: string;
  mediumImage1?: string;
  gradingService?: string;
  grade?: number | null;
};

function soldDate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const calendarDate = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (calendarDate) return calendarDate;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

function saleUrl(id: string) {
  return `${API}/item/${encodeURIComponent(id)}`;
}
export async function getFanaticsExactSoldProvider(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
}): Promise<InstaCompProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const queries = buildExactEbayQueryLadder({
      exactTitle: params.exactTitle,
      fallbackQuery: params.exactTitle,
      ai: params.ai,
    });
    const rows: FanaticsSale[] = [];
    const seen = new Set<string>();
    for (const query of queries) {
      const url = `${API}?title=${encodeURIComponent(query)}&size=50`;
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "TCOS-InstaComp/1.0" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Fanatics Sales History HTTP ${response.status}`);
      const payload = (await response.json()) as any;
      const found: FanaticsSale[] = payload?._embedded?.SalesRecords || [];
      for (const row of found) {
        const key = String(row.id || row.listingUuid || "").trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      if (rows.length >= 50) break;
    }
    const candidates: InstaCompComp[] = rows.flatMap((row) => {
      const id = String(row.id || "").trim();
      const title = String(row.title || "").trim();
      const price = Number(row.purchasePrice);
      const date = soldDate(row.soldDate);
      if (!id || !title || !Number.isFinite(price) || price <= 0 || !date) return [];
      if (String(row.paymentStatus || "").toLowerCase() !== "paid") return [];
      return [{
        title, price, itemPrice: price, shippingPrice: 0, priceIncludesShipping: true,
        currency: "USD", url: saleUrl(id), imageUrl: row.mediumImage1 || null,
        source: "fanatics_collect_sales_history", sourceLabel: "Fanatics Collect Sales History",
        sourceCategory: "sold" as const, soldAt: date, listedAt: null,
        observedAt: new Date().toISOString(), matchScore: 0,
        flags: ["direct Fanatics realized sale", "paymentStatus:Paid", `fanaticsSaleId:${id}`],
      }];
    });
    const exact = filterStrictExactMarketMatches(candidates, params.ai, 20);
    return {
      source: "fanatics_collect_sales_history",
      label: "Fanatics Collect Sales History",
      status: exact.length ? "live" : "no_matches",
      message: exact.length
        ? `${exact.length} paid exact Fanatics Collect realized sale${exact.length === 1 ? "" : "s"}.`
        : `Fanatics returned ${rows.length} sale record${rows.length === 1 ? "" : "s"}, but none passed strict exact-card identity gates.`,
      results: exact,
    };
  } catch (error) {
    return {
      source: "fanatics_collect_sales_history",
      label: "Fanatics Collect Sales History",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      results: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
