import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { syncEbayQuantityAfterSale } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!supabaseUrl || !supabaseKey || !stripeKey || !webhookSecret) {
      return NextResponse.json(
        { error: "Missing webhook environment variables" },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeKey);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing Stripe signature" },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      return NextResponse.json(
        { error: `Webhook signature failed: ${err.message}` },
        { status: 400 }
      );
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const productId = session.metadata?.product_id;
      const offerId = session.metadata?.offer_id;
      const checkoutType = session.metadata?.type || "buy_now";

      const customerEmail =
        session.customer_details?.email ||
        session.customer_email ||
        "unknown";

      const total = Number(session.amount_total || 0) / 100;

      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();

      if (!existingOrder) {
        await supabase.from("orders").insert({
          customer_email: customerEmail,
          total,
          status: "paid",
          stripe_session_id: session.id,
        });
      }

      if (productId) {
        const { data: product, error: productError } = await supabase
          .from("products")
          .select("id, quantity, sku, ebay_item_id")
          .eq("id", productId)
          .single();

        if (!productError && product && Number(product.quantity) > 0) {
          const newQuantity = Number(product.quantity) - 1;

          await supabase
            .from("products")
            .update({
              quantity: newQuantity,
            })
            .eq("id", productId);

          try {
            await syncEbayQuantityAfterSale({
              sku: product.sku,
              ebayItemId: product.ebay_item_id,
              newQuantity,
            });
          } catch (ebayError: any) {
            console.error("eBay sync after sale failed:", ebayError.message);
          }
        }
      }

      if (checkoutType === "accepted_offer" && offerId) {
        await supabase
          .from("offers")
          .update({
            status: "paid",
            updated_at: new Date().toISOString(),
          })
          .eq("id", offerId);
      }
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Webhook failed" },
      { status: 500 }
    );
  }
}