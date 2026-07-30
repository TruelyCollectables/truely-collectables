import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing patch anchor: ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  if (source.includes(replacement)) return source;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing block anchor: ${label}`);
  return source.slice(0, start) + replacement + "\n\n" + source.slice(end);
}

async function patchOrderNotifications() {
  const path = "src/lib/order-notifications.ts";
  let source = await readFile(path, "utf8");
  source = replaceOnce(source,
    'import { getStoreSettings } from "./store-settings";\n',
    'import { getStoreSettings } from "./store-settings";\nimport { buildOrderNotificationAttachments } from "./order-notification-documents";\n',
    "document import");
  source = replaceOnce(source,
    'export type OrderNotificationType =\n  "payment_confirmation" | "shipment_confirmation" | "tracking_updated";',
    'export type OrderNotificationType =\n  | "payment_confirmation"\n  | "fulfillment_confirmation"\n  | "shipment_confirmation"\n  | "tracking_updated";',
    "type union");
  source = replaceBlock(source, "export type OrderNotificationPayload = {", "type OrderNotificationRow = {", `export type OrderNotificationPayload = {
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
};`, "payload type");
  source = replaceBlock(source, "function subjectForNotification(", "function itemRows(", `function subjectForNotification(
  type: OrderNotificationType,
  storeName: string,
  orderId: number,
  payload: OrderNotificationPayload,
) {
  let subject = type === "payment_confirmation"
    ? payload.audience === "store" ? \`New paid \${storeName} order #\${orderId} — \${money(payload.total)}\` : \`We received your \${storeName} order #\${orderId}\`
    : type === "fulfillment_confirmation"
      ? payload.audience === "store" ? \`\${storeName} order #\${orderId} is fulfilled and ready to ship\` : \`Your \${storeName} order #\${orderId} is prepared\`
      : type === "tracking_updated"
        ? payload.audience === "store" ? \`Tracking updated for \${storeName} order #\${orderId} — owner copy\` : \`Tracking updated for \${storeName} order #\${orderId}\`
        : payload.audience === "store" ? \`\${storeName} order #\${orderId} shipped — owner copy\` : \`Your \${storeName} order #\${orderId} has shipped\`;
  const marker = cleanInline(payload.auditMarker);
  return marker ? \`\${marker} — \${subject}\` : subject;
}`, "subjects");
  source = replaceBlock(source, "function renderOrderNotification(params: {", "function normalizeEmail(", `function renderOrderNotification(params: { row: OrderNotificationRow; storeName: string }) {
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
  const htmlItems = items.length ? \`<table style="width:100%;border-collapse:collapse;margin:18px 0;"><tbody>\${itemRows(items)}</tbody></table>\` : "";
  const textItems = items.length ? \`\nItems:\n\${textItemRows(items)}\n\` : "";
  const adminUrl = cleanInline(payload.adminOrderUrl);
  const adminAction = adminUrl ? \`<p><a href="\${escapeOrderNotificationHtml(adminUrl)}">Open order in fulfillment</a></p>\` : "";
  const attachments = buildOrderNotificationAttachments({ payload, storeName: params.storeName, notificationType: row.notification_type });
  const shell = (heading: string, body: string) => \`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:680px;margin:0 auto;"><h1>\${heading}</h1>\${body}<p>— \${escapeOrderNotificationHtml(params.storeName)}</p></div>\`;

  if (row.notification_type === "payment_confirmation") {
    const totalsHtml = \`<p><strong>Subtotal:</strong> \${money(payload.subtotal)}<br><strong>Tax:</strong> \${money(payload.taxAmount)}<br><strong>\${escapeOrderNotificationHtml(shippingName)}:</strong> \${money(payload.shippingAmount)}<br><strong>Total paid:</strong> \${money(payload.total)}</p>\`;
    const totalsText = \`Subtotal: \${money(payload.subtotal)}\nTax: \${money(payload.taxAmount)}\n\${shippingName}: \${money(payload.shippingAmount)}\nTotal paid: \${money(payload.total)}\`;
    if (payload.audience === "store") return {
      html: shell("New paid order", \`<p><strong>Order #\${orderId}</strong> is ready for fulfillment.</p><p><strong>Customer:</strong> \${escapeOrderNotificationHtml(name)}<br><strong>Email:</strong> \${escapeOrderNotificationHtml(payload.customerEmail || "Not provided")}<br><strong>Phone:</strong> \${escapeOrderNotificationHtml(payload.customerPhone || "Not provided")}</p><p><strong>Ship to:</strong><br>\${addressHtml}</p>\${htmlItems}\${totalsHtml}<p>The invoice and internal packing slip are attached.</p>\${adminAction}\`),
      text: \`New paid order\n\nOrder #\${orderId} is ready for fulfillment.\nCustomer: \${name}\nEmail: \${payload.customerEmail || "Not provided"}\nPhone: \${payload.customerPhone || "Not provided"}\n\nShip to:\n\${addressText}\n\${textItems}\n\${totalsText}\n\nThe invoice and internal packing slip are attached.\${adminUrl ? \`\nOpen order: \${adminUrl}\` : ""}\`, attachments };
    return {
      html: shell("Order received", \`<p>Hi \${escapeOrderNotificationHtml(name)},</p><p>We received payment for order <strong>#\${orderId}</strong>.</p><p><strong>Ship to:</strong><br>\${addressHtml}</p>\${htmlItems}\${totalsHtml}<p>Your invoice/receipt is attached. We will email you when the order is prepared and when it ships.</p>\`),
      text: \`Order received\n\nHi \${name},\n\nWe received payment for order #\${orderId}.\n\nShip to:\n\${addressText}\n\${textItems}\n\${totalsText}\n\nYour invoice/receipt is attached. We will email you when the order is prepared and when it ships.\`, attachments };
  }

  if (row.notification_type === "fulfillment_confirmation") {
    const body = payload.audience === "store"
      ? \`<p>Order <strong>#\${orderId}</strong> for \${escapeOrderNotificationHtml(name)} is fulfilled and ready to ship.</p><p><strong>Service:</strong> \${escapeOrderNotificationHtml(shippingName)}<br><strong>Ship to:</strong><br>\${addressHtml}</p>\${adminAction}\`
      : \`<p>Hi \${escapeOrderNotificationHtml(name)},</p><p>Order <strong>#\${orderId}</strong> has been fulfilled and prepared for shipment.</p><p><strong>Shipping service:</strong> \${escapeOrderNotificationHtml(shippingName)}</p><p>We will send your tracking number when it ships.</p>\`;
    return { html: shell(payload.audience === "store" ? "Order prepared" : "Your order is prepared", body), text: \`Order #\${orderId} is fulfilled and prepared for shipment.\nService: \${shippingName}\nShip to: \${addressText}\${adminUrl ? \`\nOpen order: \${adminUrl}\` : ""}\`, attachments };
  }

  const carrier = cleanInline(payload.carrier, "Carrier");
  const trackingNumber = cleanInline(payload.trackingNumber, "Not provided");
  const url = trackingUrl(carrier, trackingNumber);
  const heading = row.notification_type === "tracking_updated" ? "Tracking updated" : "Your order has shipped";
  const body = \`<p>Hi \${escapeOrderNotificationHtml(name)},</p><p>Order <strong>#\${orderId}</strong> \${row.notification_type === "tracking_updated" ? "has updated tracking information" : "is on the way"}.</p><p><strong>Carrier:</strong> \${escapeOrderNotificationHtml(carrier)}<br><strong>Service:</strong> \${escapeOrderNotificationHtml(shippingName)}<br><strong>Tracking:</strong> \${escapeOrderNotificationHtml(trackingNumber)}<br><strong>Ship date:</strong> \${escapeOrderNotificationHtml(payload.shippedAt || "Not recorded")}<br><strong>Destination:</strong> \${escapeOrderNotificationHtml(payload.destinationSummary || addressLines.slice(-2).join(" "))}</p>\${url ? \`<p><a href="\${url}">Track your package</a></p>\` : ""}\${adminAction}\`;
  return { html: shell(payload.audience === "store" ? \`Owner copy — \${heading}\` : heading, body), text: \`\${heading}\n\nOrder #\${orderId}\nCarrier: \${carrier}\nService: \${shippingName}\nTracking: \${trackingNumber}\nShip date: \${payload.shippedAt || "Not recorded"}\nDestination: \${payload.destinationSummary || addressText}\${url ? \`\nTrack: \${url}\` : ""}\${adminUrl ? \`\nOpen order: \${adminUrl}\` : ""}\`, attachments };
}`, "renderer");
  source = replaceOnce(source,
    '        text: rendered.text,\n      }),',
    '        text: rendered.text,\n        reply_to: settings.supportEmail || settings.salesEmail,\n        attachments: rendered.attachments,\n      }),',
    "Resend metadata");
  await writeFile(path, source);
}

