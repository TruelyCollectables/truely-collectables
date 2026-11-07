import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelCompSubject = {
  id: string;
  name: string;
  sport_or_category: string | null;
  league_or_brand: string | null;
};

export type MarketIntelIdentity = {
  id: string;
  subject_id: string | null;
  collectible_type: string;
  sport_or_category: string | null;
  season_year: string | null;
  manufacturer: string | null;
  brand: string | null;
  product_line: string | null;
  set_name: string | null;
  insert_name: string | null;
  card_number: string | null;
  parallel_name: string;
  variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookie_designation: boolean;
  condition_type: string;
  grading_company: string | null;
  grade: string | null;
  identity_key: string;
  display_name: string;
  identity_confidence: number;
  active: boolean;
  subject: MarketIntelCompSubject | null;
};

export type MarketIntelSoldComp = {
  id: string;
  marketplace_id: string;
  collectible_identity_id: string;
  external_sale_id: string | null;
  source_url: string | null;
  original_title: string | null;
  sold_at: string;
  sold_price: number;
  shipping_price: number;
  buyer_fee: number;
  quantity: number;
  unit_delivered_price: number;
  verified: boolean;
  match_confidence: number;
  excluded: boolean;
  exclusion_reason: string | null;
  outlier_flag: boolean;
  marketplace: { id: string; name: string; slug: string } | null;
};

export type MarketIntelValueSnapshot = {
  id: string;
  collectible_identity_id: string;
  calculated_at: string;
  window_days: number;
  sample_size: number;
  median_value: number | null;
  average_value: number | null;
  low_value: number | null;
  high_value: number | null;
  conservative_value: number | null;
  confidence_score: number;
  liquidity_score: number;
  seven_day_change_pct: number | null;
  thirty_day_change_pct: number | null;
  ninety_day_change_pct: number | null;
  calculation_notes: string | null;
};

type RawIdentity = Omit<MarketIntelIdentity, "subject">;
type RawComp = Omit<MarketIntelSoldComp, "marketplace">;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function percentChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function valuesBetween(
  comps: Array<Pick<MarketIntelSoldComp, "sold_at" | "unit_delivered_price">>,
  now: Date,
  minimumDaysAgo: number,
  maximumDaysAgo: number,
) {
  const minimum = now.getTime() - maximumDaysAgo * 86_400_000;
  const maximum = now.getTime() - minimumDaysAgo * 86_400_000;
  return comps
    .filter((comp) => {
      const soldAt = new Date(comp.sold_at).getTime();
      return soldAt >= minimum && soldAt < maximum;
    })
    .map((comp) => numberValue(comp.unit_delivered_price))
    .filter((value) => value > 0);
}

function normalizeValueSnapshot(row: Record<string, unknown>): MarketIntelValueSnapshot {
  return {
    id: String(row.id),
    collectible_identity_id: String(row.collectible_identity_id),
    calculated_at: String(row.calculated_at),
    window_days: numberValue(row.window_days),
    sample_size: numberValue(row.sample_size),
    median_value: nullableNumber(row.median_value),
    average_value: nullableNumber(row.average_value),
    low_value: nullableNumber(row.low_value),
    high_value: nullableNumber(row.high_value),
    conservative_value: nullableNumber(row.conservative_value),
    confidence_score: numberValue(row.confidence_score),
    liquidity_score: numberValue(row.liquidity_score),
    seven_day_change_pct: nullableNumber(row.seven_day_change_pct),
    thirty_day_change_pct: nullableNumber(row.thirty_day_change_pct),
    ninety_day_change_pct: nullableNumber(row.ninety_day_change_pct),
    calculation_notes: row.calculation_notes ? String(row.calculation_notes) : null,
  };
}

