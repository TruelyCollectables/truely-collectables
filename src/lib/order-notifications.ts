import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoreSettings } from "./store-settings";

export type OrderNotificationType =
  | "payment_confirmation"
  | "shipment_confirmation"
  | "tracking_updated";

export type OrderNotificationItem = {
  title: string;
  quantity: number;
  price: number;
};

export type OrderNotificationPayload = {
  orderId: number;
  customerName?: string | null;
  total?: number | null;
  subtotal?: number | null;
  shippingAmount?: number | null;
  shippingName?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  items?: OrderNotificationItem[];
};

type OrderNotificationRow = {
  id: string;
  store_id: string;
  order_id: number;
  notification_type: OrderNotificationType;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  payload: OrderNotificationPayload;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  idempotency_key: string;
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
};

export type OrderNotificationDeliveryResult = {
  notificationId: string;
  status: OrderNotificationRow["status"];
  sent: boolean;
  providerMessageId: string | null;
  error: string | null;
};

function cleanInline(value: unknown, fallback = "") {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

export function escapeOrderNotificationHtml(value: unknown) {
  return cleanInline(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: unknown) {
  const parsed = Number(value ?? 0);
  return `$${(Number.isFinite(parsed) ? parsed : 0).toFixed(2)}`;
}

function trackingUrl(carrierValue: unknown, trackingValue: unknown) {
  const carrier = cleanInline(carrierValue).toUpperCase();
  const trackingNumber = cleanInline(trackingValue);
  if (!trackingNumber) return "";
  const encoded = encodeURIComponent(trackingNumber);

  if (carrier === "USPS") {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  }
  if (carrier === "UPS") {
    return `https://www.ups.com/track?tracknum=${encoded}`;
  }
  if (carrier === "FEDEX") {
    return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  }
  return "";
}

function stableTrackingFingerprint(carrier: string, trackingNumber: string) {
  return createHash("sha256")
    .update(`${cleanInline(carrier).toUpperCase()}\n${cleanInline(trackingNumber)}`)
    .digest("hex")
    .slice(0, 24);
}

export function orderNotificationIdempotencyKey(params: {
  storeId: string;
  orderId: number;
  notificationType: OrderNotificationType;
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const base = `${params.notificationType}/${params.storeId}/${params.orderId}`;
  if (params.notificationType !== "tracking_updated") return base;

  return `${base}/${stableTrackingFingerprint(
    params.carrier || "",
    params.trackingNumber || "",
  )}`;
}

function subjectForNotification(
  type: OrderNotificationType,
  storeName: string,
  orderId: number,
) {
  if (type === "payment_confirmation") {
    return `We received your ${storeName} order #${orderId}`;
  }
  if (type === "tracking_updated") {
    return `Tracking updated for ${storeName} order #${orderId}`;
  }
  return `Your ${storeName} order #${orderId} has shipped`;
}

function itemRows(items: OrderNotificationItem[]) {
  return items
    .slice(0, 100)
    .map((item) => {
      const title = escapeOrderNotificationHtml(item.title || "Item");
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">${title}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center;">${quantity}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${money(item.price)}</td></tr>`;
    })
    .join("");
}

function textItemRows(items: OrderNotificationItem[]) {
  return items
    .slice(0, 100)
    .map((item) => {
      const title = cleanInline(item.title, "Item");
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
      return `- ${title} x${quantity} — ${money(item.price)}`;
    })
    .join("\n");
}

function renderOrderNotification(params: {
  row: OrderNotificationRow;
  storeName: string;
}) {
  const { row } = params;
  const payload = row.payload || ({ orderId: row.order_id } as OrderNotificationPayload);
  const orderId = Number(payload.orderId || row.order_id);
  const name = cleanInline(payload.customerName || row.recipient_name, "there");
  const safeName = escapeOrderNotificationHtml(name);
  const safeStore = escapeOrderNotificationHtml(params.storeName);
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (row.notification_type === "payment_confirmation") {
    const htmlItems = items.length
      ? `<table style="width:100%;border-collapse:collapse;margin:18px 0;"><thead><tr><th style="text-align:left;padding-bottom:8px;">Item</th><th style="text-align:center;padding-bottom:8px;">Qty</th><th style="text-align:right;padding-bottom:8px;">Price</th></tr></thead><tbody>${itemRows(items)}</tbody></table>`
      : "";
    const textItems = items.length ? `\nItems:\n${textItemRows(items)}\n` : "";
    const shippingName = cleanInline(payload.shippingName, "Selected shipping");

    return {
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:640px;margin:0 auto;"><h1>Order received</h1><p>Hi ${safeName},</p><p>Thank you for your order from ${safeStore}. We received payment for order <strong>#${orderId}</strong>.</p>${htmlItems}<p><strong>Subtotal:</strong> ${money(payload.subtotal)}<br><strong>${escapeOrderNotificationHtml(shippingName)}:</strong> ${money(payload.shippingAmount)}<br><strong>Total:</strong> ${money(payload.total)}</p><p>We will send another email when your order ships.</p><p>— ${safeStore}</p></div>`,
      text: `Order received\n\nHi ${name},\n\nThank you for your order from ${params.storeName}. We received payment for order #${orderId}.\n${textItems}\nSubtotal: ${money(payload.subtotal)}\n${shippingName}: ${money(payload.shippingAmount)}\nTotal: ${money(payload.total)}\n\nWe will send another email when your order ships.\n\n— ${params.storeName}`,
    };
  }

  const carrier = cleanInline(payload.carrier, "Carrier");
  const trackingNumber = cleanInline(payload.trackingNumber, "Not provided");
  const url = trackingUrl(carrier, trackingNumber);
  const action = url
    ? `<p><a href="${url}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;">Track your package</a></p>`
    : "<p>Use the tracking number on the carrier's website to follow the shipment.</p>";
  const heading =
    row.notification_type === "tracking_updated"
      ? "Your tracking information was updated"
      : "Your order has shipped";
  const detail =
    row.notification_type === "tracking_updated"
      ? `The tracking information for order <strong>#${orderId}</strong> has changed.`
      : `Great news — order <strong>#${orderId}</strong> is on the way.`;

  return {
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:640px;margin:0 auto;"><h1>${heading}</h1><p>Hi ${safeName},</p><p>${detail}</p><p><strong>Carrier:</strong> ${escapeOrderNotificationHtml(carrier)}<br><strong>Tracking number:</strong> ${escapeOrderNotificationHtml(trackingNumber)}</p>${action}<p>Thank you for shopping with ${safeStore}.</p><p>— ${safeStore}</p></div>`,
    text: `${heading}\n\nHi ${name},\n\n${row.notification_type === "tracking_updated" ? `The tracking information for order #${orderId} has changed.` : `Great news — order #${orderId} is on the way.`}\n\nCarrier: ${carrier}\nTracking number: ${trackingNumber}\n${url ? `Track your package: ${url}` : "Use the tracking number on the carrier's website to follow the shipment."}\n\nThank you for shopping with ${params.storeName}.\n\n— ${params.storeName}`,
  };
}

function normalizeEmail(value: unknown) {
  const email = cleanInline(value).toLowerCase();
  return email.includes("@") && email.length <= 320 ? email : null;
}

export async function enqueueOrderNotification(params: {
  supabase: SupabaseClient;
  storeId: string;
  orderId: number;
  notificationType: OrderNotificationType;
  recipientEmail: string | null | undefined;
  recipientName?: string | null;
  payload: OrderNotificationPayload;
  idempotencyKey?: string;
}) {
  const recipientEmail = normalizeEmail(params.recipientEmail);
  if (!recipientEmail || recipientEmail === "unknown") return null;

  const settings = await getStoreSettings(params.supabase, params.storeId);
  const storeName = cleanInline(settings.displayName, "Truely Collectables");
  const idempotencyKey =
    params.idempotencyKey ||
    orderNotificationIdempotencyKey({
      storeId: params.storeId,
      orderId: params.orderId,
      notificationType: params.notificationType,
      carrier: params.payload.carrier,
      trackingNumber: params.payload.trackingNumber,
    });
  const subject = subjectForNotification(
    params.notificationType,
    storeName,
    params.orderId,
  );
  const insertPayload = {
    store_id: params.storeId,
    order_id: params.orderId,
    notification_type: params.notificationType,
    recipient_email: recipientEmail,
    recipient_name: cleanInline(params.recipientName) || null,
    subject,
    payload: {
      ...params.payload,
      orderId: params.orderId,
      customerName: cleanInline(params.payload.customerName || params.recipientName) || null,
    },
    idempotency_key: idempotencyKey,
  };

  const { data: inserted, error: insertError } = await params.supabase
    .from("order_notification_deliveries")
    .upsert(insertPayload, {
      onConflict: "store_id,idempotency_key",
      ignoreDuplicates: true,
    })
    .select("*")
    .maybeSingle();
  if (insertError) throw insertError;
  if (inserted) return inserted as OrderNotificationRow;

  const { data: existing, error: existingError } = await params.supabase
    .from("order_notification_deliveries")
    .select("*")
    .eq("store_id", params.storeId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;
  return (existing || null) as OrderNotificationRow | null;
}

async function markNotificationFailed(params: {
  supabase: SupabaseClient;
  row: OrderNotificationRow;
  error: string;
}) {
  const safeError = cleanInline(params.error, "Email delivery failed").slice(0, 2000);
  await params.supabase
    .from("order_notification_deliveries")
    .update({ status: "failed", last_error: safeError })
    .eq("id", params.row.id)
    .eq("store_id", params.row.store_id);

  return {
    notificationId: params.row.id,
    status: "failed" as const,
    sent: false,
    providerMessageId: null,
    error: safeError,
  };
}

export async function deliverOrderNotification(params: {
  supabase: SupabaseClient;
  storeId: string;
  notificationId: string;
}): Promise<OrderNotificationDeliveryResult> {
  const { data: claimedRows, error: claimError } = await params.supabase.rpc(
    "truely_claim_order_notification",
    {
      p_notification_id: params.notificationId,
      p_store_id: params.storeId,
    },
  );
  if (claimError) throw claimError;

  const row = (Array.isArray(claimedRows) ? claimedRows[0] : claimedRows) as
    | OrderNotificationRow
    | undefined;
  if (!row) {
    const { data: current, error: currentError } = await params.supabase
      .from("order_notification_deliveries")
      .select("*")
      .eq("id", params.notificationId)
      .eq("store_id", params.storeId)
      .maybeSingle();
    if (currentError) throw currentError;
    const currentRow = current as OrderNotificationRow | null;
    if (!currentRow) {
      throw new Error("Order notification delivery record was not found.");
    }
    return {
      notificationId: currentRow.id,
      status: currentRow.status,
      sent: currentRow.status === "sent",
      providerMessageId: currentRow.provider_message_id,
      error: currentRow.last_error,
    };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return markNotificationFailed({
      supabase: params.supabase,
      row,
      error: "RESEND_API_KEY is not configured.",
    });
  }

  try {
    const settings = await getStoreSettings(params.supabase, params.storeId);
    const storeName = cleanInline(settings.displayName, "Truely Collectables");
    const rendered = renderOrderNotification({ row, storeName });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": row.idempotency_key,
      },
      body: JSON.stringify({
        from: settings.orderFromEmail,
        to: row.recipient_email,
        subject: row.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.id) {
      return markNotificationFailed({
        supabase: params.supabase,
        row,
        error: data?.message || data?.error || JSON.stringify(data) || `Resend returned ${response.status}.`,
      });
    }

    const sentAt = new Date().toISOString();
    const { error: sentError } = await params.supabase
      .from("order_notification_deliveries")
      .update({
        status: "sent",
        provider_message_id: String(data.id),
        sent_at: sentAt,
        last_error: null,
      })
      .eq("id", row.id)
      .eq("store_id", row.store_id);
    if (sentError) throw sentError;

    return {
      notificationId: row.id,
      status: "sent",
      sent: true,
      providerMessageId: String(data.id),
      error: null,
    };
  } catch (error: any) {
    return markNotificationFailed({
      supabase: params.supabase,
      row,
      error: error?.message || "Order notification delivery failed.",
    });
  }
}

export async function enqueueAndAttemptOrderNotification(params: Parameters<typeof enqueueOrderNotification>[0]) {
  const row = await enqueueOrderNotification(params);
  if (!row) return null;
  return deliverOrderNotification({
    supabase: params.supabase,
    storeId: params.storeId,
    notificationId: row.id,
  });
}

export async function retryOrderNotifications(params: {
  supabase: SupabaseClient;
  storeId: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(Math.floor(params.limit || 25), 1), 100);
  const { data, error } = await params.supabase
    .from("order_notification_deliveries")
    .select("id")
    .eq("store_id", params.storeId)
    .in("status", ["pending", "failed", "sending"])
    .lt("attempt_count", 10)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const results: OrderNotificationDeliveryResult[] = [];
  for (const notification of data || []) {
    results.push(
      await deliverOrderNotification({
        supabase: params.supabase,
        storeId: params.storeId,
        notificationId: String(notification.id),
      }),
    );
  }

  return {
    scanned: data?.length || 0,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => result.status === "failed").length,
    deferred: results.filter(
      (result) => !result.sent && result.status !== "failed",
    ).length,
    results,
  };
}
