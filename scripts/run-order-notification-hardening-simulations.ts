import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  escapeOrderNotificationHtml,
  orderNotificationIdempotencyKey,
} from "../src/lib/order-notifications";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const migration = source(
  "supabase/migrations/20260726150000_order_notification_outbox.sql",
);
const helper = source("src/lib/order-notifications.ts");
const checkout = source("src/lib/checkout-order-finalization.ts");
const shipped = source("src/app/api/orders/mark-shipped/route.ts");
const tracking = source("src/app/api/orders/update-tracking/route.ts");
const cron = source("src/app/api/cron/order-notifications/route.ts");
const retryRoute = source(
  "src/app/api/admin/order-notifications/retry/route.ts",
);
const adminPage = source("src/app/admin/order-notifications/page.tsx");

assert.match(migration, /create table if not exists public\.order_notification_deliveries/i);
assert.match(migration, /unique \(store_id, idempotency_key\)/i);
assert.match(migration, /attempt_count < 10/i);
assert.match(migration, /status = 'sending'/i);
assert.match(migration, /interval '15 minutes'/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on public\.order_notification_deliveries from anon, authenticated/i);
assert.match(migration, /grant select, insert, update, delete on public\.order_notification_deliveries to service_role/i);
assert.match(migration, /security definer/i);
assert.match(migration, /foreign key \(order_id, store_id\)/i);

assert.equal(
  escapeOrderNotificationHtml('<script>alert("x")</script> & test'),
  "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; test",
);
const paymentKey = orderNotificationIdempotencyKey({
  storeId: "store-1",
  orderId: 42,
  notificationType: "payment_confirmation",
});
assert.equal(paymentKey, "payment_confirmation/store-1/42");
const trackingKeyA = orderNotificationIdempotencyKey({
  storeId: "store-1",
  orderId: 42,
  notificationType: "tracking_updated",
  carrier: "USPS",
  trackingNumber: "9400 1000",
});
const trackingKeyB = orderNotificationIdempotencyKey({
  storeId: "store-1",
  orderId: 42,
  notificationType: "tracking_updated",
  carrier: "USPS",
  trackingNumber: "9400 2000",
});
assert.notEqual(trackingKeyA, trackingKeyB);
assert.ok(trackingKeyA.length <= 256);

assert.match(helper, /"Idempotency-Key": row\.idempotency_key/);
assert.match(helper, /truely_claim_order_notification/);
assert.match(helper, /retryOrderNotifications/);
assert.match(helper, /status: "sent"/);
assert.match(helper, /provider_message_id/);
assert.match(helper, /escapeOrderNotificationHtml/);
assert.match(helper, /notificationType: OrderNotificationType/);

assert.match(checkout, /notificationType: "payment_confirmation"/);
assert.match(checkout, /enqueueAndAttemptOrderNotification/);
assert.match(checkout, /if \(!isE2ETest && isValidEmail\(customerEmail\)\)/);
assert.match(checkout, /queued for retry/);

assert.match(shipped, /notificationType: "shipment_confirmation"/);
assert.match(shipped, /order\.shipped_at \|\| new Date\(\)\.toISOString\(\)/);
assert.match(shipped, /emailQueued: Boolean\(notification\)/);
assert.doesNotMatch(shipped, /api\.resend\.com\/emails/);
assert.doesNotMatch(shipped, /<p>Hi \$\{order\.customer_name/);

assert.match(tracking, /notificationType: "tracking_updated"/);
assert.match(tracking, /trackingChanged && order\.shipped_at/);
assert.match(tracking, /Order not found/);

assert.match(cron, /timingSafeEqual/);
assert.match(cron, /process\.env\.CRON_SECRET/);
assert.match(cron, /retryOrderNotifications/);
assert.match(retryRoute, /deliverOrderNotification/);
assert.match(retryRoute, /retryOrderNotifications/);
assert.match(adminPage, /Order Notification Delivery/);
assert.match(adminPage, /provider_message_id/);
assert.match(adminPage, /NotificationRetryActions/);

console.log("Order notification hardening simulations passed.");
