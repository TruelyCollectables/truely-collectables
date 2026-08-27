import "server-only";

import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelObservationSource =
  | "discovery_candidate"
  | "deal_score"
  | "market_snapshot";

export type MarketIntelMarketObservation = {
  id: string;
  observation_key: string;
  observed_at: string;
  observed_on: string;
  subject_id: string | null;
  collectible_identity_id: string | null;
  marketplace_id: string | null;
  source_type: MarketIntelObservationSource;
  external_listing_id: string | null;
  source_url: string | null;
  title: string | null;
  quantity: number;
  asking_price: number;
  shipping_price: number;
  buyer_fee: number;
  delivered_price: number;
  unit_delivered_price: number;
  market_value: number | null;
  verified_comp_count: number;
  market_sample_size: number;
  confidence_score: number | null;
  liquidity_score: number | null;
  seven_day_change_pct: number | null;
  thirty_day_change_pct: number | null;
  deal_label: string | null;
  discount_pct: number | null;
  expected_net_profit: number | null;
  buy_score: number | null;
  metadata: Record<string, unknown>;
};

export type CaptureMarketObservationInput = {
  sourceType: MarketIntelObservationSource;
  sourceId: string;
  subjectId?: string | null;
  collectibleIdentityId?: string | null;
  marketplaceId?: string | null;
  externalListingId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  quantity?: number;
  askingPrice?: number;
  shippingPrice?: number;
  buyerFee?: number;
  deliveredPrice?: number;
  marketValue?: number | null;
  verifiedCompCount?: number;
  marketSampleSize?: number;
  confidenceScore?: number | null;
  liquidityScore?: number | null;
  sevenDayChangePct?: number | null;
  thirtyDayChangePct?: number | null;
  dealLabel?: string | null;
  discountPct?: number | null;
  expectedNetProfit?: number | null;
  buyScore?: number | null;
  metadata?: Record<string, unknown>;
  observedAt?: string;
};

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function denverDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function missingTable(message: string | null | undefined) {
  const value = String(message || "").toLowerCase();
  return (
    value.includes("tcos_mi_market_observations") &&
    (value.includes("does not exist") ||
      value.includes("schema cache") ||
      value.includes("could not find the table"))
  );
}

function observationKey(input: CaptureMarketObservationInput, observedOn: string) {
  return createHash("sha256")
    .update(
      [
        observedOn,
        input.sourceType,
        input.sourceId,
        input.marketplaceId || "none",
        input.externalListingId || "none",
        input.collectibleIdentityId || "none",
      ].join("|"),
    )
    .digest("hex");
}

function normalizeObservation(row: Record<string, unknown>): MarketIntelMarketObservation {
  return {
    id: String(row.id),
    observation_key: String(row.observation_key),
    observed_at: String(row.observed_at),
    observed_on: String(row.observed_on),
    subject_id: row.subject_id ? String(row.subject_id) : null,
    collectible_identity_id: row.collectible_identity_id
      ? String(row.collectible_identity_id)
      : null,
    marketplace_id: row.marketplace_id ? String(row.marketplace_id) : null,
    source_type: String(row.source_type) as MarketIntelObservationSource,
    external_listing_id: row.external_listing_id
      ? String(row.external_listing_id)
      : null,
    source_url: row.source_url ? String(row.source_url) : null,
    title: row.title ? String(row.title) : null,
    quantity: numberValue(row.quantity, 1),
    asking_price: numberValue(row.asking_price),
    shipping_price: numberValue(row.shipping_price),
    buyer_fee: numberValue(row.buyer_fee),
    delivered_price: numberValue(row.delivered_price),
    unit_delivered_price: numberValue(row.unit_delivered_price),
    market_value: nullableNumber(row.market_value),
    verified_comp_count: numberValue(row.verified_comp_count),
    market_sample_size: numberValue(row.market_sample_size),
    confidence_score: nullableNumber(row.confidence_score),
    liquidity_score: nullableNumber(row.liquidity_score),
    seven_day_change_pct: nullableNumber(row.seven_day_change_pct),
    thirty_day_change_pct: nullableNumber(row.thirty_day_change_pct),
    deal_label: row.deal_label ? String(row.deal_label) : null,
    discount_pct: nullableNumber(row.discount_pct),
    expected_net_profit: nullableNumber(row.expected_net_profit),
    buy_score: nullableNumber(row.buy_score),
    metadata: recordValue(row.metadata),
  };
}

