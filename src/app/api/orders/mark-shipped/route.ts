import { NextResponse } from "next/server";
import { isOrderReviewStatus } from "../../../../lib/order-status";
import { getStoreSettings } from "../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { refreshTransactionEvidenceReportForOrder } from "../../../../lib/transaction-evidence";

export const dynamic = "force-dynamic";

function trackingUrl(carrier: string, trackingNumber: string) {
  const encoded = encodeURIComponent(trackingNumber);

  if (carrier === "USPS") {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  }

  if (carrier === "UPS") {
    return `https://www.ups.com/track?tracknum=${encoded}`;
  }

  if (carrier === "FedEx") {
    return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  }

  return "";
}

function storeName(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "our store";
}

function isMissingShippingInfrastructure(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    message.includes("order_shipping_labels") ||
    message.includes("order_shipping_tracking_events")
  );
}

type ActiveShippingLabel = {
  id: string;
  label_status: string | null;
  metadata?: Record<string, unknown> | null;
  provider_label_id?: string | null;
  provider_shipment_id?: string | null;
  tracking_number?: string | null;
  coverage_policy_id?: string | null;
};

function metadataRecord(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nestedRecord(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isDryRunTracking(value: string | null | undefined) {
  return Boolean(value?.includes("TCOS-DRYRUN"));
}

function isDryRunLabel(label: ActiveShippingLabel | null | undefined) {
  if (!label) return false;

  const latestAttempt = metadataRecord(label.metadata, "latest_purchase_attempt");
  const purchaseResult = nestedRecord(latestAttempt, "purchase_result");
  const providerPayload = nestedRecord(purchaseResult, "rawProviderPayload");

  return (
    latestAttempt?.status === "dry_run_purchased" ||
    purchaseResult?.mode === "dry_run" ||
    providerPayload?.dry_run === true ||
    label.provider_label_id?.startsWith("dryrun-") ||
    label.provider_shipment_id?.startsWith("dryrun-") ||
    label.coverage_policy_id?.startsWith("dryrun-") ||
    isDryRunTracking(label.tracking_number)
  );
}

export async function POST(req: Request) {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);
    const activeStoreName = storeName(storeSettings.displayName);

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
        fulfillment_status
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

    if (isDryRunTracking(order.tracking_number)) {
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

    if (isDryRunLabel(activeShippingLabel)) {
      return NextResponse.json(
        {
          error:
            "The active shipping label is a TCOS dry-run simulation. Buy or record a real label before marking it shipped.",
        },
        { status: 409 },
      );
    }

    const shippedAt = new Date().toISOString();

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

    let emailSent = false;
    let emailError: string | null = null;

    if (resendApiKey && order.customer_email) {
      const trackUrl = trackingUrl(order.carrier, order.tracking_number);

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
          <h1>Your ${activeStoreName} order has shipped!</h1>

          <p>Hi ${order.customer_name || "there"},</p>

          <p>Great news - your order #${order.id} has shipped.</p>

          <p>
            <strong>Carrier:</strong> ${order.carrier}<br />
            <strong>Tracking Number:</strong> ${order.tracking_number}
          </p>

          ${
            trackUrl
              ? `<p><a href="${trackUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;">Track Your Package</a></p>`
              : `<p>You can use your tracking number on the carrier's website to follow your package.</p>`
          }

          <p>Thank you for shopping with ${activeStoreName}!</p>

          <p>- ${activeStoreName}</p>
        </div>
      `;

      const text = `
Your ${activeStoreName} order has shipped!

Hi ${order.customer_name || "there"},

Great news - your order #${order.id} has shipped.

Carrier: ${order.carrier}
Tracking Number: ${order.tracking_number}

${trackUrl ? `Track your package: ${trackUrl}` : "You can use your tracking number on the carrier's website to follow your package."}

Thank you for shopping with ${activeStoreName}!

- ${activeStoreName}
      `.trim();

      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: storeSettings.orderFromEmail,
            to: order.customer_email,
            subject: `Your ${activeStoreName} order #${order.id} has shipped!`,
            html,
            text,
          }),
        });

        const emailData = await emailRes.json().catch(() => ({}));

        if (!emailRes.ok) {
          emailError = JSON.stringify(emailData);
          console.error("Shipment email failed:", emailData);
        } else {
          emailSent = true;
        }
      } catch (err: any) {
        emailError = err.message || "Shipment email failed";
        console.error("Shipment email failed:", emailError);
      }
    }

    return NextResponse.json({
      success: true,
      emailSent,
      emailError,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Mark shipped failed" },
      { status: 500 },
    );
  }
}
