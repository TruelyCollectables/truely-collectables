import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const stripe = new Stripe(
      process.env.STRIPE_SECRET_KEY || "sk_test_placeholder"
    );

    const formData = await request.formData();
    const productId = formData.get("productId") as string;

    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    if (error || !product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    if (product.quantity <= 0) {
      return NextResponse.json({ error: "Product sold out" }, { status: 400 });
    }

    const origin =
      request.headers.get("origin") ||
      "https://truely-collectables-tt3b.vercel.app";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.title,
              images: product.image_url ? [product.image_url] : [],
            },
            unit_amount: Math.round(Number(product.price) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        product_id: product.id,
        ebay_item_id: product.ebay_item_id || "",
      },
      success_url: `${origin}/shop?success=true`,
      cancel_url: `${origin}/product/${product.id}`,
    });

    return NextResponse.redirect(session.url!, 303);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Checkout failed" },
      { status: 500 }
    );
  }
}