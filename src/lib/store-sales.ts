import type { SupabaseClient } from "@supabase/supabase-js";

export type StoreSaleScopeType = "all" | "filter" | "products";

export type StoreSaleScope = {
  search?: string;
  sections?: string[];
  players?: string[];
  productIds?: number[];
  minPrice?: number | null;
  maxPrice?: number | null;
};

export type StoreSaleCampaign = {
  id: string;
  store_id: string;
  name: string;
  percent_off: number;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  scope_type: StoreSaleScopeType;
  scope: StoreSaleScope;
  created_at?: string;
  updated_at?: string;
};

export type StoreSaleCandidate = {
  productId: number;
  title: string;
  player?: string | null;
  section?: string | null;
  price: number;
};

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function normalizedList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean))];
}

export function normalizeStoreSaleScope(value: unknown): StoreSaleScope {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const productIds = Array.isArray(raw.productIds)
    ? [...new Set(raw.productIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 5000)
    : [];
  const minPrice = raw.minPrice === null || raw.minPrice === undefined || raw.minPrice === ""
    ? null
    : money(raw.minPrice);
  const maxPrice = raw.maxPrice === null || raw.maxPrice === undefined || raw.maxPrice === ""
    ? null
    : money(raw.maxPrice);
  return {
    search: String(raw.search || "").trim().slice(0, 120) || undefined,
    sections: normalizedList(raw.sections).slice(0, 50),
    players: normalizedList(raw.players).slice(0, 100),
    productIds,
    minPrice,
    maxPrice,
  };
}

export function storeSaleCampaignIsLive(campaign: StoreSaleCampaign, now = new Date()) {
  if (!campaign.active) return false;
  const starts = new Date(campaign.starts_at).getTime();
  const ends = campaign.ends_at ? new Date(campaign.ends_at).getTime() : null;
  const time = now.getTime();
  return Number.isFinite(starts) && starts <= time && (ends === null || ends > time);
}

export function storeSaleCampaignMatches(
  campaign: StoreSaleCampaign,
  candidate: StoreSaleCandidate,
) {
  if (campaign.scope_type === "all") return true;
  const scope = normalizeStoreSaleScope(campaign.scope);
  if (campaign.scope_type === "products") {
    return Boolean(scope.productIds?.includes(candidate.productId));
  }

  const search = scope.search?.toLowerCase();
  if (search && !candidate.title.toLowerCase().includes(search)) return false;
  if (scope.sections?.length) {
    const section = String(candidate.section || "").trim().toLowerCase();
    if (!scope.sections.some((entry) => entry.toLowerCase() === section)) return false;
  }
  if (scope.players?.length) {
    const player = String(candidate.player || "").trim().toLowerCase();
    if (!scope.players.some((entry) => entry.toLowerCase() === player)) return false;
  }
  if (scope.minPrice !== null && scope.minPrice !== undefined && candidate.price < scope.minPrice) return false;
  if (scope.maxPrice !== null && scope.maxPrice !== undefined && candidate.price > scope.maxPrice) return false;
  return true;
}

export function resolveStoreSale(params: {
  campaigns: StoreSaleCampaign[];
  candidate: StoreSaleCandidate;
  now?: Date;
}) {
  const applicable = params.campaigns
    .filter((campaign) => storeSaleCampaignIsLive(campaign, params.now))
    .filter((campaign) => storeSaleCampaignMatches(campaign, params.candidate))
    .sort((a, b) => Number(b.percent_off) - Number(a.percent_off));
  const campaign = applicable[0] || null;
  const originalPrice = money(params.candidate.price);
  if (!campaign || originalPrice <= 0) {
    return { campaign: null, originalPrice, price: originalPrice, discountPercent: 0 };
  }
  const discountPercent = Math.min(90, Math.max(1, Number(campaign.percent_off)));
  const price = Math.max(0.01, money(originalPrice * (1 - discountPercent / 100)));
  return { campaign, originalPrice, price, discountPercent };
}

export async function loadLiveStoreSales(params: {
  supabase: SupabaseClient;
  storeId: string;
  now?: Date;
}) {
  const now = params.now || new Date();
  const { data, error } = await params.supabase
    .from("store_sales_campaigns")
    .select("id,store_id,name,percent_off,active,starts_at,ends_at,scope_type,scope,created_at,updated_at")
    .eq("store_id", params.storeId)
    .eq("active", true)
    .lte("starts_at", now.toISOString())
    .or(`ends_at.is.null,ends_at.gt.${now.toISOString()}`)
    .order("percent_off", { ascending: false });
  if (error) {
    if (error.code === "42P01") return [];
    throw error;
  }
  return (data || []).map((row: any) => ({
    ...row,
    percent_off: Number(row.percent_off),
    scope: normalizeStoreSaleScope(row.scope),
  })) as StoreSaleCampaign[];
}
