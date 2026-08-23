import { NextResponse } from "next/server";
import Stripe from "stripe";
import { hasValidAdminRequest } from "../../../../lib/admin-request-auth";
import { getStripePaymentRuntime } from "../../../../lib/live-payment-launch";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  validatePromotionInput,
} from "../../../../lib/store-promotions";

export const dynamic = "force-dynamic";

async function adminOnly(request: Request) {
  if (await hasValidAdminRequest(request)) return null;
  return NextResponse.json({ error: "Log in through the TCOS admin first." }, { status: 401 });
}

export async function GET(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("store_promotions")
    .select("*")
    .eq("store_id", getActiveStoreId())
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ promotions: data || [] });
}

export async function POST(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const input = validatePromotionInput(body);
    const firstOrderOnly = body.firstOrderOnly === true;
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const runtime = await getStripePaymentRuntime({ storeId, supabase });
    if (!runtime.allowed || !runtime.stripeKey) {
      return NextResponse.json({ error: runtime.reason }, { status: 503 });
    }
    const stripe = new Stripe(runtime.stripeKey);
    const coupon = await stripe.coupons.create({
      name: `${input.code} - ${input.percentOff}% off`,
      percent_off: input.percentOff,
      duration: "once",
      metadata: { store_id: storeId, managed_by: "tcos_admin" },
    });

    let promotionCode: Stripe.PromotionCode;
    try {
      promotionCode = await stripe.promotionCodes.create({
        promotion: { type: "coupon", coupon: coupon.id },
        code: input.code,
        active: true,
        ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
        ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
        restrictions: { first_time_transaction: firstOrderOnly },
        metadata: { store_id: storeId, managed_by: "tcos_admin" },
      });
    } catch (error) {
      await stripe.coupons.del(coupon.id).catch(() => undefined);
      throw error;
    }

    const { data: promotion, error: insertError } = await supabase
      .from("store_promotions")
      .insert({
        store_id: storeId,
        code: input.code,
        percent_off: input.percentOff,
        first_order_only: firstOrderOnly,
        active: true,
        expires_at: input.expiresAt?.toISOString() || null,
        max_redemptions: input.maxRedemptions,
        stripe_coupon_id: coupon.id,
        stripe_promotion_code_id: promotionCode.id,
        stripe_livemode: promotionCode.livemode,
      })
      .select("*")
      .single();
    if (insertError || !promotion) {
      await stripe.promotionCodes.update(promotionCode.id, { active: false }).catch(() => undefined);
      throw insertError || new Error("Promotion record was not saved.");
    }

    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Promotion could not be created." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;
  try {
    const body = await request.json();
    const id = String(body.id || "");
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: promotion, error } = await supabase
      .from("store_promotions")
      .select("*")
      .eq("id", id)
      .eq("store_id", storeId)
      .single();
    if (error || !promotion) return NextResponse.json({ error: "Promotion not found." }, { status: 404 });

    if (body.action === "set-active") {
      const active = body.active === true;
      const runtime = await getStripePaymentRuntime({ storeId, supabase });
      if (!runtime.allowed || !runtime.stripeKey) {
        return NextResponse.json({ error: runtime.reason }, { status: 503 });
      }
      const stripe = new Stripe(runtime.stripeKey);
      await stripe.promotionCodes.update(promotion.stripe_promotion_code_id, { active });
      const { error: updateError } = await supabase
        .from("store_promotions")
        .update({ active, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("store_id", storeId);
      if (updateError) throw updateError;
    } else {
      return NextResponse.json({ error: "Unknown promotion action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Promotion could not be updated." },
      { status: 400 },
    );
  }
}
