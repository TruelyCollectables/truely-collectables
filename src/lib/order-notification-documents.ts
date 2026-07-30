import type {
  OrderNotificationItem,
  OrderNotificationPayload,
} from "./order-notifications";

export type OrderNotificationAttachment = {
  filename: string;
  content: string;
};

function clean(value: unknown, fallback = "") {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function escapeHtml(value: unknown) {
  return clean(value)
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

function dateLabel(value: unknown) {
  const text = clean(value);
  if (!text) return "Not recorded";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString("en-US");
}

function addressLines(payload: OrderNotificationPayload) {
  const address = payload.shippingAddress;
  return [
    payload.customerName,
    address?.line1,
    address?.line2,
    [address?.city, address?.state, address?.postalCode].filter(Boolean).join(", "),
    address?.country,
  ]
    .map((value) => clean(value))
    .filter(Boolean);
}

function itemTable(items: OrderNotificationItem[]) {
  const rows = items
    .slice(0, 100)
    .map((item) => {
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
      const unitPrice = Number(item.price || 0);
      return `<tr><td>${escapeHtml(item.title || "Item")}</td><td class="center">${quantity}</td><td class="right">${money(unitPrice)}</td><td class="right">${money(unitPrice * quantity)}</td></tr>`;
    })
    .join("");

  return `<table><thead><tr><th>Item</th><th class="center">Qty</th><th class="right">Unit price</th><th class="right">Line total</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No item rows were supplied.</td></tr>'}</tbody></table>`;
}

function documentShell(params: {
  title: string;
  storeName: string;
  orderId: number;
  body: string;
  footer: string;
}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(params.title)}</title><style>body{font-family:Arial,sans-serif;color:#111;margin:32px;line-height:1.45}.header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #111;padding-bottom:16px;margin-bottom:22px}.brand{font-size:24px;font-weight:800}.muted{color:#555;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0}.card{border:1px solid #ccc;border-radius:10px;padding:14px}table{width:100%;border-collapse:collapse;margin:22px 0}th,td{border-bottom:1px solid #ddd;padding:9px 6px;text-align:left;font-size:13px}.right{text-align:right}.center{text-align:center}.totals{margin-left:auto;width:min(360px,100%)}.totals div{display:flex;justify-content:space-between;padding:5px 0}.grand{font-size:18px;font-weight:800;border-top:2px solid #111;margin-top:5px;padding-top:10px!important}.footer{margin-top:30px;padding-top:14px;border-top:1px solid #ccc;font-size:11px;color:#555}@media print{body{margin:16px}.header{break-inside:avoid}}</style></head><body><div class="header"><div><div class="brand">${escapeHtml(params.storeName)}</div><div class="muted">TruelyCollectables.com</div></div><div class="right"><strong>${escapeHtml(params.title)}</strong><br>Order #${params.orderId}</div></div>${params.body}<div class="footer">${escapeHtml(params.footer)}</div></body></html>`;
}

function invoiceHtml(payload: OrderNotificationPayload, storeName: string) {
  const address = addressLines(payload);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const body = `<div class="grid"><div class="card"><strong>Bill / Ship To</strong><br>${address.map(escapeHtml).join("<br>") || "Address not supplied"}${payload.customerEmail ? `<br>${escapeHtml(payload.customerEmail)}` : ""}${payload.customerPhone ? `<br>${escapeHtml(payload.customerPhone)}` : ""}</div><div class="card"><strong>Order details</strong><br>Payment: ${escapeHtml(payload.paymentStatus || "paid")}<br>Fulfillment: ${escapeHtml(payload.fulfillmentStatus || "ready to ship")}<br>Placed: ${escapeHtml(dateLabel(payload.orderCreatedAt))}<br>Shipping: ${escapeHtml(payload.shippingService || payload.shippingName || "Selected shipping")}</div></div>${itemTable(items)}<div class="totals"><div><span>Subtotal</span><strong>${money(payload.subtotal)}</strong></div><div><span>Tax</span><strong>${money(payload.taxAmount)}</strong></div><div><span>Shipping</span><strong>${money(payload.shippingAmount)}</strong></div><div class="grand"><span>Total paid</span><strong>${money(payload.total)}</strong></div></div>`;

  return documentShell({
    title: "Customer Invoice / Receipt",
    storeName,
    orderId: Number(payload.orderId || 0),
    body,
    footer: "Keep this invoice for your records. Contact the store using the reply address on the email if anything is incorrect.",
  });
}

function packingSlipHtml(payload: OrderNotificationPayload, storeName: string) {
  const address = addressLines(payload);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const rows = items
    .slice(0, 100)
    .map((item) => `<tr><td>${escapeHtml(item.title || "Item")}</td><td class="center">${Math.max(1, Math.floor(Number(item.quantity || 1)))}</td></tr>`)
    .join("");
  const body = `<div class="grid"><div class="card"><strong>Ship To</strong><br>${address.map(escapeHtml).join("<br>") || "Address not supplied"}${payload.customerPhone ? `<br>Phone: ${escapeHtml(payload.customerPhone)}` : ""}</div><div class="card"><strong>Fulfillment</strong><br>Service: ${escapeHtml(payload.shippingService || payload.shippingName || "Selected shipping")}<br>Order placed: ${escapeHtml(dateLabel(payload.orderCreatedAt))}<br>Prepared: ${escapeHtml(dateLabel(payload.fulfilledAt))}<br>Customer email: ${escapeHtml(payload.customerEmail || "Not supplied")}</div></div><table><thead><tr><th>Item</th><th class="center">Qty to pack</th></tr></thead><tbody>${rows || '<tr><td colspan="2">No item rows were supplied.</td></tr>'}</tbody></table><div class="card"><strong>Pack check</strong><br>☐ Items match order &nbsp; ☐ Card protection used &nbsp; ☐ Address verified &nbsp; ☐ Label/tracking matched</div>`;

  return documentShell({
    title: "Packing Slip",
    storeName,
    orderId: Number(payload.orderId || 0),
    body,
    footer: "Internal fulfillment copy. Do not include internal notes, credentials, or payment-provider identifiers in the customer package.",
  });
}

function attachment(filename: string, html: string): OrderNotificationAttachment {
  return {
    filename,
    content: Buffer.from(html, "utf8").toString("base64"),
  };
}

export function buildOrderNotificationAttachments(params: {
  payload: OrderNotificationPayload;
  storeName: string;
  notificationType: string;
}) {
  const { payload, storeName, notificationType } = params;
  if (notificationType !== "payment_confirmation") return [];

  const orderId = Number(payload.orderId || 0);
  const files = [
    attachment(
      `truely-collectables-order-${orderId}-invoice.html`,
      invoiceHtml(payload, storeName),
    ),
  ];

  if (payload.audience === "store") {
    files.push(
      attachment(
        `truely-collectables-order-${orderId}-packing-slip.html`,
        packingSlipHtml(payload, storeName),
      ),
    );
  }

  return files;
}
