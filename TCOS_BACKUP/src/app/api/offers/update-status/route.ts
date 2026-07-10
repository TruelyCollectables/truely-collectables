import { NextResponse } from "next/server";
import Stripe from "stripe";
import { Resend } from "resend";
import {
  InventoryEngineError,
  inventoryEngine,
} from "../../../../modules/inventory";
import { getStoreSettings } from "../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../lib/stores";
import { trustedRequestOrigin } from "../../../../lib/site-origin";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getStripePaymentRuntime } from "../../../../lib/live-payment-launch";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const resendKey = process.env.RESEND_API_KEY;

    const supabase = createSupabaseServerClient({ admin: true });
    const resend = resendKey ? new Resend(resendKey) : null;
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);

    const { offerId, status } = await req.json();

    if (!offerId || !status) {
      return NextResponse.json(
        { error: "Missing offerId or status" },
        { status: 400 }
      );
    }

    if (!["accepted", "declined"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
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
        { status: 404 }
      );
    }

    if (!offer.products) {
      return NextResponse.json(
        { error: "Product not found for this offer" },
        { status: 404 }
      );
    }

    if (status === "declined") {
      const { data: updatedOffer, error: updateError } = await supabase
        .from("offers")
        .update({
          status: "declined",
          updated_at: new Date().toISOString(),
        })
        .eq("id", offerId)
        .eq("store_id", storeId)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      if (resend) {
        const storeName = storeSettings.displayName.trim() || "our store";

        await resend.emails.send({
          from: storeSettings.orderFromEmail,
          to: offer.customer_email,
          subject: `Offer update from ${storeSettings.displayName}`,
          html: `
            <h2>Offer Declined</h2>
            <p>Hi ${offer.customer_name || "there"},</p>
            <p>Thank you for your offer on <strong>${offer.products.title}</strong>.</p>
            <p>Unfortunately, we are unable to accept this offer.</p>
            <p>Thank you,<br/>${storeName}</p>
          `,
        });
      }

      return NextResponse.json({ success: true, offer: updatedOffer });
    }

    await inventoryEngine.requireAvailableCartItems([
      { id: Number(offer.products.id), quantity: 1 },
    ]);

    const origin = trustedRequestOrigin(req);

    const amount = Number(offer.offer_amount);
    const stripeRuntime = await getStripePaymentRuntime({ storeId, supabase });
    if (!stripeRuntime.allowed || !stripeRuntime.stripeKey) {
      return NextResponse.json(
        { error: stripeRuntime.reason },
        { status: 503 },
      );
    }
    const stripe = new Stripe(stripeRuntime.stripeKey);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: offer.customer_email,
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: offer.products.title,
              images: offer.products.image_url ? [offer.products.image_url] : [],
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        store_id: storeId,
        account_id: offer.account_id || "",
        type: "accepted_offer",
        offer_id: String(offer.id),
        product_id: String(offer.products.id),
        ebay_item_id: offer.products.ebay_item_id || "",
        offer_amount: String(amount),
        cart: JSON.stringify([{ id: Number(offer.products.id), quantity: 1 }]),
        subtotal: amount.toFixed(2),
        item_count: "1",
        shipping_method: "OFFER_CHECKOUT",
        shipping_name: "Offer checkout",
        shipping_amount: "0.00",
        tos_accepted: offer.tos_accepted ? "true" : "false",
        tos_version: offer.tos_version || "",
        tos_accepted_at: offer.tos_accepted_at || "",
        tos_acceptance_event_id: offer.tos_acceptance_event_id || "",
        tos_ip_address: offer.tos_ip_address || "",
        tos_user_agent: offer.tos_user_agent || "",
        tos_ip_risk: offer.tos_ip_risk || "",
        tos_ip_block_reason: offer.tos_ip_block_reason || "",
      },
      success_url: `${origin}/success?type=offer&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/product/${offer.products.id}`,
    });

    const { data: updatedOffer, error: updateError } = await supabase
      .from("offers")
      .update({
        status: "accepted",
        stripe_checkout_url: session.url,
        stripe_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", offerId)
      .eq("store_id", storeId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (resend && session.url) {
      const storeName = storeSettings.displayName.trim() || "our store";

      await resend.emails.send({
        from: storeSettings.orderFromEmail,
        to: offer.customer_email,
        subject: "Your offer was accepted",
        html: `
          <h2>Offer Accepted</h2>
          <p>Hi ${offer.customer_name || "there"},</p>
          <p>Your offer on <strong>${offer.products.title}</strong> was accepted.</p>
          <p>Accepted price: <strong>$${amount.toFixed(2)}</strong></p>
          <p>Pay securely here:</p>
          <p>
            <a href="${session.url}" style="display:inline-block;padding:12px 18px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
              Pay Now
            </a>
          </p>
          <p>Thank you,<br/>${storeName}</p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      offer: updatedOffer,
      checkoutUrl: session.url,
    });
  } catch (error: any) {
    if (error instanceof InventoryEngineError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to update offer" },
      { status: 500 }
    );
  }
}
