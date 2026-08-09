import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { InstaCompAiResult, InstaCompComp } from "./instacomp";

export type InstaCompRegistryTruth = {
  matched: boolean;
  identityId: string | null;
  fingerprintSha256: string | null;
  status?: string | null;
  sourceTier?: string | null;
};

export type ExactMarketObservationKind = "ASK" | "SOLD" | "PURCHASE" | "OWN_SALE";

export type ExactMarketTargetListing = {
  title: string;
  marketplace: string;
  listingUrl: string;
  listingItemId?: string | null;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  buyerFees?: number | null;
  tax?: number | null;
  deliveredPrice?: number | null;
  currency?: string | null;
  conditionText?: string | null;
  observedAt?: string | null;
};

export type ExactMarketObservation = {
  registry_identity_id: string;
  observation_fingerprint: string;
  observation_kind: ExactMarketObservationKind;
  marketplace: string;
  provider_source: string | null;
  listing_item_id: string | null;
  listing_url: string | null;
  title: string | null;
  item_price: number | null;
  shipping_price: number | null;
  buyer_fees: number | null;
  tax: number | null;
  delivered_price: number | null;
  currency: string;
  condition_text: string | null;
  match_score: number | null;
  effective_at: string | null;
  observed_at: string;
  scan_id: string | null;
  source_payload: Record<string, unknown>;
};

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function dateValue(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function marketplaceFromComp(comp: InstaCompComp) {
  const source = `${comp.source || ""} ${comp.sourceLabel || ""}`.toLowerCase();
  if (source.includes("ebay")) return "eBay";
  if (source.includes("mercari")) return "Mercari";
  if (source.includes("comc")) return "COMC";
  if (source.includes("fanatics")) return "Fanatics";
  return comp.sourceLabel || comp.source || "Unknown";
}

export function listingItemIdFromUrl(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ebay = text.match(/\/itm\/(?:[^/?]+\/)?(\d{9,15})(?:[/?]|$)/i);
  if (ebay?.[1]) return ebay[1];
  const mercari = text.match(/\/item\/(m\d+)/i);
  return mercari?.[1] || null;
}

function observationFingerprint(parts: Array<string | number | null | undefined>) {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "").trim()).join("|"))
    .digest("hex");
}

function deliveredPrice(comp: InstaCompComp) {
  const price = money(comp.price);
  const item = money(comp.itemPrice);
  const shipping = money(comp.shippingPrice);
  if (comp.priceIncludesShipping && price !== null) return price;
  if (item !== null) return Number((item + (shipping || 0)).toFixed(2));
  return price;
}

export function buildExactMarketObservation(params: {
  registryIdentityId: string;
  kind: "ASK" | "SOLD";
  comp: InstaCompComp;
  observedAt: string;
  scanId?: string | null;
}): ExactMarketObservation {
  const { comp, kind, registryIdentityId } = params;
  const listingId = listingItemIdFromUrl(comp.url);
  const effectiveAt = dateValue(
    kind === "SOLD" ? comp.soldAt || comp.observedAt : comp.listedAt || comp.observedAt,
  );
  const itemPrice = money(comp.itemPrice);
  const shippingPrice = money(comp.shippingPrice);
  const delivered = deliveredPrice(comp);
  const marketplace = marketplaceFromComp(comp);
  return {
    registry_identity_id: registryIdentityId,
    observation_fingerprint: observationFingerprint([
      registryIdentityId,
      kind,
      marketplace,
      comp.source,
      listingId || comp.url,
      itemPrice,
      shippingPrice,
      delivered,
      comp.currency || "USD",
      effectiveAt,
    ]),
    observation_kind: kind,
    marketplace,
    provider_source: comp.source || null,
    listing_item_id: listingId,
    listing_url: comp.url || null,
    title: comp.title || null,
    item_price: itemPrice,
    shipping_price: shippingPrice,
    buyer_fees: null,
    tax: null,
    delivered_price: delivered,
    currency: comp.currency || "USD",
    condition_text: String(comp.conditionText || "").trim() || null,
    match_score: Number.isFinite(Number(comp.matchScore)) ? Number(comp.matchScore) : null,
    effective_at: effectiveAt,
    observed_at: dateValue(params.observedAt) || new Date().toISOString(),
    scan_id: params.scanId || null,
    source_payload: comp as unknown as Record<string, unknown>,
  };
}

