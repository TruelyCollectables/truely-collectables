import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ebayQuantityRetryDelaySeconds,
  selectLowestSafeEbayQuantity,
} from "../src/lib/ebay-quantity-sync-safety";

const cases: Array<{ values: unknown[]; expected: number; label: string }> = [
  {
    values: [0, 1, 1],
    expected: 0,
    label: "a locally sold card must beat stale eBay and product quantity",
  },
  {
    values: [1, 0, 1],
    expected: 0,
    label: "a zero inventory row must prevent remote resurrection",
  },
  {
    values: [2, 1, 3],
    expected: 1,
    label: "the worker must never push above the lowest durable local quantity",
  },
  {
    values: ["2", null, undefined, -1, "bad"],
    expected: 2,
    label: "invalid values are ignored without inventing quantity",
  },
];

for (const testCase of cases) {
  assert.equal(
    selectLowestSafeEbayQuantity(testCase.values),
    testCase.expected,
    testCase.label,
  );
}

assert.throws(
  () => selectLowestSafeEbayQuantity([null, undefined, -1, "bad"]),
  /No safe local quantity/,
  "empty or invalid evidence must fail closed",
);

assert.equal(ebayQuantityRetryDelaySeconds(0), 900);
assert.equal(ebayQuantityRetryDelaySeconds(1), 1800);
assert.equal(ebayQuantityRetryDelaySeconds(4), 14400);
assert.equal(ebayQuantityRetryDelaySeconds(5), 21600);
assert.equal(ebayQuantityRetryDelaySeconds(99), 21600);

const migration = readFileSync(
  "supabase/migrations/20260726233000_post_sale_ebay_quantity_sync_outbox.sql",
  "utf8",
);
const cronRoute = readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
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
  assert.ok(migration.includes(required), `migration is missing: ${required}`);
}

const outboundRetryPosition = cronRoute.indexOf("retryPendingEbayQuantitySyncs");
const inboundSyncPosition = cronRoute.indexOf("runEbayAuthoritativeStoreSync({");
assert.ok(outboundRetryPosition >= 0, "cron route must retry outbound quantity changes");
assert.ok(inboundSyncPosition >= 0, "cron route must retain authoritative inbound sync");
assert.ok(
  outboundRetryPosition < inboundSyncPosition,
  "outbound post-sale quantity retry must run before inbound eBay reconciliation",
);
assert.ok(
  cronRoute.includes("if (postSaleProtectionAvailable)"),
  "inbound quantity reconciliation must fail closed when post-sale protection is unavailable",
);
assert.ok(
  cronRoute.includes("retryOrderNotifications"),
  "the existing scheduled run must retry failed customer notifications",
);

console.log("Post-sale eBay quantity and notification safety simulations passed.");
