import Stripe from "stripe";
import { supabase } from "../../lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  if (session_id) {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const cart = session.metadata?.cart
      ? JSON.parse(session.metadata.cart)
      : [];

    const total = cart.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );

    const { data: order } = await supabase
      .from("orders")
      .insert({
        customer_email: session.customer_details?.email,
        total,
        stripe_session_id: session.id,
        status: "paid",
      })
      .select()
      .single();

    if (order) {
      await supabase.from("order_items").insert(
        cart.map((item: any) => ({
          order_id: order.id,
          product_id: item.id,
          title: item.title,
          quantity: item.quantity,
          price: item.price,
        }))
      );

      for (const item of cart) {
        const { data: product } = await supabase
          .from("products")
          .select("quantity")
          .eq("id", item.id)
          .single();

        if (product) {
          const { error: updateError } = await supabase
  .from("products")
  .update({
    quantity: product.quantity - item.quantity,
  })
  .eq("id", item.id);

if (updateError) {
  throw new Error(updateError.message);
}
        }
      }
    }
  }

  return (
    <main className="p-8 text-center">
      <h1 className="text-5xl font-bold">
        Payment Successful
      </h1>

      <p className="mt-4">
        Thank you for your order.
      </p>

      <a
        href="/shop"
        className="inline-block mt-8 border rounded px-6 py-3"
      >
        Continue Shopping
      </a>
    </main>
  );
}