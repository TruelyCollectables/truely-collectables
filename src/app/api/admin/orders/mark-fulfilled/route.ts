import { NextResponse } from "next/server";
import { isOrderReviewStatus } from "../../../../../lib/order-status";
import { buildOrderNotificationPayload } from "../../../../../lib/order-notification-payload";
import { enqueueAndAttemptOrderNotification } from "../../../../../lib/order-notifications";
import { getStoreSettings } from "../../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const body = await req.json().catch(() => ({}));
    const orderId = Number(body.orderId);

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const { data: order, error: lookupError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("store_id", storeId)
      .single();

    if (lookupError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (isOrderReviewStatus(order.status, order.fulfillment_status)) {
      return NextResponse.json(
        {
          error:
            "This paid order is on a review hold. Resolve the review status before marking it fulfilled.",
        },
        { status: 409 },
      );
    }

    if (order.shipped_at || order.fulfillment_status === "shipped") {
      return NextResponse.json(
        { error: "This order is already marked shipped." },
        { status: 409 },
      );
    }

    const fulfilledAt = order.fulfilled_at || new Date().toISOString();
    const { error: updateError } = await supabase
      .from("orders")
      .update({
        fulfillment_status: "fulfilled",
        fulfilled_at: fulfilledAt,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { data: orderItems, error: itemError } = await supabase
      .from("order_items")
      .select("title,quantity,price")
      .eq("order_id", orderId)
      .eq("store_id", storeId)
      .order("id", { ascending: true });
    if (itemError) throw itemError;

    const items = (orderItems || []).map((item) => ({
      title: String(item.title || "Item"),
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
    }));
    const updatedOrder = {
      ...order,
      fulfillment_status: "fulfilled",
      fulfilled_at: fulfilledAt,
    };
    const settings = await getStoreSettings(supabase, storeId);
    const baseSiteUrl = String(
      process.env.NEXT_PUBLIC_SITE_URL || "https://truelycollectables.com",
    ).replace(/\/+$/, "");

    const customerPayload = buildOrderNotificationPayload({
      order: updatedOrder,
      items,
      audience: "customer",
      fulfilledAt,
    });
    const ownerPayload = buildOrderNotificationPayload({
      order: updatedOrder,
      items,
      audience: "store",
      fulfilledAt,
      adminOrderUrl: `${baseSiteUrl}/admin/orders/${orderId}`,
    });

    const customerNotification = await enqueueAndAttemptOrderNotification({
      supabase,
      storeId,
      orderId,
      notificationType: "fulfillment_confirmation",
      recipientEmail: order.customer_email,
      recipientName: order.customer_name,
      payload: customerPayload,
    });
    const ownerNotification = await enqueueAndAttemptOrderNotification({
      supabase,
      storeId,
      orderId,
      notificationType: "fulfillment_confirmation",
      recipientEmail: settings.salesEmail,
      recipientName: "Fulfillment",
      idempotencyKey: `store_order_fulfilled/${storeId}/${orderId}`,
      payload: ownerPayload,
    });

    return NextResponse.json({
      success: true,
      fulfillmentStatus: "fulfilled",
      fulfilledAt,
      customerEmailSent: customerNotification?.sent === true,
      customerNotificationStatus: customerNotification?.status || null,
      ownerEmailSent: ownerNotification?.sent === true,
      ownerNotificationStatus: ownerNotification?.status || null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Mark fulfilled failed" },
      { status: 500 },
    );
  }
}
