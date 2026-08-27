import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { kingmakerPricingProfileOwner } from "./kingmaker-pricing-profile-server";

type Actor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;
type SavedViewRow = {
  id: string | number;
  name: string;
  filters: Record<string, unknown> | null;
  is_default: boolean | null;
  version: number | string | null;
  created_at: string | null;
  updated_at: string | null;
};
type ReceiptRow = {
  decision_status: string | null;
  confidence: number | string | null;
  sold_comp_count: number | string | null;
  expected_profit: number | string | null;
  created_at: string | null;
};
type ProfileRow = { id: string | number; is_default: boolean | null; archived_at: string | null };
type AuditRow = {
  id: string | number;
  profile_id: string | number | null;
  action: string;
  profile_name: string;
  created_at: string | null;
};
type SavedViewSummaryRow = { id: string | number; is_default: boolean | null };

type SavedViewInput = {
  name?: unknown;
  filters?: unknown;
  isDefault?: unknown;
};

type AtomicSavedViewResult = {
  id: string;
  version: number;
  retired?: boolean;
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

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : null;
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeFilters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const filters: Record<string, unknown> = {};
  const status = boundedText(input.status, 40);
  if (["ready", "review_required", "insufficient_evidence"].includes(status)) {
    filters.status = status;
  }
  const identityId = boundedText(input.identityId, 200);
  if (identityId) filters.identityId = identityId;
  const profileId = boundedText(input.profileId, 100);
  if (profileId) filters.profileId = profileId;
  const minConfidence = boundedNumber(input.minConfidence, 0, 1);
  if (minConfidence !== null) filters.minConfidence = minConfidence;
  const minProfit = boundedNumber(input.minProfit, -1_000_000, 1_000_000);
  if (minProfit !== null) filters.minProfit = minProfit;
  for (const key of ["from", "to"] as const) {
    const text = boundedText(input[key], 40);
    const parsed = Date.parse(text);
    if (text && Number.isFinite(parsed)) filters[key] = new Date(parsed).toISOString();
  }
  return filters;
}

function rpcError(error: { code?: string | null; message?: string | null } | null) {
  const code = String(error?.code || "unknown");
  const message = String(error?.message || "Saved view atomic operation failed.");
  throw new Error(`KINGMAKER_PRICING_SAVED_VIEW_RPC_FAILED:${code}:${message}`);
}

function atomicSavedViewResult(data: unknown): AtomicSavedViewResult {
  const row = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
  const id = String(row?.id || "").trim();
  const version = Number(row?.version);
  if (!id || !Number.isInteger(version) || version < 1) {
    throw new Error("KINGMAKER_PRICING_SAVED_VIEW_RPC_RESULT_INVALID");
  }
  return { id, version, retired: row?.retired === true };
}

export async function listKingmakerPricingSavedViews(actor: Actor) {
  const { data, error } = await scope(
    client().from("tcos_kingmaker_pricing_saved_views")
      .select("id,name,filters,is_default,version,created_at,updated_at")
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false }),
    actor,
  );
  if (error) throw error;
  return ((data || []) as SavedViewRow[]).map((row: SavedViewRow) => ({
    id: String(row.id),
    name: String(row.name),
    filters: row.filters || {},
    isDefault: row.is_default === true,
    version: Number(row.version || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createKingmakerPricingSavedView(actor: Actor, input: SavedViewInput) {
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw new Error("Saved view name is required.");
  const isDefault = input.isDefault === true;
  const filters = normalizeFilters(input.filters);
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(actor);
  const { data, error } = await client().rpc(
    "tcos_create_kingmaker_pricing_saved_view_atomic",
    {
      p_store_id: storeId,
      p_seller_account_id: sellerAccountId,
      p_name: name,
      p_filters: filters,
      p_is_default: isDefault,
    },
  );
  if (error) rpcError(error);
  const result = atomicSavedViewResult(data);
  return {
    id: result.id,
    name,
    filters,
    isDefault,
    version: result.version,
    createdAt: null,
    updatedAt: null,
  };
}

export async function retireKingmakerPricingSavedView(
  actor: Actor,
  viewId: string,
  expectedVersion: unknown,
) {
  const version = Number(expectedVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Saved view expectedVersion is required.");
  }
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(actor);
  const { data, error } = await client().rpc(
    "tcos_retire_kingmaker_pricing_saved_view_atomic",
    {
      p_store_id: storeId,
      p_seller_account_id: sellerAccountId,
      p_view_id: viewId,
      p_expected_version: version,
    },
  );
  if (error) rpcError(error);
  const result = atomicSavedViewResult(data);
  return { id: result.id, version: result.version, retired: result.retired === true };
}

export async function getKingmakerPricingCommandCenterSnapshot(actor: Actor) {
  const db = client();
  const receiptQuery = scope(
    db.from("tcos_kingmaker_pricing_decision_receipts")
      .select("decision_status,confidence,sold_comp_count,expected_profit,created_at")
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

  const receipts = (receiptsResult.data || []) as ReceiptRow[];
  const profiles = (profilesResult.data || []) as ProfileRow[];
  const auditRows = (auditResult.data || []) as AuditRow[];
  const savedViews = (viewsResult.data || []) as SavedViewSummaryRow[];
  const ready = receipts.filter((row: ReceiptRow) => row.decision_status === "ready");
  const review = receipts.filter((row: ReceiptRow) => row.decision_status === "review_required");
  const insufficient = receipts.filter((row: ReceiptRow) => row.decision_status === "insufficient_evidence");
  const average = (values: number[]) => values.length ? values.reduce((sum: number, value: number) => sum + value, 0) / values.length : null;

  return {
    window: { receiptLimit: 250, limited: true },
    receipts: {
      total: receipts.length,
      ready: ready.length,
      reviewRequired: review.length,
      insufficientEvidence: insufficient.length,
      readyRate: receipts.length ? ready.length / receipts.length : null,
      averageConfidence: average(receipts.map((row: ReceiptRow) => Number(row.confidence)).filter(Number.isFinite)),
      averageSoldCompCount: average(receipts.map((row: ReceiptRow) => Number(row.sold_comp_count)).filter(Number.isFinite)),
      estimatedProfitAtCeiling: receipts.reduce((sum: number, row: ReceiptRow) => sum + Number(row.expected_profit || 0), 0),
    },
    profiles: {
      active: profiles.length,
      hasDefault: profiles.some((row: ProfileRow) => row.is_default === true),
    },
    savedViews: {
      active: savedViews.length,
      hasDefault: savedViews.some((row: SavedViewSummaryRow) => row.is_default === true),
    },
    audit: auditRows.map((row: AuditRow) => ({
      id: String(row.id),
      profileId: row.profile_id ? String(row.profile_id) : null,
      action: String(row.action),
      profileName: String(row.profile_name),
      createdAt: row.created_at,
    })),
    boundary: "advisory_only" as const,
  };
}
