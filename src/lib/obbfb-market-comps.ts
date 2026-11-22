import "server-only";

import { searchMacMarketForIdentity } from "./kingmaker-mac-scan-server";
import { createSupabaseServerClient } from "./supabase-server";
import { getActiveStoreId } from "./stores";
import {
  normalizeDirectIdentity, sameCardVariant, select365DayComps,
  type DirectCardIdentity, type VerifiedSale,
} from "./obbfb-intake-rules";

type Json = Record<string, unknown>;
const record = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const str = (v: unknown) => String(v || "").trim();
const LOOKBACK_MS = 365 * 86_400_000;
const SPORTSCARDSPRO_LINK = "https://www.sportscardspro.com/search-products?q=";
export type OBBFBComps = {
  status: "comped" | "0 Comps — Seller Price Required";
  medianComp: number | null;
  suggestedPrice: number | null;
  accepted: VerifiedSale[];
  rejected: ReturnType<typeof select365DayComps>["rejected"];
  providerCoverage: Json[];
  priceGuide: Json | null;
  activeListings: Json[];
  source: string;
};

export async function getPreviousVerifiedCopySale(identity: DirectCardIdentity, now = new Date()): Promise<VerifiedSale | null> {
  if (!identity.serialNumber) return null;
  const db = createSupabaseServerClient({ admin: true });
  const start = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const { data: sales, error } = await db.from("collectible_sales")
    .select("inventory_item_id,legacy_product_id,ebay_item_id,sold_at,sold_price,source_marketplace,evidence_status")
    .eq("store_id", getActiveStoreId())
    .eq("evidence_status", "verified")
    .gt("sold_price", 0)
    .gte("sold_at", start)
    .order("sold_at", { ascending: false })
    .limit(400);
  if (error) throw error;
  const ids = Array.from(new Set((sales || []).map(s => s.inventory_item_id).filter(Boolean))) as string[];
  if (!ids.length) return null;
  const { data: items, error: rowError } = await db.from("inventory_items")
    .select("id,title,description,metadata")
    .eq("store_id", getActiveStoreId())
    .in("id", ids);
  if (rowError) throw rowError;
  const byId = new Map((items || []).map(item => [item.id, item]));
  for (const sale of sales || []) {
    const item = byId.get(sale.inventory_item_id);
    if (!item) continue;
    const metadata = record(item.metadata);
    const instacomp = record(metadata.instacomp);
    const ai = record(instacomp.ai);
    const seller = record(instacomp.manualIdentity);
    const physical = record(metadata.collectible_asset);
    const descriptionSerial = String(item.description || "").match(/(?:Exact serial stamp:|Serial(?: number)?:)\s*(\d{1,5}\/\d{1,6})/i)?.[1] || null;
    const serialNumber = str(seller.serialNumber || ai.serialNumber || physical.exact_serial_number || descriptionSerial);
    if (!serialNumber || serialNumber === identity.serialNumber) continue;
    const prior = normalizeDirectIdentity({
      year: seller.year || ai.year, brandSet: seller.brandSet || seller.setName || ai.brandSet || ai.setName || ai.product,
      player: seller.player || ai.player, cardNumber: seller.cardNumber || ai.cardNumber,
      parallel: seller.parallel || ai.parallel, subset: seller.subset || ai.subset,
      serialNumber,
      isAutograph: seller.isAutograph ?? ai.isAuto ?? ai.isAutograph ?? false,
      autographEvidence: seller.autographEvidence || ai.autographEvidence || (/(?:auto|autograph)/i.test(item.title || "") ? "Autograph on printed card title" : null),
      isRelic: seller.isRelic ?? ai.isRelic ?? false,
      relicEvidence: seller.relicEvidence || ai.relicEvidence || (/(?:relic|patch|jersey)/i.test(item.title || "") ? "Relic on printed card title" : null),
      confidence: 1,
    });
    if (!sameCardVariant(identity, prior)) continue;
    const source = str(sale.source_marketplace);
    const ebayItemId = str(sale.ebay_item_id);
    const url = /^\d{9,15}$/.test(ebayItemId) ? `https://www.ebay.com/itm/${ebayItemId}` : null;
    if (!url || !(Number(sale.sold_price) > 0)) continue;
    return {
      source: "TC verified own sale (" + source + ")",
      title: item.title,
      url,
      price: Number(sale.sold_price),
      soldAt: String(sale.sold_at), verified: true, realized: true,
    };
  }
  return null;
}