async function patchCheckout() {
  const path = "src/lib/checkout-order-finalization.ts";
  let source = await readFile(path, "utf8");
  source = replaceOnce(source, '  const customerName =\n    session.customer_details?.name ||\n    collectedInfo?.shipping_details?.name ||\n    null;\n', '  const customerName =\n    session.customer_details?.name ||\n    collectedInfo?.shipping_details?.name ||\n    null;\n  const customerPhone = session.customer_details?.phone || null;\n', "phone variable");
  source = replaceOnce(source, '  const total = Number(session.amount_total || 0) / 100;\n', '  const total = Number(session.amount_total || 0) / 100;\n  const taxAmount = Number(session.total_details?.amount_tax || 0) / 100;\n', "tax variable");
  source = replaceOnce(source, '    customer_email: customerEmail,\n    customer_name: customerName,\n', '    customer_email: customerEmail,\n    customer_name: customerName,\n    customer_phone: customerPhone,\n', "phone persistence");
  source = replaceOnce(source, '    shipping_amount: shippingAmount,\n    subtotal,\n', '    shipping_amount: shippingAmount,\n    subtotal,\n    tax_amount: taxAmount,\n', "tax persistence");
  source = replaceOnce(source, '      customerName,\n      total,\n      subtotal,\n      shippingAmount,\n      shippingName,\n', '      customerName,\n      customerEmail,\n      customerPhone,\n      total,\n      subtotal,\n      taxAmount,\n      shippingAmount,\n      shippingName,\n      shippingService: shippingName || shippingMethod,\n      shippingAddress: {\n        line1: shipping?.line1 || null,\n        line2: shipping?.line2 || null,\n        city: shipping?.city || null,\n        state: shipping?.state || null,\n        postalCode: shipping?.postal_code || null,\n        country: shippingCountry,\n      },\n      paymentStatus: session.payment_status || "paid",\n      fulfillmentStatus: shippingAllowed ? "ready_to_ship" : "shipping_review",\n      orderCreatedAt: new Date().toISOString(),\n', "payment payload");
  await writeFile(path, source);
}

