import Stripe from "stripe";
import { NextResponse } from "next/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  try {
    const cart = await request.json();

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

      success_url: "http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}",

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