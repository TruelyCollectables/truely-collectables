import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { kingmakerPricingProfileOwner } from "./kingmaker-pricing-profile-server";

type Actor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

type SavedViewInput = {
  name?: unknown;
  filters?: unknown;
  isDefault?: unknown;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pricing Command Center requires service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function scope(query: any, actor: Actor) {
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(actor);
  query = query.eq("store_id", storeId);
  return sellerAccountId ? query.eq("seller_account_id", sellerAccountId) : query.is("seller_account_id", null);
}

function normalizeFilters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const allowed = ["status", "identityId", "profileId", "minConfidence", "minProfit", "from", "to"];
  return Object.fromEntries(allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

export async function listKingmakerPricingSavedViews(actor: Actor) {
  const { data, error } = await scope(
    client().from("tcos_kingmaker_pricing_saved_views")
      .select("id,name,filters,is_default,created_at,updated_at")
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false }),
    actor,
  );
  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    filters: row.filters || {},
    isDefault: row.is_default === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createKingmakerPricingSavedView(actor: Actor, input: SavedViewInput) {
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw new Error("Saved view name is required.");
  const isDefault = input.isDefault === true;
  const db = client();
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(actor);
  if (isDefault) {
    const { error } = await scope(
      db.from("tcos_kingmaker_pricing_saved_views").update({ is_default: false }),
      actor,
    ).is("archived_at", null);
    if (error) throw error;
  }
  const { data, error } = await db.from("tcos_kingmaker_pricing_saved_views").insert({
    store_id: storeId,
    seller_account_id: sellerAccountId,
    name,
    filters: normalizeFilters(input.filters),
    is_default: isDefault,
  }).select("id,name,filters,is_default,created_at,updated_at").single();
  if (error) throw error;
  return {
    id: String(data.id),
    name: String(data.name),
    filters: data.filters || {},
    isDefault: data.is_default === true,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function retireKingmakerPricingSavedView(actor: Actor, viewId: string) {
  const { data, error } = await scope(
    client().from("tcos_kingmaker_pricing_saved_views")
      .update({ archived_at: new Date().toISOString(), is_default: false, updated_at: new Date().toISOString() })
      .eq("id", viewId)
      .is("archived_at", null)
      .select("id")
      .maybeSingle(),
    actor,
  );
  if (error) throw error;
  if (!data) throw new Error("Saved view not found.");
  return { id: String(data.id), retired: true };
}

export async function getKingmakerPricingCommandCenterSnapshot(actor: Actor) {
  const db = client();
  const receiptQuery = scope(
    db.from("tcos_kingmaker_pricing_receipts")
      .select("status,confidence,sold_comp_count,estimated_profit_at_ceiling,created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    actor,
  );
  const profileQuery = scope(
    db.from("tcos_kingmaker_pricing_profiles")
      .select("id,is_default,archived_at")
      .is("archived_at", null),
    actor,
  );
  const auditQuery = scope(
    db.from("tcos_kingmaker_pricing_profile_audit")
      .select("id,profile_id,action,profile_name,created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    actor,
  );
  const viewQuery = scope(
    db.from("tcos_kingmaker_pricing_saved_views")
      .select("id,is_default")
      .is("archived_at", null),
    actor,
  );

  const [receiptsResult, profilesResult, auditResult, viewsResult] = await Promise.all([
    receiptQuery,
    profileQuery,
    auditQuery,
    viewQuery,
  ]);
  for (const result of [receiptsResult, profilesResult, auditResult, viewsResult]) {
    if (result.error) throw result.error;
  }

  const receipts = receiptsResult.data || [];
  const ready = receipts.filter((row) => row.status === "ready");
  const review = receipts.filter((row) => row.status === "review_required");
  const insufficient = receipts.filter((row) => row.status === "insufficient_evidence");
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return {
    window: { receiptLimit: 250, limited: true },
    receipts: {
      total: receipts.length,
      ready: ready.length,
      reviewRequired: review.length,
      insufficientEvidence: insufficient.length,
      readyRate: receipts.length ? ready.length / receipts.length : null,
      averageConfidence: average(receipts.map((row) => Number(row.confidence)).filter(Number.isFinite)),
      averageSoldCompCount: average(receipts.map((row) => Number(row.sold_comp_count)).filter(Number.isFinite)),
      estimatedProfitAtCeiling: receipts.reduce((sum, row) => sum + Number(row.estimated_profit_at_ceiling || 0), 0),
    },
    profiles: {
      active: profilesResult.data?.length || 0,
      hasDefault: (profilesResult.data || []).some((row) => row.is_default === true),
    },
    savedViews: {
      active: viewsResult.data?.length || 0,
      hasDefault: (viewsResult.data || []).some((row) => row.is_default === true),
    },
    audit: (auditResult.data || []).map((row) => ({
      id: String(row.id),
      profileId: row.profile_id ? String(row.profile_id) : null,
      action: String(row.action),
      profileName: String(row.profile_name),
      createdAt: row.created_at,
    })),
    boundary: "advisory_only" as const,
  };
}
