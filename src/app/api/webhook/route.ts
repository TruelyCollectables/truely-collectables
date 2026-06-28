import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { syncEbayQuantityAfterSale } from "../../../lib/ebay";
import { inventoryEngine } from "../../../modules/inventory";
import { createTransactionEvidenceReport } from "../../../lib/transaction-evidence";
import { getActiveStoreId } from "../../../lib/stores";

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
      return NextResponse.json(
        { error: "Missing webhook environment variables" },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeKey);
    const supabase = createClient(supabaseUrl, supabaseKey);
    const storeId = getActiveStoreId();

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

    if (event.type !== "checkout.session.completed") {
      return NextResponse.json({ received: true });
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const metadata = session.metadata || {};
    const collectedInfo = session.collected_information as any;

    const customerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      "unknown";

    const customerName =
      session.customer_details?.name ||
      collectedInfo?.shipping_details?.name ||
      null;

    const shipping = collectedInfo?.shipping_details?.address;

    const shippingAddressLine1 = shipping?.line1 || null;
    const shippingAddressLine2 = shipping?.line2 || null;
    const shippingCity = shipping?.city || null;
    const shippingState = shipping?.state || null;
    const shippingPostalCode = shipping?.postal_code || null;
    const shippingCountry = shipping?.country || null;

    const total = Number(session.amount_total || 0) / 100;

    const shippingMethod = metadata.shipping_method || null;
    const shippingName = metadata.shipping_name || null;
    const shippingAmount = Number(metadata.shipping_amount || 0);
    const subtotal = Number(metadata.subtotal || total);
    const itemCount = Number(metadata.item_count || 0);
    const tosAccepted = metadata.tos_accepted === "true";
    const tosVersion = metadata.tos_version || null;
    const tosAcceptedAt = metadata.tos_accepted_at || null;
    const tosAcceptanceEventId = metadata.tos_acceptance_event_id || null;
    const tosIpAddress = metadata.tos_ip_address || null;
    const tosUserAgent = metadata.tos_user_agent || null;
    const tosIpRisk = metadata.tos_ip_risk || null;
    const tosIpBlockReason = metadata.tos_ip_block_reason || null;

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

    if (cart.length === 0 && checkoutType === "accepted_offer") {
      const productId = Number(metadata.product_id);

      if (productId) {
        cart = [{ id: productId, quantity: 1 }];
      }
    }

    const { data: existingOrder, error: existingOrderError } = await supabase
      .from("orders")
      .select("id")
      .eq("stripe_session_id", session.id)
      .eq("store_id", storeId)
      .maybeSingle();

    if (existingOrderError) {
      console.error("Existing order lookup failed:", existingOrderError.message);
    }

    let orderId: number;

    const orderPayload = {
      store_id: storeId,
      customer_email: customerEmail,
      customer_name: customerName,
      total,
      status: "paid",
      shipping_method: shippingMethod,
      shipping_name: shippingName,
      shipping_amount: shippingAmount,
      subtotal,
      item_count: itemCount || cart.length,
      fulfillment_status: "ready_to_ship",
      shipping_address_line1: shippingAddressLine1,
      shipping_address_line2: shippingAddressLine2,
      shipping_city: shippingCity,
      shipping_state: shippingState,
      shipping_postal_code: shippingPostalCode,
      shipping_country: shippingCountry,
    };

    const orderPayloadWithTerms = {
      ...orderPayload,
      tos_accepted: tosAccepted,
      tos_version: tosVersion,
      tos_accepted_at: tosAcceptedAt,
      tos_acceptance_event_id: tosAcceptanceEventId,
      tos_ip_address: tosIpAddress,
      tos_user_agent: tosUserAgent,
      tos_ip_risk: tosIpRisk,
      tos_ip_block_reason: tosIpBlockReason,
    };

    if (existingOrder) {
      orderId = existingOrder.id;

      const { error: updateError } = await supabase
        .from("orders")
        .update(orderPayloadWithTerms)
        .eq("id", orderId);

      if (updateError) {
        console.error("Order update failed:", updateError.message);
      }
    } else {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          ...orderPayloadWithTerms,
          stripe_session_id: session.id,
        })
        .select("id")
        .single();

      if (orderError || !order) {
        console.error("Order insert failed:", orderError?.message);
        return NextResponse.json(
          { error: "Order insert failed" },
          { status: 500 }
        );
      }

      orderId = order.id;
    }

    const { data: existingItems } = await supabase
      .from("order_items")
      .select("id")
      .eq("order_id", orderId)
      .eq("store_id", storeId)
      .limit(1);

    if (!existingItems || existingItems.length === 0) {
      for (const cartItem of cart) {
        const productId = Number(
          cartItem.id || cartItem.product_id || cartItem.productId
        );
        const quantityPurchased = Number(cartItem.quantity || cartItem.qty || 1);

        if (!productId || quantityPurchased <= 0) {
          console.error("Invalid cart item:", cartItem);
          continue;
        }

        const product = await inventoryEngine.getByLegacyProductId(productId);

        if (!product) {
          console.error(
            "Product lookup failed:",
            productId
          );
          continue;
        }

        const { error: itemError } = await supabase.from("order_items").insert({
          store_id: storeId,
          order_id: orderId,
          product_id: product.legacyProductId,
          title: product.title,
          price: Number(product.price),
          quantity: quantityPurchased,
        });

        if (itemError) {
          console.error("Order item insert failed:", itemError.message);
          continue;
        }

        const mutation = await inventoryEngine.decrementAfterSale({
          legacyProductId: product.legacyProductId,
          quantity: quantityPurchased,
          source: "stripe-webhook",
        });

        if (!mutation) {
          console.error(
            "Product quantity update failed:",
            product.legacyProductId
          );
          continue;
        }

        try {
          await syncEbayQuantityAfterSale({
            sku: product.sku,
            ebayItemId: product.ebayItemId,
            newQuantity: mutation.newQuantity,
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
        .eq("id", offerId)
        .eq("store_id", storeId);
    }

    try {
      await createTransactionEvidenceReport({
        supabase,
        orderId,
        stripeSession: session,
        stripeEvent: event,
        storeId,
      });
    } catch (reportError: any) {
      console.error(
        "Transaction evidence report failed:",
        reportError.message || reportError,
      );
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("Webhook failed:", error.message);
    return NextResponse.json(
      { error: error.message || "Webhook failed" },
      { status: 500 }
    );
  }
}