export async function researchOBBFBComps(identity: DirectCardIdentity, title: string): Promise<OBBFBComps> {
  const query = [identity.year, identity.brandSet, identity.player, identity.cardNumber && `#${identity.cardNumber}`, identity.parallel, identity.serialNumber && `/${identity.serialNumber.split("/")[1]}`].filter(Boolean).join(" ");
  const sportsCardsPro = {
    source: "sportscardspro", label: "SportsCardsPro",
    status: "historical_sales_api_unavailable",
    message: "Official SportsCardsPro prices API has current guide values, not individual historical sales; excluded from 365-day raw median.",
    searchUrl: SPORTSCARDSPRO_LINK + encodeURIComponent(query) + "&type=prices",
    resultCount: 0,
  };
  const providerCoverage: Json[] = [sportsCardsPro];
  try {
    const prior = await getPreviousVerifiedCopySale(identity);
    if (prior) {
      const picked = select365DayComps([prior], identity);
      return {
        ...picked, priceGuide: null, activeListings: [],
        providerCoverage: [{ source: "tcos_verified_sale", status: "live", resultCount: 1 }, sportsCardsPro],
        source: "verified_prior_sale_different_serial",
      };
    }
  } catch (error) {
    providerCoverage.push({ source: "tcos_verified_sale", status: "error", message: String(error instanceof Error ? error.message : error).slice(0, 140) });
  }
  try {
    const market = record(await searchMacMarketForIdentity({
      exactTitle: title,
      identity: {
        year: identity.year, manufacturer: identity.manufacturer, brand: identity.manufacturer,
        product: identity.brandSet, setName: identity.brandSet,
        subset: identity.subset, player: identity.player, cardNumber: identity.cardNumber,
        parallel: identity.parallel, serialNumber: identity.serialNumber,
        isAuto: identity.isAutograph, isRelic: identity.isRelic,
      },
      operatorCertifiedIdentity: false,
      include130point: true,
      includeFanatics: true,
    }));
    providerCoverage.push(...(Array.isArray(market.providerCoverage) ? market.providerCoverage.map(record) : []));
    const raw = Array.isArray(market.sold) ? market.sold.map(record) : [];
    const sales: VerifiedSale[] = raw.map(row => ({
      source: str(row.source), title: str(row.title), url: str(row.url),
      price: Number(row.price), soldAt: str(row.soldAt), verified: Array.isArray(row.flags)
        && row.flags.includes("pricing eligible") && row.sourceCategory === "sold",
      realized: row.priceIncludesShipping === true
        || str(row.source).includes("fanatics"),
    }));
    const selected = select365DayComps(sales, identity);
    return {
      ...selected, providerCoverage, priceGuide: Object.keys(record(market.priceGuide)).length ? record(market.priceGuide) : null,
      activeListings: Array.isArray(market.active) ? market.active.map(record) : [],
      source: "mac_verified_365_day_sold_comps",
    };
  } catch (error) {
    providerCoverage.push({ source: "mac_direct_market", status: "error", message: String(error instanceof Error ? error.message : error).slice(0, 200) });
    return {
      status: "0 Comps — Seller Price Required", medianComp: null, suggestedPrice: null,
      accepted: [], rejected: [], providerCoverage, priceGuide: null, activeListings: [], source: "no_verified_sales",
    };
  }
}
