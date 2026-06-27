import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();

    const orderId = Number(body.orderId);
    const carrier = String(body.carrier || "").trim();
    const trackingNumber = String(body.trackingNumber || "").trim();

    if (!orderId || !carrier || !trackingNumber) {
      return NextResponse.json(
        { error: "Missing orderId, carrier, or trackingNumber" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("orders")
      .update({
        carrier,
        tracking_number: trackingNumber,
      })
      .eq("id", orderId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Tracking update failed" },
      { status: 500 }
    );
  }
}