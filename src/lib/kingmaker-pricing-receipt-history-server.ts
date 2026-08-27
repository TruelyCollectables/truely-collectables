import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";

type InstaCompActor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

type ReceiptRow = {
  id: string;
  identity_id: string;
  profile_name: string;
  profile_selection: "requested" | "default" | "fallback";
  decision_status: "ready" | "review_required" | "insufficient_evidence";
  suggested_list_price: number | string | null;
  buy_ceiling: number | string | null;
  estimated_net_proceeds: number | string | null;
  expected_profit: number | string | null;
  confidence: number | string;
  sold_comp_count: number;
  review_reasons: string[] | null;
  created_at: string;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pricing receipt history requires service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function kingmakerPricingReceiptOwner(actor: InstaCompActor) {
  return {
    storeId: actor.storeId,
    sellerAccountId: actor.type === "seller" ? actor.sellerAccountId || null : null,
  };
}

function optionalMoney(value: number | string | null) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapKingmakerPricingReceipt(row: ReceiptRow) {
  return {
    id: row.id,
    identityId: row.identity_id,
    pricingProfile: {
      name: row.profile_name,
      selection: row.profile_selection,
    },
    status: row.decision_status,
    suggestedListPrice: optionalMoney(row.suggested_list_price),
    buyCeiling: optionalMoney(row.buy_ceiling),
    estimatedNetProceeds: optionalMoney(row.estimated_net_proceeds),
    estimatedProfitAtCeiling: optionalMoney(row.expected_profit),
    confidence: Number(row.confidence),
    soldCompCount: Number(row.sold_comp_count),
    reviewReasons: Array.isArray(row.review_reasons) ? row.review_reasons : [],
    createdAt: row.created_at,
    boundary: "advisory_only" as const,
  };
}

export async function getKingmakerPricingReceiptHistory(params: {
  actor: InstaCompActor;
  receiptId?: string | null;
  limit?: number;
}) {
  const { storeId, sellerAccountId } = kingmakerPricingReceiptOwner(params.actor);
  const receiptId = String(params.receiptId || "").trim();
  const limit = Math.max(1, Math.min(Number(params.limit || 25), 100));

  let query = client()
    .from("tcos_kingmaker_pricing_decision_receipts")
    .select("id,identity_id,profile_name,profile_selection,decision_status,suggested_list_price,buy_ceiling,estimated_net_proceeds,expected_profit,confidence,sold_comp_count,review_reasons,created_at")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false });

  query = sellerAccountId
    ? query.eq("seller_account_id", sellerAccountId)
    : query.is("seller_account_id", null);

  if (receiptId) query = query.eq("id", receiptId);

  const { data, error } = await query.limit(receiptId ? 1 : limit);
  if (error) throw error;
  return (data || []).map((row) => mapKingmakerPricingReceipt(row as ReceiptRow));
}
