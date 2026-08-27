import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStoreSettings } from "./store-settings";
import { buildOrderNotificationAttachments } from "./order-notification-documents";

export type OrderNotificationType =
  | "payment_confirmation"
  | "fulfillment_confirmation"
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
  customerEmail?: string | null;
  customerPhone?: string | null;
  total?: number | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  shippingAmount?: number | null;
  shippingName?: string | null;
  shippingService?: string | null;
  shippingAddress?: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null };
  destinationSummary?: string | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
  orderCreatedAt?: string | null;
  fulfilledAt?: string | null;
  shippedAt?: string | null;
  audience?: "customer" | "store";
  adminOrderUrl?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  auditMarker?: string | null;
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
    .update(
      `${cleanInline(carrier).toUpperCase()}\n${cleanInline(trackingNumber)}`,
    )
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
  payload: OrderNotificationPayload,
) {
  const subject = type === "payment_confirmation"
    ? payload.audience === "store" ? `New paid ${storeName} order #${orderId} — ${money(payload.total)}` : `We received your ${storeName} order #${orderId}`
    : type === "fulfillment_confirmation"
      ? payload.audience === "store" ? `${storeName} order #${orderId} is fulfilled and ready to ship` : `Your ${storeName} order #${orderId} is prepared`
      : type === "tracking_updated"
        ? payload.audience === "store" ? `Tracking updated for ${storeName} order #${orderId} — owner copy` : `Tracking updated for ${storeName} order #${orderId}`
        : payload.audience === "store" ? `${storeName} order #${orderId} shipped — owner copy` : `Your ${storeName} order #${orderId} has shipped`;
  const marker = cleanInline(payload.auditMarker);
  return marker ? `${marker} — ${subject}` : subject;
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

function renderOrderNotification(params: { row: OrderNotificationRow; storeName: string }) {
  const { row } = params;
  const payload = row.payload || ({ orderId: row.order_id } as OrderNotificationPayload);
  const orderId = Number(payload.orderId || row.order_id);
  const name = cleanInline(payload.customerName || row.recipient_name, "there");
  const items = Array.isArray(payload.items) ? payload.items : [];
  const shippingName = cleanInline(payload.shippingService || payload.shippingName, "Selected shipping");
  const address = payload.shippingAddress || {};
  const addressLines = [payload.customerName, address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(" "), address.country].map((value) => cleanInline(value)).filter(Boolean);
  const addressHtml = addressLines.length ? addressLines.map(escapeOrderNotificationHtml).join("<br>") : "Address not provided";
  const addressText = addressLines.length ? addressLines.join("\n") : "Address not provided";
  const htmlItems = items.length ? `<table style="width:100%;border-collapse:collapse;margin:18px 0;"><tbody>${itemRows(items)}</tbody></table>` : "";
  const textItems = items.length ? `
Items:
${textItemRows(items)}
` : "";
  const adminUrl = cleanInline(payload.adminOrderUrl);
  const adminAction = adminUrl ? `<p><a href="${escapeOrderNotificationHtml(adminUrl)}">Open order in fulfillment</a></p>` : "";
  const attachments = buildOrderNotificationAttachments({ payload, storeName: params.storeName, notificationType: row.notification_type });
  const shell = (heading: string, body: string) => `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:680px;margin:0 auto;"><h1>${heading}</h1>${body}<p>— ${escapeOrderNotificationHtml(params.storeName)}</p></div>`;

  if (row.notification_type === "payment_confirmation") {
    const totalsHtml = `<p><strong>Subtotal:</strong> ${money(payload.subtotal)}<br><strong>Tax:</strong> ${money(payload.taxAmount)}<br><strong>${escapeOrderNotificationHtml(shippingName)}:</strong> ${money(payload.shippingAmount)}<br><strong>Total paid:</strong> ${money(payload.total)}</p>`;
    const totalsText = `Subtotal: ${money(payload.subtotal)}
Tax: ${money(payload.taxAmount)}
${shippingName}: ${money(payload.shippingAmount)}
Total paid: ${money(payload.total)}`;
    if (payload.audience === "store") return {
      html: shell("New paid order", `<p><strong>Order #${orderId}</strong> is ready for fulfillment.</p><p><strong>Customer:</strong> ${escapeOrderNotificationHtml(name)}<br><strong>Email:</strong> ${escapeOrderNotificationHtml(payload.customerEmail || "Not provided")}<br><strong>Phone:</strong> ${escapeOrderNotificationHtml(payload.customerPhone || "Not provided")}</p><p><strong>Ship to:</strong><br>${addressHtml}</p>${htmlItems}${totalsHtml}<p>The invoice and internal packing slip are attached.</p>${adminAction}`),
      text: `New paid order

Order #${orderId} is ready for fulfillment.
Customer: ${name}
Email: ${payload.customerEmail || "Not provided"}
Phone: ${payload.customerPhone || "Not provided"}

Ship to:
${addressText}
${textItems}
${totalsText}

The invoice and internal packing slip are attached.${adminUrl ? `
Open order: ${adminUrl}` : ""}`, attachments };
    return {
      html: shell("Order received", `<p>Hi ${escapeOrderNotificationHtml(name)},</p><p>We received payment for order <strong>#${orderId}</strong>.</p><p><strong>Ship to:</strong><br>${addressHtml}</p>${htmlItems}${totalsHtml}<p>Your invoice/receipt is attached. We will email you when the order is prepared and when it ships.</p>`),
      text: `Order received

Hi ${name},

We received payment for order #${orderId}.

Ship to:
${addressText}
${textItems}
${totalsText}

Your invoice/receipt is attached. We will email you when the order is prepared and when it ships.`, attachments };
  }

  if (row.notification_type === "fulfillment_confirmation") {
    const body = payload.audience === "store"
      ? `<p>Order <strong>#${orderId}</strong> for ${escapeOrderNotificationHtml(name)} is fulfilled and ready to ship.</p><p><strong>Service:</strong> ${escapeOrderNotificationHtml(shippingName)}<br><strong>Ship to:</strong><br>${addressHtml}</p>${adminAction}`
      : `<p>Hi ${escapeOrderNotificationHtml(name)},</p><p>Order <strong>#${orderId}</strong> has been fulfilled and prepared for shipment.</p><p><strong>Shipping service:</strong> ${escapeOrderNotificationHtml(shippingName)}</p><p>We will send your tracking number when it ships.</p>`;
    return { html: shell(payload.audience === "store" ? "Order prepared" : "Your order is prepared", body), text: `Order #${orderId} is fulfilled and prepared for shipment.
Service: ${shippingName}
Ship to: ${addressText}${adminUrl ? `
Open order: ${adminUrl}` : ""}`, attachments };
  }

  const carrier = cleanInline(payload.carrier, "Carrier");
  const trackingNumber = cleanInline(payload.trackingNumber, "Not provided");
  const url = trackingUrl(carrier, trackingNumber);
  const heading = row.notification_type === "tracking_updated" ? "Tracking updated" : "Your order has shipped";
  const body = `<p>Hi ${escapeOrderNotificationHtml(name)},</p><p>Order <strong>#${orderId}</strong> ${row.notification_type === "tracking_updated" ? "has updated tracking information" : "is on the way"}.</p><p><strong>Carrier:</strong> ${escapeOrderNotificationHtml(carrier)}<br><strong>Service:</strong> ${escapeOrderNotificationHtml(shippingName)}<br><strong>Tracking:</strong> ${escapeOrderNotificationHtml(trackingNumber)}<br><strong>Ship date:</strong> ${escapeOrderNotificationHtml(payload.shippedAt || "Not recorded")}<br><strong>Destination:</strong> ${escapeOrderNotificationHtml(payload.destinationSummary || addressLines.slice(-2).join(" "))}</p>${url ? `<p><a href="${url}">Track your package</a></p>` : ""}${adminAction}`;
  return { html: shell(payload.audience === "store" ? `Owner copy — ${heading}` : heading, body), text: `${heading}

Order #${orderId}
Carrier: ${carrier}
Service: ${shippingName}
Tracking: ${trackingNumber}
Ship date: ${payload.shippedAt || "Not recorded"}
Destination: ${payload.destinationSummary || addressText}${url ? `
Track: ${url}` : ""}${adminUrl ? `
Open order: ${adminUrl}` : ""}`, attachments };
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
    params.payload,
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
      customerName:
        cleanInline(params.payload.customerName || params.recipientName) ||
        null,
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
  const safeError = cleanInline(params.error, "Email delivery failed").slice(
    0,
    2000,
  );
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
    OrderNotificationRow | undefined;
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
        reply_to: settings.supportEmail || settings.salesEmail,
        attachments: rendered.attachments,
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.id) {
      return markNotificationFailed({
        supabase: params.supabase,
        row,
        error:
          data?.message ||
          data?.error ||
          JSON.stringify(data) ||
          `Resend returned ${response.status}.`,
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

export async function enqueueAndAttemptOrderNotification(
  params: Parameters<typeof enqueueOrderNotification>[0],
) {
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
  const now = new Date().toISOString();
  const { data, error } = await params.supabase
    .from("order_notification_deliveries")
    .select("id")
    .eq("store_id", params.storeId)
    .in("status", ["pending", "failed", "sending"])
    .lt("attempt_count", 10)
    .lte("next_attempt_at", now)
    .order("next_attempt_at", { ascending: true })
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
