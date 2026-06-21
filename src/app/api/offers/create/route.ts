import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { productId, name, email, offerAmount } = body;

    const { data: offer, error } = await supabase
      .from("offers")
      .insert([
        {
          product_id: productId,
          customer_name: name,
          customer_email: email,
          offer_amount: offerAmount,
        },
      ])
      .select("*, products(title, price)")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (resendApiKey) {
      const resend = new Resend(resendApiKey);

      await resend.emails.send({
        from: "Truely Collectables Offers <offers@truelycollectables.com>",
        to: "sales@truelycollectables.com",
        subject: "New Best Offer Received",
        html: `
          <h2>New Best Offer Received</h2>

          <p><strong>Product:</strong> ${offer.products?.title || "Unknown product"}</p>
          <p><strong>Asking Price:</strong> $${Number(offer.products?.price || 0).toFixed(2)}</p>
          <p><strong>Offer Amount:</strong> $${Number(offer.offer_amount).toFixed(2)}</p>

          <hr />

          <p><strong>Customer Name:</strong> ${offer.customer_name}</p>
          <p><strong>Customer Email:</strong> ${offer.customer_email}</p>

          <p>
            <a href="https://truely-collectables-tt3b.vercel.app/admin/offers">
              Review this offer
            </a>
          </p>
        `,
      });
    }

    return NextResponse.json({
      success: true,
      offer,
    });
  } catch (err) {
    console.error("Offer create error:", err);

    return NextResponse.json(
      { error: "Failed to create offer" },
      { status: 500 }
    );
  }
}