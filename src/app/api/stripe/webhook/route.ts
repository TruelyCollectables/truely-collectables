import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const resendKey = process.env.RESEND_API_KEY;

    if (!stripeKey || !webhookSecret || !supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Missing webhook environment variables" },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeKey);
    const supabase = createClient(supabaseUrl, supabaseKey);
    const resend = resendKey ? new Resend(resendKey) : null;

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing Stripe signature" },
        { status: 400 }
      );
    }

    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const offerId = session.metadata?.offer_id;
      const productId = session.metadata?.product_id;
      const type = session.metadata?.type;

      if (type === "accepted_offer" && offerId && productId) {
        const { data: offer, error: offerLookupError } = await supabase
          .from("offers")
          .select("*, products(id, title, image_url, price)")
          .eq("id", offerId)
          .single();

        if (offerLookupError || !offer) {
          return NextResponse.json(
            { error: offerLookupError?.message || "Offer not found" },
            { status: 500 }
          );
        }

        const { error: offerUpdateError } = await supabase
          .from("offers")
          .update({
            payment_status: "paid",
            stripe_session_id: session.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", offerId);

        if (offerUpdateError) {
          return NextResponse.json(
            { error: offerUpdateError.message },
            { status: 500 }
          );
        }

        const { error: productUpdateError } = await supabase
          .from("products")
          .update({
            quantity: 0,
          })
          .eq("id", Number(productId));

        if (productUpdateError) {
          return NextResponse.json(
            { error: productUpdateError.message },
            { status: 500 }
          );
        }

        const amountPaid = ((session.amount_total || 0) / 100).toFixed(2);
        const customerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          offer.customer_email;

        const customerName =
          session.customer_details?.name ||
          offer.customer_name ||
          "there";

        const productTitle =
          offer.products?.title || "your sports card";

        const receiptUrl =
          typeof session.payment_intent === "string"
            ? ""
            : "";

        if (resend && customerEmail) {
          await resend.emails.send({
            from: "Truely Collectables <sales@truelycollectables.com>",
            to: customerEmail,
            subject: "Payment received - Truely Collectables",
            html: `
              <h2>Payment received</h2>
              <p>Hi ${customerName},</p>
              <p>Thank you for your payment. Your accepted offer purchase is confirmed.</p>

              <p><strong>Item:</strong> ${productTitle}</p>
              <p><strong>Amount paid:</strong> $${amountPaid}</p>

              <p>We will prepare your order and follow up with shipping details.</p>

              <p>Thank you,<br/>Truely Collectables</p>
            `,
          });

          await resend.emails.send({
            from: "Truely Collectables <sales@truelycollectables.com>",
            to: "sales@truelycollectables.com",
            subject: "Accepted offer paid",
            html: `
              <h2>Accepted offer paid</h2>
              <p>A customer completed payment for an accepted offer.</p>

              <p><strong>Customer:</strong> ${customerName}</p>
              <p><strong>Email:</strong> ${customerEmail}</p>
              <p><strong>Item:</strong> ${productTitle}</p>
              <p><strong>Amount paid:</strong> $${amountPaid}</p>
              <p><strong>Offer ID:</strong> ${offerId}</p>
              <p><strong>Product ID:</strong> ${productId}</p>
              <p><strong>Stripe Session:</strong> ${session.id}</p>
            `,
          });
        }
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("Webhook error:", error);

    return NextResponse.json(
      { error: error.message || "Webhook failed" },
      { status: 500 }
    );
  }
}