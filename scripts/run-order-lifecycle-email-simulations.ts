import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  orderNotificationIdempotencyKey,
  type OrderNotificationPayload,
} from "../src/lib/order-notifications";
import { buildOrderNotificationAttachments } from "../src/lib/order-notification-documents";

const source = (path: string) => readFileSync(path, "utf8");
const migration = source("supabase/migrations/20260730070000_expand_order_notification_lifecycle.sql");
const notifications = source("src/lib/order-notifications.ts");
const checkout = source("src/lib/checkout-order-finalization.ts");
const fulfilled = source("src/app/api/admin/orders/mark-fulfilled/route.ts");
const shipped = source("src/app/api/orders/mark-shipped/route.ts");
const tracking = source("src/app/api/orders/update-tracking/route.ts");
const trackingForm = source("src/app/admin/orders/[id]/TrackingForm.tsx");
const orderPage = source("src/app/admin/orders/[id]/page.tsx");

assert.match(migration, /fulfillment_confirmation/);
assert.match(migration, /customer_phone/);
assert.match(migration, /tax_amount/);
assert.match(migration, /fulfilled_at/);
assert.match(notifications, /buildOrderNotificationAttachments/);
assert.match(notifications, /reply_to: settings\.supportEmail \|\| settings\.salesEmail/);
assert.match(notifications, /notification_type === "fulfillment_confirmation"/);
assert.match(notifications, /Tax:/);
assert.match(notifications, /Ship to:/);
assert.match(checkout, /customerPhone/);
assert.match(checkout, /taxAmount/);
assert.match(checkout, /shippingAddress:/);
assert.match(fulfilled, /notificationType: "fulfillment_confirmation"/);
assert.match(fulfilled, /store_order_fulfilled/);
assert.match(shipped, /store_order_shipped/);
assert.match(tracking, /store_tracking_updated/);
assert.match(trackingForm, /Mark Fulfilled/);
assert.match(trackingForm, /\/api\/admin\/orders\/mark-fulfilled/);
assert.match(orderPage, /Customer Phone/);
assert.match(orderPage, /Tax Paid/);
assert.match(orderPage, /Fulfilled At/);

const payload: OrderNotificationPayload = {
  orderId: 20260801,
  customerName: "Launch Buyer",
  customerEmail: "truelycollectables+launch-buyer@gmail.com",
  customerPhone: "303-555-0100",
  subtotal: 19.99,
  taxAmount: 1.65,
  shippingAmount: 1.32,
  total: 22.96,
  shippingName: "USPS Standard Envelope",
  shippingService: "USPS Standard Envelope",
  paymentStatus: "paid",
  fulfillmentStatus: "ready_to_ship",
  orderCreatedAt: "2026-07-30T06:00:00.000Z",
  shippingAddress: {
    line1: "123 Launch Audit Way",
    line2: "Suite 2",
    city: "Denver",
    state: "CO",
    postalCode: "80202",
    country: "US",
  },
  items: [{ title: "Launch Audit Card", quantity: 1, price: 19.99 }],
};

const customerAttachments = buildOrderNotificationAttachments({
  payload: { ...payload, audience: "customer" },
  storeName: "Truely Collectables",
  notificationType: "payment_confirmation",
});
assert.equal(customerAttachments.length, 1);
assert.match(customerAttachments[0].filename, /invoice\.html$/);
const invoice = Buffer.from(customerAttachments[0].content, "base64").toString("utf8");
assert.match(invoice, /Launch Audit Card/);
assert.match(invoice, /123 Launch Audit Way/);
assert.match(invoice, /\$1\.65/);

const ownerAttachments = buildOrderNotificationAttachments({
  payload: { ...payload, audience: "store" },
  storeName: "Truely Collectables",
  notificationType: "payment_confirmation",
});
assert.equal(ownerAttachments.length, 2);
assert.ok(ownerAttachments.some((item) => item.filename.endsWith("packing-slip.html")));

assert.equal(
  orderNotificationIdempotencyKey({
    storeId: "store-1",
    orderId: 99,
    notificationType: "fulfillment_confirmation",
  }),
  "fulfillment_confirmation/store-1/99",
);

console.log("Order lifecycle email simulations passed.");