async function patchOrderPage() {
  const path = "src/app/admin/orders/[id]/page.tsx";
  let source = await readFile(path, "utf8");
  source = replaceOnce(source, '  customer_name?: string | null;\n  total: number;\n', '  customer_name?: string | null;\n  customer_phone?: string | null;\n  total: number;\n', "phone type");
  source = replaceOnce(source, '  subtotal: number | null;\n  item_count: number | null;\n', '  subtotal: number | null;\n  tax_amount?: number | null;\n  item_count: number | null;\n', "tax type");
  source = replaceOnce(source, '  shipped_at: string | null;\n', '  fulfilled_at?: string | null;\n  shipped_at: string | null;\n', "fulfilled type");
  source = replaceOnce(source, '          <InfoTile label="Name" value={typedOrder.customer_name || "Not saved"} />\n          <InfoTile label="Email" value={typedOrder.customer_email || "No email"} />\n', '          <InfoTile label="Name" value={typedOrder.customer_name || "Not saved"} />\n          <InfoTile label="Email" value={typedOrder.customer_email || "No email"} />\n          <InfoTile label="Customer Phone" value={typedOrder.customer_phone || "Not collected"} />\n', "phone tile");
  source = replaceOnce(source, '          <div className="flex justify-between gap-4">\n            <span>Shipping Paid</span>\n            <strong>{money(shippingPaid)}</strong>\n          </div>\n', '          <div className="flex justify-between gap-4">\n            <span>Tax Paid</span>\n            <strong>{money(typedOrder.tax_amount)}</strong>\n          </div>\n\n          <div className="flex justify-between gap-4">\n            <span>Shipping Paid</span>\n            <strong>{money(shippingPaid)}</strong>\n          </div>\n', "tax row");
  source = replaceOnce(source, '          <InfoTile label="Tracking" value={typedOrder.tracking_number || "Not added"} />\n          <InfoTile\n            label="Shipped At"\n', '          <InfoTile label="Tracking" value={typedOrder.tracking_number || "Not added"} />\n          <InfoTile label="Fulfilled At" value={typedOrder.fulfilled_at ? new Date(typedOrder.fulfilled_at).toLocaleString() : "Not fulfilled"} />\n          <InfoTile\n            label="Shipped At"\n', "fulfilled tile");
  await writeFile(path, source);
}

async function patchPackage() {
  const path = "package.json";
  let source = await readFile(path, "utf8");
  source = replaceOnce(source, '    "simulate:post-sale-ebay-sync": "node --import tsx scripts/run-post-sale-ebay-sync-simulations.ts",', '    "simulate:order-lifecycle-emails": "node --import tsx scripts/run-order-lifecycle-email-simulations.ts",\n    "simulate:post-sale-ebay-sync": "node --import tsx scripts/run-post-sale-ebay-sync-simulations.ts",', "package script");
  await writeFile(path, source);
}

await patchOrderNotifications();
await patchCheckout();
await patchOrderPage();
await patchPackage();
console.log("Lifecycle source patches applied.");
