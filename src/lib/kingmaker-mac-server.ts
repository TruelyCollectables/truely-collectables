import "server-only";

import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
} from "./instacomp-mac-credentials";

function baseUrl() {
  const configured = String(process.env.KINGMAKER_MAC_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const instacomp = getConfiguredInstaCompMacUrl();
  if (instacomp) return instacomp.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8796";
  throw new Error("KINGMAKER Mac URL is not configured.");
}

function headers(json = false) {
  const result = new Headers({ Accept: "application/json" });
  const key = getConfiguredInstaCompMacKey();
  if (!key) throw new Error("KINGMAKER Mac API key is not configured.");
  result.set("X-InstaComp-AI-Key", key);
  if (json) result.set("Content-Type", "application/json");
  return result;
}

export async function kingmakerMacRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: init?.headers || headers(Boolean(init?.body)),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(payload?.detail || payload?.error || `KINGMAKER Mac request failed (${response.status}).`);
    throw new Error(detail);
  }
  return payload as T;
}

export type KingmakerOpportunity = {
  id: string;
  sourceType: string;
  sourceKey: string;
  sourceWatch: string | null;
  title: string;
  directUrl: string | null;
  marketplace: string | null;
  sellerName: string | null;
  askingPrice: number | null;
  shippingPrice: number | null;
  buyerFee: number | null;
  deliveredCost: number | null;
  identityStatus: string;
  marketStatus: string;
  lifecycleStatus: string;
  ownerDecision: string | null;
  ownerDecisionReason: string | null;
  decisionAt: string | null;
  purchaseReference: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string | null;
  identity: Record<string, unknown>;
  exactMarket: Record<string, unknown>;
  metadata: Record<string, unknown>;
  truthConsistent: boolean;
  truthWarnings: string[];
};

export type KingmakerTruthHealth = {
  ready: boolean;
  opportunities: number;
  inconsistent: number;
  warnings: string[];
  lastUpdatedAt: string | null;
};

export const KINGMAKER_PENDING_RECEIPTS_CUTOFF = "2026-09-16";

export type KingmakerPendingReceipt = {
  acquisitionItemId: number;
  purchaseId: string;
  source: string;
  purchaseDate: string | null;
  purchasedAt: string | null;
  createdAt: string | null;
  title: string | null;
  seller: string | null;
  orderNumber: string | null;
  sourceLot: string | null;
  listingUrl: string | null;
  allocatedCost: number | null;
  costStatus: string;
  status: string;
  sourceAuthority: string;
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialFamily: string | null;
  isAuto: boolean | null;
  isRelic: boolean | null;
  inventoryItemId: string | null;
  scanId: string | null;
  inventoryState: string | null;
  disposition: string | null;
  confidence: number | null;
  matchedAt: string | null;
  receivedAt: string | null;
  receiptMode: string | null;
  linkedAt: string | null;
};

export type KingmakerPendingReceiptsResponse = {
  ok: boolean;
  sourceAuthority: string;
  cutoffDate: string;
  receipts: KingmakerPendingReceipt[];
  summary: {
    pendingRows: number;
    receivedAwaitingPhotos: number;
    pendingKnownBasis: number;
    unknownBasisCount: number;
  };
};

export function getKingmakerDashboard() {
  return kingmakerMacRequest<Record<string, any>>("/v1/kingmaker/dashboard");
}

export function getKingmakerTruthHealth() {
  return kingmakerMacRequest<KingmakerTruthHealth>("/v1/kingmaker/truth-health");
}

export function getKingmakerOpportunities(limit = 100) {
  return kingmakerMacRequest<{ sourceAuthority: string; opportunities: KingmakerOpportunity[] }>(
    `/v1/kingmaker/opportunities?limit=${Math.max(1, Math.min(limit, 500))}`,
  );
}

export function getKingmakerCapital(limit = 50) {
  return kingmakerMacRequest<Record<string, any>>(`/v1/kingmaker/capital?limit=${Math.max(1, Math.min(limit, 200))}`);
}

export function getKingmakerMarketTruth(limit = 40) {
  return kingmakerMacRequest<Record<string, any>>(`/v1/kingmaker/market-truth?limit=${Math.max(1, Math.min(limit, 200))}`);
}

export function getKingmakerOperations() {
  return kingmakerMacRequest<Record<string, any>>("/v1/kingmaker/operations");
}

