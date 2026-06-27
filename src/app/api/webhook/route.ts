import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { syncEbayQuantityAfterSale } from "../../../lib/ebay";

export const dynamic = "force-dynamic";

type CartItem = {
  id?: number;
  product_id?: number;
  productId?: number;
  quantity?: number;
  qty?: number;
};

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!supabaseUrl || !supabaseKey || !stripeKey || !webhookSecret) {
      return NextResponse.json({ error: "Missing webhook environment variables" }, { status: 500 });
    }

    const stripe = new Stripe(stripeKey);
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      return NextResponse.json({ error: `Webhook signature failed: ${err.message}` }, { status: 400 });
    }

    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata || {};

    console.log("Stripe session metadata:", metadata);

    const customerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      "unknown";

    const total = Number(session.amount_total || 0) / 100;

    const shippingMethod = metadata.shipping_method || null;
    const shippingName = metadata.shipping_name || null;
    const shippingAmount = Number(metadata.shipping_amount || 0);
    const subtotal = Number(metadata.subtotal || total);
    const itemCount = Number(metadata.item_count || 0);

    const offerId = metadata.offer_id;
    const checkoutType = metadata.type || "cart";

    let cart: CartItem[] = [];

    try {
      const parsed = JSON.parse(metadata.cart || "[]");
      cart = Array.isArray(parsed) ? parsed : parsed.items || [];
    } catch (err: any) {
      console.error("Cart metadata parse failed:", err.message);
      cart = [];
    }

    console.log("Parsed cart:", cart);

    const { data: existingOrder, error: existingOrderError } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_session_id", session.id)
      .maybeSingle();

    if (existingOrderError) {
      console.error("Existing order lookup failed:", existingOrderError.message);
    }

    let orderId: number;

    if (existingOrder) {
      orderId = existingOrder.id;

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          customer_email: customerEmail,
          total,
          status: "paid",
          shipping_method: shippingMethod,
          shipping_name: shippingName,
          shipping_amount: shippingAmount,
          subtotal,
          item_count: itemCount || cart.length,
          fulfillment_status: "ready_to_ship",
        })
        .eq("id", orderId);

      if (updateError) {
        console.error("Order update failed:", updateError.message);
      }
    } else {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          customer_email: customerEmail,
          total,
          status: "paid",
          stripe_session_id: session.id,
          shipping_method: shippingMethod,
          shipping_name: shippingName,
          shipping_amount: shippingAmount,
          subtotal,
          item_count: itemCount || cart.length,
          fulfillment_status: "ready_to_ship",
        })
        .select("id")
        .single();

      if (orderError || !order) {
        console.error("Order insert failed:", orderError?.message);
        return NextResponse.json({ error: "Order insert failed" }, { status: 500 });
      }

      orderId = order.id;
    }

    const { data: existingItems } = await supabase
      .from("order_items")
      .select("id")
      .eq("order_id", orderId)
      .limit(1);

    if (!existingItems || existingItems.length === 0) {
      for (const cartItem of cart) {
        const productId = Number(cartItem.id || cartItem.product_id || cartItem.productId);
        const quantityPurchased = Number(cartItem.quantity || cartItem.qty || 1);

        if (!productId || quantityPurchased <= 0) {
          console.error("Invalid cart item:", cartItem);
          continue;
        }

        const { data: product, error: productError } = await supabase
          .from("products")
          .select("id, title, price, quantity, ebay_item_id")
          .eq("id", productId)
          .single();

        if (productError || !product) {
          console.error("Product lookup failed:", productId, productError?.message);
          continue;
        }

        const { error: itemError } = await supabase.from("order_items").insert({
          order_id: orderId,
          product_id: product.id,
          title: product.title,
          price: Number(product.price),
          quantity: quantityPurchased,
        });

        if (itemError) {
          console.error("Order item insert failed:", itemError.message);
          continue;
        }

        const newQuantity = Math.max(Number(product.quantity || 0) - quantityPurchased, 0);

        const { error: productUpdateError } = await supabase
          .from("products")
          .update({ quantity: newQuantity })
          .eq("id", product.id);

        if (productUpdateError) {
          console.error("Product quantity update failed:", productUpdateError.message);
          continue;
        }

        try {
          await syncEbayQuantityAfterSale({
            sku: String(product.id),
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

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("Webhook failed:", error.message);
    return NextResponse.json({ error: error.message || "Webhook failed" }, { status: 500 });
  }
}