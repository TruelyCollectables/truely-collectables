import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshTransactionEvidenceReportForOrder } from "../../../../lib/transaction-evidence";
import { getStoreSettings } from "../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../lib/stores";

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
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);

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
      .select(
        `
        id,
        customer_email,
        customer_name,
        tracking_number,
        carrier,
        fulfillment_status
      `
      )
      .eq("id", orderId)
      .eq("store_id", storeId)
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
          error:
            "Please save a carrier and tracking number before marking shipped.",
        },
        { status: 400 }
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
      await refreshTransactionEvidenceReportForOrder({
        supabase,
        orderId,
        storeId,
      });
    } catch (reportError: any) {
      console.error(
        "Evidence report refresh after shipment update failed:",
        reportError.message || reportError
      );
    }

    let emailSent = false;
    let emailError: string | null = null;

    if (resendApiKey && order.customer_email) {
      const trackUrl = trackingUrl(order.carrier, order.tracking_number);

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
          <h1>Your Truely Collectables order has shipped!</h1>

          <p>Hi ${order.customer_name || "there"},</p>

          <p>Great news — your order #${order.id} has shipped.</p>

          <p>
            <strong>Carrier:</strong> ${order.carrier}<br />
            <strong>Tracking Number:</strong> ${order.tracking_number}
          </p>

          ${
            trackUrl
              ? `<p><a href="${trackUrl}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;">Track Your Package</a></p>`
              : `<p>You can use your tracking number on the carrier's website to follow your package.</p>`
          }

          <p>Thank you for shopping with Truely Collectables!</p>

          <p>— Truely Collectables</p>
        </div>
      `;

      const text = `
Your Truely Collectables order has shipped!

Hi ${order.customer_name || "there"},

Great news — your order #${order.id} has shipped.

Carrier: ${order.carrier}
Tracking Number: ${order.tracking_number}

${trackUrl ? `Track your package: ${trackUrl}` : "You can use your tracking number on the carrier's website to follow your package."}

Thank you for shopping with Truely Collectables!

— Truely Collectables
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
            subject: `Your ${storeSettings.displayName} order #${order.id} has shipped!`,
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
      {
        error: error.message || "Mark shipped failed",
      },
      {
        status: 500,
      }
    );
  }
}