export function buildDealHunterTargetObservation(params: {
  registryIdentityId: string;
  target: ExactMarketTargetListing;
  observedAt: string;
  scanId?: string | null;
}): ExactMarketObservation {
  const target = params.target;
  const itemPrice = money(target.itemPrice);
  const shipping = money(target.shippingPrice);
  const buyerFees = money(target.buyerFees);
  const tax = money(target.tax);
  const explicitDelivered = money(target.deliveredPrice);
  const delivered = explicitDelivered ?? Number(
    ((itemPrice || 0) + (shipping || 0) + (buyerFees || 0) + (tax || 0)).toFixed(2),
  );
  const marketplace = String(target.marketplace || "Unknown").trim() || "Unknown";
  const listingId = String(target.listingItemId || "").trim() || listingItemIdFromUrl(target.listingUrl);
  const observedAt = dateValue(target.observedAt || params.observedAt) || new Date().toISOString();
  return {
    registry_identity_id: params.registryIdentityId,
    observation_fingerprint: observationFingerprint([
      params.registryIdentityId,
      "ASK",
      marketplace,
      "deal_hunter_target",
      listingId || target.listingUrl,
      itemPrice,
      shipping,
      buyerFees,
      tax,
      delivered,
      target.currency || "USD",
    ]),
    observation_kind: "ASK",
    marketplace,
    provider_source: "deal_hunter_target",
    listing_item_id: listingId,
    listing_url: target.listingUrl,
    title: target.title,
    item_price: itemPrice,
    shipping_price: shipping,
    buyer_fees: buyerFees,
    tax,
    delivered_price: delivered,
    currency: String(target.currency || "USD").trim() || "USD",
    condition_text: String(target.conditionText || "").trim() || null,
    match_score: 1,
    effective_at: observedAt,
    observed_at: observedAt,
    scan_id: params.scanId || null,
    source_payload: target as unknown as Record<string, unknown>,
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

export function calculateExactCardMarketTrend(
  observations: Array<Pick<ExactMarketObservation, "observation_kind" | "delivered_price" | "effective_at" | "observed_at">>,
) {
  const sold = observations
    .filter((row) => row.observation_kind === "SOLD" && row.delivered_price !== null)
    .sort((a, b) =>
      String(a.effective_at || a.observed_at).localeCompare(String(b.effective_at || b.observed_at)),
    );
  const asks = observations
    .filter((row) => row.observation_kind === "ASK" && row.delivered_price !== null)
    .sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));
  const soldValues = sold.map((row) => Number(row.delivered_price));
  const askValues = asks.map((row) => Number(row.delivered_price));
  let direction: "RISING" | "FALLING" | "STABLE" | "INSUFFICIENT_SOLD_HISTORY" =
    "INSUFFICIENT_SOLD_HISTORY";
  let percentChange: number | null = null;
  let earlyMedian: number | null = null;
  let recentMedian: number | null = null;
  if (soldValues.length >= 2) {
    const split = Math.max(1, Math.floor(soldValues.length / 2));
    earlyMedian = median(soldValues.slice(0, split));
    recentMedian = median(soldValues.slice(split));
    if (earlyMedian && recentMedian !== null) {
      percentChange = Number((((recentMedian - earlyMedian) / earlyMedian) * 100).toFixed(2));
      direction = percentChange > 10 ? "RISING" : percentChange < -10 ? "FALLING" : "STABLE";
    }
  }
  return {
    schemaVersion: "tcos.instacomp.exact-card-market-trend.v1",
    soldObservationCount: soldValues.length,
    askObservationCount: askValues.length,
    soldMedianAllTime: median(soldValues),
    latestSoldDeliveredPrice: soldValues.length ? soldValues[soldValues.length - 1] : null,
    latestAskDeliveredPrice: askValues.length ? askValues[askValues.length - 1] : null,
    earlySoldMedian: earlyMedian,
    recentSoldMedian: recentMedian,
    soldTrendPercent: percentChange,
    direction,
    asksUsedAsSoldValue: false,
  };
}

