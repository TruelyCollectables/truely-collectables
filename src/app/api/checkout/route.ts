import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "../../../lib/supabase";
import {
  calculateShipping,
  SHIPPING_RULES,
  type ShippingMethod,
} from "../../../lib/shipping";

export const dynamic = "force-dynamic";

type CartItem = {
  id: number;
  quantity: number;
};

export async function POST(request: Request) {
  try {
    const stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY || "sk_test_placeholder"
    );

    const body = await request.json();

    const cart = body.cart as CartItem[];
    const shippingMethod = body.shippingMethod as ShippingMethod;

    if (!cart || cart.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    if (
      shippingMethod !== "GROUND_ADVANTAGE" &&
      shippingMethod !== "PRIORITY_MAIL"
    ) {
      return NextResponse.json(
        { error: "Invalid shipping method" },
        { status: 400 }
      );
    }

    const productIds = cart.map((item) => item.id);

    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .in("id", productIds);

    if (error || !products) {
      return NextResponse.json(
        { error: "Products not found" },
        { status: 404 }
      );
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    let subtotal = 0;
    let itemCount = 0;

    for (const cartItem of cart) {
      const product = products.find((p) => p.id === cartItem.id);

      if (!product) {
        return NextResponse.json(
          { error: `Product ${cartItem.id} not found` },
          { status: 404 }
        );
      }

      if (product.quantity < cartItem.quantity) {
        return NextResponse.json(
          { error: `${product.title} does not have enough inventory` },
          { status: 400 }
        );
      }

      const price = Number(product.price);

      subtotal += price * cartItem.quantity;
      itemCount += cartItem.quantity;

      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: product.title,
            images: product.image_url ? [product.image_url] : [],
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: cartItem.quantity,
      });
    }

    const shippingAmount = calculateShipping({
      itemCount,
      subtotal,
      method: shippingMethod,
    });

    const shippingRule = SHIPPING_RULES[shippingMethod];
    const shippingName = shippingRule.name;

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name:
            shippingAmount === 0
              ? `${shippingName} - FREE`
              : shippingName,
        },
        unit_amount: Math.round(shippingAmount * 100),
      },
      quantity: 1,
    });

    const origin =
      request.headers.get("origin") ||
      "https://truely-collectables.vercel.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      metadata: {
        cart: JSON.stringify(cart),
        shipping_method: shippingMethod,
        shipping_name: shippingName,
        shipping_amount: shippingAmount.toFixed(2),
        subtotal: subtotal.toFixed(2),
        item_count: String(itemCount),
      },
      success_url: `${origin}/shop?success=true`,
      cancel_url: `${origin}/cart`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Checkout failed" },
      { status: 500 }
    );
  }
}