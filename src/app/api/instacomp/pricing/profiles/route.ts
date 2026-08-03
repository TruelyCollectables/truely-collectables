import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import {
  DEFAULT_KINGMAKER_PRICING_PROFILE,
  normalizeKingmakerPricingProfile,
} from "../../../../../lib/kingmaker-pricing-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Pricing profiles require service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function owner(actor: Awaited<ReturnType<typeof requireInstaCompJobActor>>) {
  return {
    storeId: actor.storeId,
    sellerAccountId: actor.type === "seller" ? actor.sellerAccountId || null : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    const { storeId, sellerAccountId } = owner(actor);
    let query = client()
      .from("tcos_kingmaker_pricing_profiles")
      .select("id,name,marketplace_fee_pct,payment_fee_pct,payment_fixed_fee,estimated_shipping_cost,target_margin_pct,is_default")
      .eq("store_id", storeId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true });
    query = sellerAccountId ? query.eq("seller_account_id", sellerAccountId) : query.is("seller_account_id", null);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      profiles: (data || []).map((row) => ({
        id: row.id,
        name: row.name,
        marketplaceFeePct: Number(row.marketplace_fee_pct),
        paymentFeePct: Number(row.payment_fee_pct),
        paymentFixedFee: Number(row.payment_fixed_fee),
        estimatedShippingCost: Number(row.estimated_shipping_cost),
        targetMarginPct: Number(row.target_margin_pct),
        isDefault: row.is_default === true,
      })),
      fallback: DEFAULT_KINGMAKER_PRICING_PROFILE,
      sourceDisclosure: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load pricing profiles.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: "A JSON request body is required." }, { status: 400 });
    const profile = normalizeKingmakerPricingProfile(body);
    const { storeId, sellerAccountId } = owner(actor);
    const db = client();

    if (profile.isDefault) {
      let reset = db.from("tcos_kingmaker_pricing_profiles").update({ is_default: false }).eq("store_id", storeId);
      reset = sellerAccountId ? reset.eq("seller_account_id", sellerAccountId) : reset.is("seller_account_id", null);
      const { error: resetError } = await reset;
      if (resetError) throw resetError;
    }

    const { data, error } = await db
      .from("tcos_kingmaker_pricing_profiles")
      .insert({
        store_id: storeId,
        seller_account_id: sellerAccountId,
        name: profile.name,
        marketplace_fee_pct: profile.marketplaceFeePct,
        payment_fee_pct: profile.paymentFeePct,
        payment_fixed_fee: profile.paymentFixedFee,
        estimated_shipping_cost: profile.estimatedShippingCost,
        target_margin_pct: profile.targetMarginPct,
        is_default: profile.isDefault,
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data.id, profile, sourceDisclosure: null }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save pricing profile.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