export async function captureMarketIntelObservation(
  input: CaptureMarketObservationInput,
) {
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();
  if (Number.isNaN(observedAt.getTime())) {
    throw new Error("Market observation timestamp is invalid.");
  }
  const observedOn = denverDate(observedAt);
  const quantity = Math.max(1, Math.round(numberValue(input.quantity, 1)));
  const askingPrice = Math.max(0, numberValue(input.askingPrice));
  const shippingPrice = Math.max(0, numberValue(input.shippingPrice));
  const buyerFee = Math.max(0, numberValue(input.buyerFee));
  const deliveredPrice = Math.max(
    0,
    numberValue(input.deliveredPrice, askingPrice + shippingPrice + buyerFee),
  );
  const unitDeliveredPrice = deliveredPrice / quantity;
  const supabase = createSupabaseServerClient({ admin: true });
  const payload = {
    observation_key: observationKey(input, observedOn),
    observed_at: observedAt.toISOString(),
    observed_on: observedOn,
    subject_id: input.subjectId || null,
    collectible_identity_id: input.collectibleIdentityId || null,
    marketplace_id: input.marketplaceId || null,
    source_type: input.sourceType,
    external_listing_id: input.externalListingId || null,
    source_url: input.sourceUrl || null,
    title: input.title || null,
    quantity,
    asking_price: askingPrice,
    shipping_price: shippingPrice,
    buyer_fee: buyerFee,
    delivered_price: deliveredPrice,
    unit_delivered_price: unitDeliveredPrice,
    market_value: nullableNumber(input.marketValue),
    verified_comp_count: Math.max(0, Math.round(numberValue(input.verifiedCompCount))),
    market_sample_size: Math.max(0, Math.round(numberValue(input.marketSampleSize))),
    confidence_score: nullableNumber(input.confidenceScore),
    liquidity_score: nullableNumber(input.liquidityScore),
    seven_day_change_pct: nullableNumber(input.sevenDayChangePct),
    thirty_day_change_pct: nullableNumber(input.thirtyDayChangePct),
    deal_label: input.dealLabel || null,
    discount_pct: nullableNumber(input.discountPct),
    expected_net_profit: nullableNumber(input.expectedNetProfit),
    buy_score: nullableNumber(input.buyScore),
    metadata: {
      ...(input.metadata || {}),
      evidence_class: "live_market_observation",
      verified_sold_comp: false,
    },
  };

  const { data, error } = await supabase
    .from("tcos_mi_market_observations")
    .upsert(payload, { onConflict: "observation_key" })
    .select("id,observation_key,observed_on")
    .single();

  if (error) {
    if (missingTable(error.message)) {
      return {
        stored: false as const,
        migrationRequired: true as const,
        error: error.message,
      };
    }
    throw new Error(error.message);
  }

  return {
    stored: true as const,
    migrationRequired: false as const,
    id: String(data.id),
    observationKey: String(data.observation_key),
    observedOn: String(data.observed_on),
  };
}

export async function getMarketIntelObservations(options?: {
  limit?: number;
  subjectIds?: string[];
}) {
  const limit = Math.max(1, Math.min(5000, Math.round(options?.limit || 2000)));
  const supabase = createSupabaseServerClient({ admin: true });
  let query = supabase
    .from("tcos_mi_market_observations")
    .select("*")
    .order("observed_at", { ascending: false })
    .limit(limit);
  if (options?.subjectIds?.length) {
    query = query.in("subject_id", options.subjectIds);
  }
  const { data, error } = await query;

  if (error) {
    if (missingTable(error.message)) {
      return {
        available: false as const,
        migrationRequired: true as const,
        rows: [] as MarketIntelMarketObservation[],
        error: error.message,
      };
    }
    throw new Error(error.message);
  }

  return {
    available: true as const,
    migrationRequired: false as const,
    rows: (data || []).map((row) =>
      normalizeObservation(row as Record<string, unknown>),
    ),
    error: null,
  };
}