export async function getMarketIntelCompOverview() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [identityResult, subjectResult, valueResult, compResult] = await Promise.all([
    supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,subject_id,collectible_type,sport_or_category,season_year,manufacturer,brand,product_line,set_name,insert_name,card_number,parallel_name,variation_name,serial_numbered_to,autograph,memorabilia,rookie_designation,condition_type,grading_company,grade,identity_key,display_name,identity_confidence,active",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("tcos_mi_subjects")
      .select("id,name,sport_or_category,league_or_brand")
      .eq("active", true)
      .order("name"),
    supabase
      .from("tcos_mi_market_values")
      .select("*")
      .order("calculated_at", { ascending: false }),
    supabase
      .from("tcos_mi_sold_comps")
      .select("id,collectible_identity_id,verified,excluded,outlier_flag"),
  ]);

  for (const result of [identityResult, subjectResult, valueResult, compResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const subjects = (subjectResult.data || []) as MarketIntelCompSubject[];
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const latestValueByIdentity = new Map<string, MarketIntelValueSnapshot>();

  for (const raw of valueResult.data || []) {
    const row = normalizeValueSnapshot(raw as Record<string, unknown>);
    if (!latestValueByIdentity.has(row.collectible_identity_id)) {
      latestValueByIdentity.set(row.collectible_identity_id, row);
    }
  }

  const compCountByIdentity = new Map<string, number>();
  for (const comp of compResult.data || []) {
    if (comp.verified && !comp.excluded && !comp.outlier_flag) {
      compCountByIdentity.set(
        comp.collectible_identity_id,
        (compCountByIdentity.get(comp.collectible_identity_id) || 0) + 1,
      );
    }
  }

  const identities = ((identityResult.data || []) as RawIdentity[]).map((identity) => ({
    ...identity,
    serial_numbered_to: nullableNumber(identity.serial_numbered_to),
    identity_confidence: numberValue(identity.identity_confidence),
    subject: identity.subject_id ? subjectById.get(identity.subject_id) || null : null,
    latestValue: latestValueByIdentity.get(identity.id) || null,
    verifiedCompCount: compCountByIdentity.get(identity.id) || 0,
  }));

  return { identities, subjects };
}

export async function getMarketIntelCompDetail(identityId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const [identityResult, compResult, valueResult, marketplaceResult] = await Promise.all([
    supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,subject_id,collectible_type,sport_or_category,season_year,manufacturer,brand,product_line,set_name,insert_name,card_number,parallel_name,variation_name,serial_numbered_to,autograph,memorabilia,rookie_designation,condition_type,grading_company,grade,identity_key,display_name,identity_confidence,active",
      )
      .eq("id", identityId)
      .maybeSingle(),
    supabase
      .from("tcos_mi_sold_comps")
      .select("*")
      .eq("collectible_identity_id", identityId)
      .order("sold_at", { ascending: false }),
    supabase
      .from("tcos_mi_market_values")
      .select("*")
      .eq("collectible_identity_id", identityId)
      .order("calculated_at", { ascending: false })
      .limit(10),
    supabase
      .from("tcos_mi_marketplaces")
      .select("id,name,slug")
      .eq("active", true)
      .order("name"),
  ]);

  for (const result of [identityResult, compResult, valueResult, marketplaceResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!identityResult.data) return null;

  const rawIdentity = identityResult.data as RawIdentity;
  const subjectResult = rawIdentity.subject_id
    ? await supabase
        .from("tcos_mi_subjects")
        .select("id,name,sport_or_category,league_or_brand")
        .eq("id", rawIdentity.subject_id)
        .maybeSingle()
    : { data: null, error: null };
  if (subjectResult.error) throw new Error(subjectResult.error.message);

  const marketplaces = (marketplaceResult.data || []) as Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  const marketplaceById = new Map(marketplaces.map((marketplace) => [marketplace.id, marketplace]));
  const comps = ((compResult.data || []) as RawComp[]).map((comp) => ({
    ...comp,
    sold_price: numberValue(comp.sold_price),
    shipping_price: numberValue(comp.shipping_price),
    buyer_fee: numberValue(comp.buyer_fee),
    quantity: numberValue(comp.quantity),
    unit_delivered_price: numberValue(comp.unit_delivered_price),
    match_confidence: numberValue(comp.match_confidence),
    marketplace: marketplaceById.get(comp.marketplace_id) || null,
  }));

  return {
    identity: {
      ...rawIdentity,
      serial_numbered_to: nullableNumber(rawIdentity.serial_numbered_to),
      identity_confidence: numberValue(rawIdentity.identity_confidence),
      subject: (subjectResult.data as MarketIntelCompSubject | null) || null,
    } satisfies MarketIntelIdentity,
    comps,
    values: (valueResult.data || []).map((row) =>
      normalizeValueSnapshot(row as Record<string, unknown>),
    ),
    marketplaces,
  };
}

export async function recalculateMarketIntelValue(identityId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_sold_comps")
    .select("sold_at,unit_delivered_price,verified,excluded,outlier_flag,match_confidence")
    .eq("collectible_identity_id", identityId)
    .eq("verified", true)
    .eq("excluded", false)
    .eq("outlier_flag", false)
    .order("sold_at", { ascending: false });

  if (error) throw new Error(error.message);

  const now = new Date();
  const comps = (data || []).map((comp) => ({
    sold_at: String(comp.sold_at),
    unit_delivered_price: numberValue(comp.unit_delivered_price),
    match_confidence: numberValue(comp.match_confidence),
  }));
  const current90 = valuesBetween(comps, now, 0, 90);
  const current30 = valuesBetween(comps, now, 0, 30);
  const previous30 = valuesBetween(comps, now, 30, 60);
  const current7 = valuesBetween(comps, now, 0, 7);
  const previous7 = valuesBetween(comps, now, 7, 14);
  const previous90 = valuesBetween(comps, now, 90, 180);
  const medianValue = median(current90);
  const averageValue = average(current90);
  const sampleSize = current90.length;
  const latestAgeDays = comps.length
    ? Math.max(0, (now.getTime() - new Date(comps[0].sold_at).getTime()) / 86_400_000)
    : 999;
  const averageMatch = comps.length
    ? comps.reduce((sum, comp) => sum + comp.match_confidence, 0) / comps.length
    : 0;

  let confidence = sampleSize >= 30 ? 95 : sampleSize >= 15 ? 86 : sampleSize >= 8 ? 74 : sampleSize >= 4 ? 58 : sampleSize >= 2 ? 38 : sampleSize === 1 ? 18 : 0;
  if (averageMatch < 90) confidence -= 10;
  if (latestAgeDays <= 7 && sampleSize > 0) confidence += 5;
  confidence = Math.max(0, Math.min(100, confidence));

  const liquidity = Math.min(100, current30.length * 10 + sampleSize * 1.5);
  const conservativeValue =
    sampleSize >= 4 && medianValue !== null && averageValue !== null
      ? Math.min(medianValue, averageValue)
      : sampleSize > 0
        ? medianValue
        : null;

  const payload = {
    collectible_identity_id: identityId,
    calculated_at: now.toISOString(),
    window_days: 90,
    sample_size: sampleSize,
    median_value: medianValue,
    average_value: averageValue,
    low_value: current90.length ? Math.min(...current90) : null,
    high_value: current90.length ? Math.max(...current90) : null,
    conservative_value: conservativeValue,
    confidence_score: confidence,
    liquidity_score: liquidity,
    seven_day_change_pct: percentChange(median(current7), median(previous7)),
    thirty_day_change_pct: percentChange(median(current30), median(previous30)),
    ninety_day_change_pct: percentChange(median(current90), median(previous90)),
    calculation_notes:
      sampleSize === 0
        ? "No verified exact-card comps in the last 90 days."
        : sampleSize <= 3
          ? "Thin sample. Treat this as a range, not a precise market value."
          : "Calculated from verified exact-card delivered-price comps; excluded and outlier rows are omitted.",
  };

  const { data: inserted, error: insertError } = await supabase
    .from("tcos_mi_market_values")
    .insert(payload)
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);

  return normalizeValueSnapshot(inserted as Record<string, unknown>);
}
