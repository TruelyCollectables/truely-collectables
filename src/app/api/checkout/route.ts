import Stripe from "stripe";
import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  try {
    const cart = await request.json();

    for (const item of cart) {
      const { data: product } = await supabase
        .from("products")
        .select("quantity")
        .eq("id", item.id)
        .single();

      if (product) {
        await supabase
          .from("products")
          .update({
            quantity: product.quantity - item.quantity,
          })
          .eq("id", item.id);
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],

      line_items: cart.map((item: any) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.title,
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity,
      })),

      mode: "payment",

      metadata: {
        cart: JSON.stringify(cart),
      },

      success_url:
        "http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}",

      cancel_url: "http://localhost:3000/cart",
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Checkout failed" },
      { status: 500 }
    );
  }
}