export function getKingmakerPendingReceipts(cutoffDate = KINGMAKER_PENDING_RECEIPTS_CUTOFF) {
  const q = new URLSearchParams({ cutoff_date: cutoffDate });
  return kingmakerMacRequest<KingmakerPendingReceiptsResponse>(`/v1/kingmaker/accounting/pending-receipts?${q}`);
}

export function decideKingmakerOpportunity(opportunityId: string, decision: string, reason?: string | null) {
  return kingmakerMacRequest<{ ok: boolean; opportunity: KingmakerOpportunity }>(
    `/v1/kingmaker/opportunities/${encodeURIComponent(opportunityId)}/decision`,
    { method: "POST", headers: headers(true), body: JSON.stringify({ decision, reason: reason || null }) },
  );
}

export function linkKingmakerPurchase(opportunityId: string, purchaseReference: string) {
  return kingmakerMacRequest<{ ok: boolean; opportunity: KingmakerOpportunity }>(
    `/v1/kingmaker/opportunities/${encodeURIComponent(opportunityId)}/purchase-link`,
    { method: "POST", headers: headers(true), body: JSON.stringify({ purchaseReference }) },
  );
}

export function upsertKingmakerListing(listing: Record<string, unknown>, sourceWatch?: string | null) {
  return kingmakerMacRequest<{ ok: boolean; opportunity: KingmakerOpportunity }>(
    "/v1/kingmaker/opportunities/upsert-listing",
    { method: "POST", headers: headers(true), body: JSON.stringify({ listing, sourceWatch: sourceWatch || null }) },
  );
}

function pricingOwnerQuery(storeId: string, sellerAccountId?: string | null) {
  const query = new URLSearchParams({ storeId });
  if (sellerAccountId) query.set("sellerAccountId", sellerAccountId);
  return query;
}

export function getKingmakerMacPricingReference(identityId: string) {
  return kingmakerMacRequest<{ ok: boolean; record: Record<string, any> | null }>(`/v1/kingmaker/pricing/reference/${encodeURIComponent(identityId)}`);
}

export function getKingmakerMacPricingHistory(identityId: string, limit = 24) {
  return kingmakerMacRequest<{ ok: boolean; history: Record<string, any>[] }>(`/v1/kingmaker/pricing/history/${encodeURIComponent(identityId)}?limit=${Math.max(1, Math.min(limit, 120))}`);
}

export function getKingmakerMacPricingProfiles(storeId: string, sellerAccountId?: string | null) {
  return kingmakerMacRequest<{ ok: boolean; profiles: Record<string, any>[] }>(`/v1/kingmaker/pricing/profiles?${pricingOwnerQuery(storeId, sellerAccountId)}`);
}

export function createKingmakerMacPricingProfile(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; profile: Record<string, any> }>("/v1/kingmaker/pricing/profiles", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function updateKingmakerMacPricingProfile(profileId: string, body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; profile: Record<string, any> }>(`/v1/kingmaker/pricing/profiles/${encodeURIComponent(profileId)}`, { method: "PUT", headers: headers(true), body: JSON.stringify(body) });
}

