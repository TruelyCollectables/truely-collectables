import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "../../../../lib/admin-request-auth";
import { getStripeLiveSecretKey, getStripeTestSecretKey } from "../../../../lib/stripe-credentials";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import {
  validatePromotionInput,
} from "../../../../lib/store-promotions";

export const dynamic = "force-dynamic";

type StripeObject = {
  id: string;
  livemode?: boolean;
  active?: boolean;
};

async function stripeRequest(
  secretKey: string,
  path: string,
  fields: Record<string, string | number | boolean>,
  idempotencyKey?: string,
  method: "POST" | "DELETE" = "POST",
) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body,
  });
  const payload = await response.json() as StripeObject & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Stripe request failed (${response.status}).`);
  return payload;
}

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
    .is("archived_at", null)
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
    if (input.percentOff <= 0) {
      return NextResponse.json({ error: "Enter a positive discount percent." }, { status: 400 });
    }
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    // TC applies coupon savings to server-priced Stripe Checkout line items.
    // The code does not need a separate Stripe promotion-code object.
    const { data: promotion, error: insertError } = await supabase
      .from("store_promotions")
      .insert({
        store_id: storeId,
        code: input.code,
        percent_off: input.percentOff,
        first_order_only: firstOrderOnly,
        free_shipping: input.freeShipping,
        category_scope: input.category,
        active: true,
        expires_at: input.expiresAt?.toISOString() || null,
        max_redemptions: input.maxRedemptions,
        stripe_coupon_id: null,
        stripe_promotion_code_id: null,
        stripe_livemode: false,
      })
      .select("*")
      .single();
    if (insertError || !promotion) throw insertError || new Error("Promotion record was not saved.");

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
    if (promotion.archived_at) {
      return NextResponse.json({ error: "This promotion has been removed from Kingmaker." }, { status: 409 });
    }

    if (body.action === "set-active") {
      const active = body.active === true;
      if (promotion.stripe_promotion_code_id) {
        const stripeKey = promotion.stripe_livemode ? getStripeLiveSecretKey() : getStripeTestSecretKey();
        if (!stripeKey) {
          return NextResponse.json({ error: "Stripe credentials unavailable for this historical coupon." }, { status: 503 });
        }
        await stripeRequest(stripeKey, `promotion_codes/${promotion.stripe_promotion_code_id}`, { active });
      }
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


export async function DELETE(request: Request) {
  const blocked = await adminOnly(request);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const id = String(body.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Invalid coupon id." }, { status: 400 });
    }
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const { data: promotion, error } = await supabase
      .from("store_promotions")
      .select("*")
      .eq("id", id)
      .eq("store_id", storeId)
      .single();
    if (error || !promotion) {
      return NextResponse.json({ error: "Promotion not found." }, { status: 404 });
    }
    if (promotion.archived_at) {
      return NextResponse.json({ error: "Coupon has already been removed." }, { status: 409 });
    }
    // Check recorded redemptions *and* paid orders; preserving those links is
    // more important than trusting a possibly stale times_redeemed counter.
    const [redemptionCount, paidOrderLookup] = await Promise.all([
      supabase
        .from("store_promotion_redemptions")
        .select("id", { head: true, count: "exact" })
        .eq("promotion_id", promotion.id),
      supabase
        .from("orders")
        .select("id", { head: true, count: "exact" })
        .eq("store_id", storeId)
        .ilike("discount_code", promotion.code)
        .eq("payment_status", "paid"),
    ]);
    if (redemptionCount.error || paidOrderLookup.error) {
      throw redemptionCount.error || paidOrderLookup.error;
    }
    const preserveHistory =
      promotion.active === true ||
      Number(promotion.times_redeemed || 0) > 0 ||
      (redemptionCount.count || 0) > 0 ||
      (paidOrderLookup.count || 0) > 0;

    // Disabling a coupon must remain possible even when the live-checkout
    // launch gate is closed. Use only the credential for its recorded Stripe mode.
    if (promotion.stripe_promotion_code_id) {
      const stripeKey = promotion.stripe_livemode
        ? getStripeLiveSecretKey()
        : getStripeTestSecretKey();
      if (!stripeKey) {
        return NextResponse.json({ error: "Stripe credentials are unavailable for this coupon." }, { status: 503 });
      }
      const stripePromotion = await stripeRequest(
        stripeKey,
        "promotion_codes/" + promotion.stripe_promotion_code_id,
        { active: false },
      );
      if (stripePromotion.id !== promotion.stripe_promotion_code_id || stripePromotion.active !== false) {
        throw new Error("Stripe did not confirm the promotion code was disabled.");
      }
    }

    if (preserveHistory) {
      const { error: archiveError } = await supabase
        .from("store_promotions")
        .update({ active: false, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("store_id", storeId)
        .is("archived_at", null)
        .select("id")
        .single();
      if (archiveError) throw archiveError;
      return NextResponse.json({ ok: true, removed: true, archived: true });
    }
    const { error: deleteError } = await supabase
      .from("store_promotions")
      .delete()
      .eq("id", id)
      .eq("store_id", storeId)
      .select("id")
      .single();
    if (deleteError) throw deleteError;
    return NextResponse.json({ ok: true, removed: true, archived: false });

  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Coupon could not be removed.",
    }, { status: 400 });
  }
}
