import { NextResponse } from "next/server";
import { isOrderReviewStatus } from "../../../../lib/order-status";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
  type DryRunShippingLabelLike,
} from "../../../../lib/shipping-dry-run";
import { getActiveStoreId } from "../../../../lib/stores";
import { enqueueAndAttemptOrderNotification } from "../../../../lib/order-notifications";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { refreshTransactionEvidenceReportForOrder } from "../../../../lib/transaction-evidence";

export const dynamic = "force-dynamic";

function isMissingShippingInfrastructure(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    message.includes("order_shipping_labels") ||
    message.includes("order_shipping_tracking_events")
  );
}

type ActiveShippingLabel = DryRunShippingLabelLike & {
  id: string;
  label_status: string | null;
};

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

    const body = await req.json();
    const orderId = Number(body.orderId);

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const { data: order, error: lookupError } = await supabase
      .from("orders")
      .select(
        `
        id,
        customer_email,
        customer_name,
        tracking_number,
        carrier,
        status,
        fulfillment_status,
        shipped_at
      `,
      )
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
            "This paid order is on a review hold. Resolve the review status before marking it shipped.",
        },
        { status: 409 },
      );
    }

    if (!order.tracking_number || !order.carrier) {
      return NextResponse.json(
        {
          error:
            "Please save a carrier and tracking number before marking shipped.",
        },
        { status: 400 },
      );
    }

    if (isDryRunShippingReference(order.tracking_number)) {
      return NextResponse.json(
        {
          error:
            "This order has TCOS dry-run tracking. Buy or record a real label before marking it shipped.",
        },
        { status: 409 },
      );
    }

    let activeShippingLabel: ActiveShippingLabel | null = null;

    try {
      const { data: label, error: labelLookupError } = await supabase
        .from("order_shipping_labels")
        .select(
          "id,label_status,metadata,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id",
        )
        .eq("store_id", storeId)
        .eq("order_id", orderId)
        .not("label_status", "in", "(voided,failed)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (labelLookupError && !isMissingShippingInfrastructure(labelLookupError)) {
        throw labelLookupError;
      }

      activeShippingLabel = (label || null) as ActiveShippingLabel | null;
    } catch (labelLookupError: any) {
      if (!isMissingShippingInfrastructure(labelLookupError)) {
        throw labelLookupError;
      }
    }

    if (isDryRunShippingLabel(activeShippingLabel)) {
      return NextResponse.json(
        {
          error:
            "The active shipping label is a TCOS dry-run simulation. Buy or record a real label before marking it shipped.",
        },
        { status: 409 },
      );
    }

    const shippedAt = order.shipped_at || new Date().toISOString();

    const { error } = await supabase
      .from("orders")
      .update({
        fulfillment_status: "shipped",
        shipped_at: shippedAt,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    try {
      if (activeShippingLabel?.id) {
        const { error: labelUpdateError } = await supabase
          .from("order_shipping_labels")
          .update({
            carrier: order.carrier,
            tracking_number: order.tracking_number,
            label_status:
              activeShippingLabel.label_status === "planned"
                ? "printed"
                : activeShippingLabel.label_status,
            printed_at:
              activeShippingLabel.label_status === "planned"
                ? shippedAt
                : undefined,
            updated_at: shippedAt,
          })
          .eq("id", activeShippingLabel.id)
          .eq("store_id", storeId);

        if (labelUpdateError && !isMissingShippingInfrastructure(labelUpdateError)) {
          throw labelUpdateError;
        }
      }

      const { error: eventError } = await supabase
        .from("order_shipping_tracking_events")
        .insert({
          store_id: storeId,
          order_id: orderId,
          shipping_label_id: activeShippingLabel?.id || null,
          provider: "manual",
          carrier: order.carrier,
          tracking_number: order.tracking_number,
          event_type: "order_marked_shipped",
          event_status: "shipped",
          message: "Order marked shipped in TCOS.",
          occurred_at: shippedAt,
          raw_payload: {
            carrier: order.carrier,
            tracking_number: order.tracking_number,
          },
        });

      if (eventError && !isMissingShippingInfrastructure(eventError)) {
        throw eventError;
      }
    } catch (shippingEventError: any) {
      if (!isMissingShippingInfrastructure(shippingEventError)) {
        console.error(
          "Shipping shipment event update failed:",
          shippingEventError.message || shippingEventError,
        );
      }
    }

    try {
      await refreshTransactionEvidenceReportForOrder({
        supabase,
        orderId,
        storeId,
      });
    } catch (reportError: any) {
      console.error(
        "Evidence report refresh after shipment update failed:",
        reportError.message || reportError,
      );
    }

    let notification = null;
    let notificationError: string | null = null;

    try {
      notification = await enqueueAndAttemptOrderNotification({
        supabase,
        storeId,
        orderId,
        notificationType: "shipment_confirmation",
        recipientEmail: order.customer_email,
        recipientName: order.customer_name,
        payload: {
          orderId,
          customerName: order.customer_name,
          carrier: order.carrier,
          trackingNumber: order.tracking_number,
        },
      });
    } catch (error: any) {
      notificationError = error?.message || "Shipment notification failed";
      console.error("Shipment notification failed:", notificationError);
    }

    return NextResponse.json({
      success: true,
      emailSent: notification?.sent === true,
      emailQueued: Boolean(notification),
      notificationId: notification?.notificationId || null,
      notificationStatus: notification?.status || null,
      emailError: notification?.error || notificationError,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Mark shipped failed" },
      { status: 500 },
    );
  }
}