export function cloneKingmakerMacPricingProfile(profileId: string, body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; profile: Record<string, any> }>(`/v1/kingmaker/pricing/profiles/${encodeURIComponent(profileId)}/clone`, { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function retireKingmakerMacPricingProfile(profileId: string, storeId: string, sellerAccountId: string | null, expectedVersion: number) {
  const q = pricingOwnerQuery(storeId, sellerAccountId); q.set("expectedVersion", String(expectedVersion));
  return kingmakerMacRequest<{ ok: boolean; id: string; version: number; retired: boolean }>(`/v1/kingmaker/pricing/profiles/${encodeURIComponent(profileId)}?${q}`, { method: "DELETE", headers: headers() });
}

export function getKingmakerMacPricingSavedViews(storeId: string, sellerAccountId?: string | null) {
  return kingmakerMacRequest<{ ok: boolean; views: Record<string, any>[] }>(`/v1/kingmaker/pricing/saved-views?${pricingOwnerQuery(storeId, sellerAccountId)}`);
}

export function createKingmakerMacPricingSavedView(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; view: Record<string, any> }>("/v1/kingmaker/pricing/saved-views", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function retireKingmakerMacPricingSavedView(viewId: string, storeId: string, sellerAccountId: string | null, expectedVersion: number) {
  const q = pricingOwnerQuery(storeId, sellerAccountId); q.set("expectedVersion", String(expectedVersion));
  return kingmakerMacRequest<{ ok: boolean; id: string; version: number; retired: boolean }>(`/v1/kingmaker/pricing/saved-views/${encodeURIComponent(viewId)}?${q}`, { method: "DELETE", headers: headers() });
}

export function createKingmakerMacPricingReceipt(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; id: string }>("/v1/kingmaker/pricing/receipts", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function getKingmakerMacPricingReceipts(storeId: string, sellerAccountId: string | null, limit = 100) {
  const q = pricingOwnerQuery(storeId, sellerAccountId); q.set("limit", String(Math.max(1, Math.min(limit, 500))));
  return kingmakerMacRequest<{ ok: boolean; receipts: Record<string, any>[] }>(`/v1/kingmaker/pricing/receipts?${q}`);
}

export function getKingmakerMacPricingCommandCenter(storeId: string, sellerAccountId?: string | null) {
  return kingmakerMacRequest<{ ok: boolean; snapshot: Record<string, any> }>(`/v1/kingmaker/pricing/command-center?${pricingOwnerQuery(storeId, sellerAccountId)}`);
}

export function getKingmakerMacPricingCoverage(params: Record<string, unknown>) {
  const q = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); });
  return kingmakerMacRequest<{ ok: boolean; coverage: Record<string, any> }>(`/v1/kingmaker/pricing/coverage?${q}`);
}

export function getKingmakerMacPricingWorkOrders(params: Record<string, unknown>) {
  const q = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); });
  return kingmakerMacRequest<{ ok: boolean; workOrders: Record<string, any> }>(`/v1/kingmaker/pricing/work-orders?${q}`);
}

export function saveKingmakerMacPricingWorkOrder(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; workOrder: Record<string, any> }>("/v1/kingmaker/pricing/work-orders", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function getKingmakerMacPricingExecution(params: Record<string, unknown>) {
  const q = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); });
  return kingmakerMacRequest<{ ok: boolean; execution: Record<string, any> }>(`/v1/kingmaker/pricing/work-orders/execution?${q}`);
}

export function saveKingmakerMacPricingExecution(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; workOrder: Record<string, any> }>("/v1/kingmaker/pricing/work-orders/execution", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function getKingmakerMacPricingReviews(params: Record<string, unknown>) {
  const q = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); });
  return kingmakerMacRequest<{ ok: boolean; reviews: Record<string, any> }>(`/v1/kingmaker/pricing/work-orders/reviews?${q}`);
}

export function saveKingmakerMacPricingReview(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; review: Record<string, any> }>("/v1/kingmaker/pricing/work-orders/reviews", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function getKingmakerMacPricingActivity(params: Record<string, unknown>) {
  const q = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v !== null && v !== undefined && v !== "") q.set(k, String(v)); });
  return kingmakerMacRequest<{ ok: boolean; activity: Record<string, any> }>(`/v1/kingmaker/pricing/work-orders/activity?${q}`);
}

export function getKingmakerMacPricingTargetHistory(attackKey: string, limit = 50, offset = 0) {
  return kingmakerMacRequest<{ ok: boolean; history: Record<string, any> }>(`/v1/kingmaker/pricing/work-orders/${encodeURIComponent(attackKey)}/history?limit=${Math.max(1, Math.min(limit,100))}&offset=${Math.max(0,offset)}`);
}

export function getKingmakerMacPricingScoreboard() {
  return kingmakerMacRequest<{ ok: boolean; scoreboard: Record<string, any> }>("/v1/kingmaker/pricing/work-orders/scoreboard");
}

export function getKingmakerMacLatestSentFingerprint() {
  return kingmakerMacRequest<{ ok: boolean; fingerprint: string | null }>("/v1/kingmaker/pricing/delivery/latest-sent");
}

export function claimKingmakerMacDelivery(body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; claim: Record<string, any> | null }>("/v1/kingmaker/pricing/delivery/claim", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}

export function completeKingmakerMacDelivery(runId: string, body: Record<string, unknown>) {
  return kingmakerMacRequest<{ ok: boolean; status: string; completedAt: string }>(`/v1/kingmaker/pricing/delivery/${encodeURIComponent(runId)}/complete`, { method: "POST", headers: headers(true), body: JSON.stringify(body) });
}
