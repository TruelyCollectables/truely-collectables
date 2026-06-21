import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    if (!stripeKey) {
      return NextResponse.json(
        { error: "Missing Stripe secret key" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const stripe = new Stripe(stripeKey);
    const resend = resendKey ? new Resend(resendKey) : null;

    const { offerId, status } = await req.json();

    if (!offerId || !status) {
      return NextResponse.json(
        { error: "Missing offerId or status" },
        { status: 400 }
      );
    }

    if (!["accepted", "declined"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select("*, products(id, title, image_url, price, quantity, ebay_item_id)")
      .eq("id", offerId)
      .single();

    if (offerError || !offer) {
      return NextResponse.json(
        { error: offerError?.message || "Offer not found" },
        { status: 404 }
      );
    }

    if (offer.status !== "pending") {
      return NextResponse.json(
        { error: "This offer is no longer pending" },
        { status: 400 }
      );
    }

    if (status === "declined") {
      const { data, error } = await supabase
        .from("offers")
        .update({
          status: "declined",
          updated_at: new Date().toISOString(),
        })
        .eq("id", offerId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, offer: data });
    }

    if (!offer.products) {
      return NextResponse.json(
        { error: "Product not found for this offer" },
        { status: 404 }
      );
    }

    if (Number(offer.products.quantity) <= 0) {
      return NextResponse.json(
        { error: "Product is already sold out" },
        { status: 400 }
      );
    }

    const origin =
      req.headers.get("origin") ||
      "https://truely-collectables-tt3b.vercel.app";

    const amount = Number(offer.offer_amount);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: offer.customer_email,
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
        offer_id: offer.id,
        product_id: offer.products.id,
        ebay_item_id: offer.products.ebay_item_id || "",
        type: "accepted_offer",
      },
      success_url: `${origin}/shop?offer_success=true`,
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
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (resend && session.url) {
      await resend.emails.send({
        from: "Truely Collectables <sales@truelycollectables.com>",
        to: offer.customer_email,
        subject: "Your offer was accepted!",
        html: `
          <h2>Your offer was accepted!</h2>
          <p>Hi ${offer.customer_name || "there"},</p>
          <p>Good news — your offer of <strong>$${amount.toFixed(
            2
          )}</strong> for <strong>${offer.products.title}</strong> was accepted.</p>
          <p>You can pay securely here:</p>
          <p>
            <a href="${session.url}" style="display:inline-block;padding:12px 18px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
              Pay Now
            </a>
          </p>
          <p>Thank you,<br/>Truely Collectables</p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      offer: updatedOffer,
      checkoutUrl: session.url,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update offer" },
      { status: 500 }
    );
  }
}