import { NextResponse } from "next/server";
import { Resend } from "resend";
import { InventoryEngineError } from "../../../../modules/inventory";
import { getStoreSettings } from "../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../lib/stores";
import { trustedRequestOrigin } from "../../../../lib/site-origin";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { createServerInventoryEngine } from "../../../../lib/server-inventory-engine";
import {
  adminOfferDecisionError,
  normalizedOfferMoney,
} from "../../../../lib/admin-offer-decision";
import { buildOfferShippingSnapshot } from "../../../../lib/offer-shipping";
import { createOfferCheckoutToken } from "../../../../lib/offer-checkout-token";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const resendKey = process.env.RESEND_API_KEY;
    const supabase = createSupabaseServerClient({ admin: true });
    const resend = resendKey ? new Resend(resendKey) : null;
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);
    const { offerId, counterAmount } = await req.json();

    if (!offerId || !counterAmount || Number(counterAmount) <= 0) {
      return NextResponse.json(
        { error: "Missing offerId or counter amount" },
        { status: 400 },
      );
    }

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select("*, products(id, title, image_url, price, quantity, ebay_item_id)")
      .eq("id", offerId)
      .eq("store_id", storeId)
      .single();

    if (offerError || !offer) {
      return NextResponse.json(
        { error: offerError?.message || "Offer not found" },
        { status: 404 },
      );
    }

    if (offer.status !== "pending") {
      return NextResponse.json(
        { error: "Only pending offers can be countered" },
        { status: 400 },
      );
    }

    if (!offer.products) {
      return NextResponse.json(
        { error: "Product not found for this offer" },
        { status: 404 },
      );
    }

    const decisionError = adminOfferDecisionError({
      action: "countered",
      offerStatus: offer.status,
      offerAmount: offer.offer_amount,
      counterAmount,
      productPrice: offer.products.price,
      productQuantity: offer.products.quantity,
    });

    if (decisionError) {
      return NextResponse.json({ error: decisionError }, { status: 400 });
    }

    const inventoryEngine = createServerInventoryEngine();
    await inventoryEngine.requireAvailableCartItems([
      { id: Number(offer.products.id), quantity: 1 },
    ]);

    const amount = normalizedOfferMoney(counterAmount);
    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: "Offer action needs: positive counter amount." },
        { status: 400 },
      );
    }

    const listingPriceBasis = Number(
      offer.listing_price_at_offer ?? offer.products.price ?? amount,
    );
    const minimumShipping = buildOfferShippingSnapshot({
      saleSubtotal: amount,
      listingPriceBasis,
    });
    const origin = trustedRequestOrigin(req);
    const token = createOfferCheckoutToken({
      offerId: Number(offer.id),
      storeId,
    });
    const checkoutUrl = `${origin}/offer-checkout/${offer.id}?token=${encodeURIComponent(token)}`;

    const { data: updatedOffer, error: updateError } = await supabase
      .from("offers")
      .update({
        status: "countered",
        counter_amount: amount,
        stripe_checkout_url: checkoutUrl,
        stripe_session_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", offerId)
      .eq("store_id", storeId)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (!updatedOffer) {
      return NextResponse.json(
        {
          error:
            "Offer is no longer pending. Refresh offers before deciding again.",
        },
        { status: 409 },
      );
    }

    if (resend) {
      const storeName = storeSettings.displayName.trim() || "our store";
      await resend.emails.send({
        from: storeSettings.orderFromEmail,
        to: offer.customer_email,
        subject: `Counter offer from ${storeSettings.displayName}`,
        html: `
          <h2>Counter Offer</h2>
          <p>Hi ${offer.customer_name || "there"},</p>
          <p>Thank you for your offer on <strong>${offer.products.title}</strong>.</p>
          <p>Your original offer was <strong>$${Number(offer.offer_amount).toFixed(2)}</strong>.</p>
          <p>We can accept a counter offer of <strong>$${amount.toFixed(2)}</strong>.</p>
          <p>Shipping starts with <strong>${minimumShipping.name}</strong> at <strong>$${minimumShipping.amount.toFixed(2)}</strong>, based on the original $${listingPriceBasis.toFixed(2)} listing price.</p>
          <p>Choose shipping and optional Buyer Protection before secure payment:</p>
          <p><a href="${checkoutUrl}" style="display:inline-block;padding:12px 18px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Choose Shipping and Pay</a></p>
          <p>Thank you,<br/>${storeName}</p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      offer: updatedOffer,
      checkoutUrl,
    });
  } catch (error: any) {
    if (error instanceof InventoryEngineError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to send counter offer" },
      { status: 500 },
    );
  }
}
