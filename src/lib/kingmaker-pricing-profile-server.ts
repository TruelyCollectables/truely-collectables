import { createClient } from "@supabase/supabase-js";
import type { requireInstaCompJobActor } from "./instacomp-job-server";
import {
  DEFAULT_KINGMAKER_PRICING_PROFILE,
  type KingmakerPricingProfile,
} from "./kingmaker-pricing-profile";

type InstaCompActor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

type PricingProfileRow = {
  id: string;
  name: string;
  marketplace_fee_pct: number | string;
  payment_fee_pct: number | string;
  payment_fixed_fee: number | string;
  estimated_shipping_cost: number | string;
  target_margin_pct: number | string;
  is_default: boolean;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pricing profiles require service-role access.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function kingmakerPricingProfileOwner(actor: InstaCompActor) {
  return {
    storeId: actor.storeId,
    sellerAccountId: actor.type === "seller" ? actor.sellerAccountId || null : null,
  };
}

function mapProfile(row: PricingProfileRow): KingmakerPricingProfile {
  return {
    id: row.id,
    name: row.name,
    marketplaceFeePct: Number(row.marketplace_fee_pct),
    paymentFeePct: Number(row.payment_fee_pct),
    paymentFixedFee: Number(row.payment_fixed_fee),
    estimatedShippingCost: Number(row.estimated_shipping_cost),
    targetMarginPct: Number(row.target_margin_pct),
    isDefault: row.is_default === true,
  };
}

export async function resolveKingmakerPricingProfile(params: {
  actor: InstaCompActor;
  profileId?: string | null;
}) {
  const { storeId, sellerAccountId } = kingmakerPricingProfileOwner(params.actor);
  const profileId = String(params.profileId || "").trim();
  let query = client()
    .from("tcos_kingmaker_pricing_profiles")
    .select("id,name,marketplace_fee_pct,payment_fee_pct,payment_fixed_fee,estimated_shipping_cost,target_margin_pct,is_default")
    .eq("store_id", storeId);
  query = sellerAccountId
    ? query.eq("seller_account_id", sellerAccountId)
    : query.is("seller_account_id", null);
  query = profileId
    ? query.eq("id", profileId)
    : query.eq("is_default", true).order("updated_at", { ascending: false });

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw error;
  if (data) {
    return {
      profile: mapProfile(data as PricingProfileRow),
      selection: profileId ? "requested" as const : "default" as const,
    };
  }

  return {
    profile: { id: "tcos-standard", ...DEFAULT_KINGMAKER_PRICING_PROFILE },
    selection: "fallback" as const,
  };
}
