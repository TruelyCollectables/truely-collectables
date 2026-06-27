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

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing orderId" },
        { status: 400 }
      );
    }

    const { data: order, error: lookupError } = await supabase
      .from("orders")
      .select("tracking_number, carrier")
      .eq("id", orderId)
      .single();

    if (lookupError || !order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    if (!order.tracking_number || !order.carrier) {
      return NextResponse.json(
        {
          error: "Please save a carrier and tracking number before marking shipped.",
        },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("orders")
      .update({
        fulfillment_status: "shipped",
        shipped_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || "Mark shipped failed",
      },
      {
        status: 500,
      }
    );
  }
}