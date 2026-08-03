import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";
import type { KingmakerPricingDecision } from "./kingmaker-pricing-decision";
import type { KingmakerPricingProfileResolution } from "./kingmaker-pricing-profile-server";

type InstaCompActor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pricing decision receipts require service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function writeKingmakerPricingDecisionReceipt(params: {
  actor: InstaCompActor;
  identityId: string;
  profileResolution: KingmakerPricingProfileResolution;
  decision: KingmakerPricingDecision;
}) {
  const profile = params.profileResolution.profile;
  const { data, error } = await client()
    .from("tcos_kingmaker_pricing_decision_receipts")
    .insert({
      store_id: params.actor.storeId,
      seller_account_id: params.actor.type === "seller" ? params.actor.sellerAccountId || null : null,
      identity_id: params.identityId,
      profile_id: profile.id === "tcos-standard" ? null : profile.id,
      profile_name: profile.name,
      profile_selection: params.profileResolution.selection,
      decision_status: params.decision.status,
      suggested_list_price: params.decision.suggestedListPrice,
      buy_ceiling: params.decision.buyCeiling,
      market_median: params.decision.marketMedian,
      reference_midpoint: params.decision.referenceMidpoint,
      estimated_net_proceeds: params.decision.estimatedNetProceeds,
      expected_profit: params.decision.expectedProfit,
      minimum_profitable_list_price: params.decision.minimumProfitableListPrice,
      confidence: params.decision.confidence,
      sold_comp_count: params.decision.soldCompCount,
      review_reasons: params.decision.reviewReasons,
      marketplace_fee_pct: params.decision.marketplaceFeePct,
      payment_fee_pct: params.decision.paymentFeePct,
      payment_fixed_fee: params.decision.paymentFixedFee,
      shipping_cost: params.decision.shippingCost,
      target_margin_pct: params.decision.targetMarginPct,
      boundary: params.decision.boundary,
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}
