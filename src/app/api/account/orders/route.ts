import { NextResponse } from "next/server";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import { isDryRunShippingReference } from "../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function accountOrdersHeaders(params: {
  orderCount: number;
  dryRunShippingBlockedCount: number;
  sellerItemOrderCount: number;
}) {
  return {
    "X-TCOS-Account-Orders": String(params.orderCount),
    "X-TCOS-Account-Orders-Dry-Run-Shipping-Blocked": String(
      params.dryRunShippingBlockedCount,
    ),
    "X-TCOS-Account-Orders-Seller-Item": String(params.sellerItemOrderCount),
  };
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

    const orders = (data ?? []).map((order) => {
      const dryRunShipping = isDryRunShippingReference(order.tracking_number);

      return {
        ...order,
        tracking_number: dryRunShipping ? null : order.tracking_number,
        carrier: dryRunShipping ? null : order.carrier,
        dry_run_shipping_blocked: dryRunShipping,
      };
    });
    const dryRunShippingBlockedCount = orders.filter(
      (order) => order.dry_run_shipping_blocked,
    ).length;
    const sellerItemOrderCount = orders.filter(
      (order) => order.contains_seller_items || Number(order.seller_item_count || 0) > 0,
    ).length;

    return NextResponse.json(
      {
        success: true,
        orders,
      },
      {
        headers: accountOrdersHeaders({
          orderCount: orders.length,
          dryRunShippingBlockedCount,
          sellerItemOrderCount,
        }),
      },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load account orders" },
      { status: 500 },
    );
  }
}
