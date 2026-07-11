import { NextResponse } from "next/server";
import {
  isDryRunShippingLabel,
  isDryRunShippingReference,
  type DryRunShippingLabelLike,
} from "../../../../lib/shipping-dry-run";
import { refreshTransactionEvidenceReportForOrder } from "../../../../lib/transaction-evidence";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

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
};

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();

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

    if (isDryRunShippingReference(trackingNumber)) {
      return NextResponse.json(
        {
          error:
            "TCOS dry-run tracking cannot be saved manually. Buy or record a real label before saving tracking.",
        },
        { status: 409 },
      );
    }

    let activeShippingLabel: ActiveShippingLabel | null = null;

    try {
      const { data: label, error: labelLookupError } = await supabase
        .from("order_shipping_labels")
        .select(
          "id,metadata,provider_label_id,provider_shipment_id,tracking_number,coverage_policy_id",
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
            "The active shipping label is a TCOS dry-run simulation. Record a real external label before saving tracking.",
        },
        { status: 409 },
      );
    }

    const { error } = await supabase
      .from("orders")
      .update({
        carrier,
        tracking_number: trackingNumber,
      })
      .eq("id", orderId)
      .eq("store_id", storeId);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    try {
      const now = new Date().toISOString();
      const label = activeShippingLabel;

      if (label?.id) {
        const { error: labelUpdateError } = await supabase
          .from("order_shipping_labels")
          .update({
            carrier,
            tracking_number: trackingNumber,
            updated_at: now,
          })
          .eq("id", label.id)
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
          shipping_label_id: label?.id || null,
          provider: "manual",
          carrier,
          tracking_number: trackingNumber,
          event_type: "tracking_saved",
          event_status: "tracking_saved",
          message: "Carrier and tracking number saved in TCOS.",
          occurred_at: now,
          raw_payload: { carrier, tracking_number: trackingNumber },
        });

      if (eventError && !isMissingShippingInfrastructure(eventError)) {
        throw eventError;
      }
    } catch (shippingEventError: any) {
      if (!isMissingShippingInfrastructure(shippingEventError)) {
        console.error(
          "Shipping tracking event update failed:",
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
        "Evidence report refresh after tracking update failed:",
        reportError.message || reportError
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