export async function persistExactCardMarketHistory(params: {
  registry: InstaCompRegistryTruth | null | undefined;
  ai: InstaCompAiResult;
  sold: InstaCompComp[];
  active: InstaCompComp[];
  targetListing?: ExactMarketTargetListing | null;
  scanId?: string | null;
  observedAt?: string;
}) {
  const identityId = String(params.registry?.identityId || "").trim();
  const fingerprint = String(params.registry?.fingerprintSha256 || "").trim();
  if (!params.registry?.matched || !identityId || !fingerprint) {
    return {
      status: "blocked" as const,
      reason: "Canonical Checklist Registry identity ID and fingerprint are required before market history can be trusted.",
      inserted: 0,
      duplicates: 0,
    };
  }
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  ).trim();
  if (!url || !key) {
    return { status: "skipped" as const, reason: "Supabase is not configured.", inserted: 0, duplicates: 0 };
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: existingIdentity, error: identityReadError } = await supabase
    .from("tcos_card_market_identities")
    .select("registry_fingerprint_sha256")
    .eq("registry_identity_id", identityId)
    .maybeSingle();
  if (identityReadError) throw new Error(`Market identity read failed: ${identityReadError.message}`);
  if (
    existingIdentity?.registry_fingerprint_sha256 &&
    existingIdentity.registry_fingerprint_sha256 !== fingerprint
  ) {
    throw new Error("Registry identity fingerprint changed; market history write was blocked.");
  }
  const now = dateValue(params.observedAt) || new Date().toISOString();
  const { error: identityWriteError } = await supabase.from("tcos_card_market_identities").upsert(
    {
      registry_identity_id: identityId,
      registry_fingerprint_sha256: fingerprint,
      identity_json: params.ai,
      verification_source: "checklist_registry",
      last_seen_at: now,
    },
    { onConflict: "registry_identity_id" },
  );
  if (identityWriteError) throw new Error(`Market identity write failed: ${identityWriteError.message}`);
  const rows = [
    ...(params.targetListing
      ? [buildDealHunterTargetObservation({
          registryIdentityId: identityId,
          target: params.targetListing,
          observedAt: now,
          scanId: params.scanId,
        })]
      : []),
    ...params.sold.map((comp) =>
      buildExactMarketObservation({ registryIdentityId: identityId, kind: "SOLD", comp, observedAt: now, scanId: params.scanId }),
    ),
    ...params.active.map((comp) =>
      buildExactMarketObservation({ registryIdentityId: identityId, kind: "ASK", comp, observedAt: now, scanId: params.scanId }),
    ),
  ];
  if (!rows.length) {
    return { status: "saved" as const, reason: "Identity retained; no exact market rows were available.", inserted: 0, duplicates: 0 };
  }
  const fingerprints = rows.map((row) => row.observation_fingerprint);
  const { data: existingRows, error: existingError } = await supabase
    .from("tcos_card_market_observations")
    .select("observation_fingerprint")
    .in("observation_fingerprint", fingerprints);
  if (existingError) throw new Error(`Market observation dedupe failed: ${existingError.message}`);
  const existing = new Set((existingRows || []).map((row) => String(row.observation_fingerprint)));
  const fresh = rows.filter((row) => !existing.has(row.observation_fingerprint));
  if (fresh.length) {
    const { error: insertError } = await supabase.from("tcos_card_market_observations").insert(fresh);
    if (insertError) throw new Error(`Market observation insert failed: ${insertError.message}`);
  }
  return {
    status: "saved" as const,
    reason: "Exact-card market history retained against the canonical Registry identity.",
    inserted: fresh.length,
    duplicates: rows.length - fresh.length,
    registryIdentityId: identityId,
    registryFingerprintSha256: fingerprint,
  };
}

export async function loadExactCardMarketHistory(registryIdentityId: string) {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  ).trim();
  if (!url || !key) throw new Error("Supabase is not configured.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await supabase
    .from("tcos_card_market_identities")
    .select("*")
    .eq("registry_identity_id", registryIdentityId)
    .maybeSingle();
  if (identityError) throw new Error(identityError.message);
  const { data: observations, error: observationsError } = await supabase
    .from("tcos_card_market_observations")
    .select("*")
    .eq("registry_identity_id", registryIdentityId)
    .order("observed_at", { ascending: true });
  if (observationsError) throw new Error(observationsError.message);
  return {
    identity,
    observations: observations || [],
    trend: calculateExactCardMarketTrend((observations || []) as ExactMarketObservation[]),
  };
}
