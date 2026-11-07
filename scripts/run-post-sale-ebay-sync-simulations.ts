import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ebayQuantityRetryDelaySeconds,
  selectLowestSafeEbayQuantity,
} from "../src/lib/ebay-quantity-sync-safety";

assert.equal(selectLowestSafeEbayQuantity([0, 1, 1]), 0);
assert.equal(selectLowestSafeEbayQuantity([1, 0, 1]), 0);
assert.equal(selectLowestSafeEbayQuantity([2, 1, 3]), 1);
assert.equal(
  selectLowestSafeEbayQuantity(["2", null, undefined, -1, "bad"]),
  2,
);
assert.throws(
  () => selectLowestSafeEbayQuantity([null, undefined, -1, "bad"]),
  /No safe local quantity/,
);
assert.equal(ebayQuantityRetryDelaySeconds(0), 900);
assert.equal(ebayQuantityRetryDelaySeconds(1), 1800);
assert.equal(ebayQuantityRetryDelaySeconds(5), 21600);

const migration = readFileSync(
  "supabase/migrations/20260726233000_post_sale_ebay_quantity_sync_outbox.sql",
  "utf8",
);
const hardening = readFileSync(
  "supabase/migrations/20260727142000_harden_post_sale_outbox_constraints.sql",
  "utf8",
);
const notificationBackoff = readFileSync(
  "supabase/migrations/20260727143000_order_notification_retry_backoff.sql",
  "utf8",
);
const cron = readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "utf8",
);
const notifications = readFileSync("src/lib/order-notifications.ts", "utf8");
const checkoutFinalization = readFileSync(
  "src/lib/checkout-order-finalization.ts",
  "utf8",
);

for (const required of [
  "create table if not exists public.ebay_quantity_sync_outbox",
  "after update of status on public.checkout_inventory_reservations",
  "after insert on public.order_inventory_consumptions",
  "before update of quantity on public.products",
  "before update of quantity, status on public.inventory_items",
  "and outbox.status = 'pending'",
  "grant select, insert, update, delete on public.ebay_quantity_sync_outbox to service_role",
]) {
  assert.ok(migration.includes(required), required);
}
assert.ok(hardening.includes("on delete set null"));
assert.ok(notificationBackoff.includes("next_attempt_at"));

const outbound = cron.indexOf("retryPendingEbayQuantitySyncs({");
const inbound = cron.indexOf("runEbayAuthoritativeStoreSync({");
assert.ok(outbound >= 0 && inbound >= 0 && outbound < inbound);
assert.ok(cron.includes("if (postSaleProtectionAvailable)"));
assert.ok(cron.includes("retryOrderNotifications({"));
assert.ok(cron.includes("Inbound eBay reconciliation was skipped"));
assert.ok(notifications.includes('.lte("next_attempt_at", now)'));
assert.ok(checkoutFinalization.includes("syncEbayQuantityAfterSale({"));

console.log(
  "Post-sale eBay quantity resurrection protection and scheduled notification retry regressions passed.",
);
