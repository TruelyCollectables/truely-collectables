import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireInstaCompJobSupabase } from "./instacomp-job-server";

export type KingmakerPricingStatus = "verified" | "review_required";

export type KingmakerPricingRecord = {
  identityId: string;
  identityKey: string;
  editionDate: string;
  low: number | null;
  high: number | null;
  midpoint: number | null;
  currency: string;
  confidence: number;
  status: KingmakerPricingStatus;
  historyCount: number;
  trendPct: number | null;
  refreshedAt: string;
};

function finiteNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePricingRow(row: Record<string, unknown>): KingmakerPricingRecord {
  const identityId = String(row.checklist_identity_id || "").trim();
  const identityKey = String(row.entity_key || "").trim();
  const editionDate = String(row.edition_date || "").trim();
  const currency = String(row.currency || "USD").trim().toUpperCase();
  const status = String(row.status || "") as KingmakerPricingStatus;
  const refreshedAt = String(row.refreshed_at || "").trim();

  if (!identityId || !identityKey || !editionDate || !refreshedAt) {
    throw new Error("KINGMAKER_PRICING_ROW_INVALID");
  }
  if (status !== "verified" && status !== "review_required") {
    throw new Error("KINGMAKER_PRICING_STATUS_INVALID");
  }

  return {
    identityId,
    identityKey,
    editionDate,
    low: finiteNumber(row.value_low),
    high: finiteNumber(row.value_high),
    midpoint: finiteNumber(row.midpoint),
    currency,
    confidence: finiteNumber(row.confidence) ?? 0,
    status,
    historyCount: Math.max(1, Math.trunc(finiteNumber(row.history_count) ?? 1)),
    trendPct: finiteNumber(row.trend_pct),
    refreshedAt,
  };
}

export async function getKingmakerPricingByIdentityId(
  identityId: string,
  supabase: SupabaseClient = requireInstaCompJobSupabase(),
): Promise<KingmakerPricingRecord | null> {
  const normalizedIdentityId = identityId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedIdentityId)) {
    throw new Error("KINGMAKER_PRICING_IDENTITY_ID_INVALID");
  }

  const { data, error } = await supabase
    .from("tcos_kingmaker_price_index")
    .select(
      "checklist_identity_id,entity_key,edition_date,value_low,value_high,midpoint,currency,confidence,status,history_count,trend_pct,refreshed_at",
    )
    .eq("checklist_identity_id", normalizedIdentityId)
    .maybeSingle();

  if (error) {
    throw new Error(`KINGMAKER_PRICING_LOOKUP_FAILED:${error.code || "unknown"}`);
  }

  return data ? normalizePricingRow(data as Record<string, unknown>) : null;
}

export async function getKingmakerPricingHistory(
  identityId: string,
  limit = 24,
  supabase: SupabaseClient = requireInstaCompJobSupabase(),
) {
  const normalizedLimit = Math.max(1, Math.min(Math.trunc(limit), 120));
  const { data, error } = await supabase
    .from("tcos_kingmaker_price_history")
    .select("edition_date,value_low,value_high,midpoint,currency,confidence,validation_status,created_at")
    .eq("checklist_identity_id", identityId.trim())
    .order("edition_date", { ascending: false })
    .limit(normalizedLimit);

  if (error) {
    throw new Error(`KINGMAKER_PRICING_HISTORY_FAILED:${error.code || "unknown"}`);
  }

  return (data || []).map((row) => ({
    editionDate: String(row.edition_date),
    low: finiteNumber(row.value_low),
    high: finiteNumber(row.value_high),
    midpoint: finiteNumber(row.midpoint),
    currency: String(row.currency || "USD").toUpperCase(),
    confidence: finiteNumber(row.confidence) ?? 0,
    status: row.validation_status === "accepted" ? "verified" : "review_required",
  }));
}
