import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../lib/stores";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,created_at,total,status,fulfillment_status,shipping_name,tracking_number,carrier,item_count,contains_seller_items,seller_item_count,store_item_count",
      )
      .eq("store_id", storeId)
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      orders: data ?? [],
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load account orders" },
      { status: 500 },
    );
  }
}
