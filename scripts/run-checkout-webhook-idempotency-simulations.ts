import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260725170000_consume_checkout_reservations.sql",
  "utf8",
);
const reservationHelper = fs.readFileSync(
  "src/lib/checkout-inventory-reservations.ts",
  "utf8",
);
const finalizer = fs.readFileSync(
  "src/lib/checkout-order-finalization.ts",
  "utf8",
);
const webhookRoute = fs.readFileSync("src/app/api/webhook/route.ts", "utf8");

const requiredMigrationContracts = [
  "create table if not exists public.order_inventory_consumptions",
  "unique (store_id, order_id, legacy_product_id)",
  "tcos_consume_checkout_reservation_after_sale",
  "v_reservation.status = 'consumed'",
  "status = 'consumed'",
  "tcos_decrement_order_inventory_once",
  "pg_advisory_xact_lock",
  "grant execute on function public.tcos_consume_checkout_reservation_after_sale",
  "grant execute on function public.tcos_decrement_order_inventory_once",
];
for (const contract of requiredMigrationContracts) {
  assert.ok(migration.includes(contract), `Missing migration contract: ${contract}`);
}

for (const contract of [
  "consumeCheckoutReservationAfterSale",
  "decrementOrderInventoryOnce",
  "tcos_consume_checkout_reservation_after_sale",
  "tcos_decrement_order_inventory_once",
  "alreadyConsumed",
]) {
  assert.ok(
    reservationHelper.includes(contract),
    `Missing reservation helper contract: ${contract}`,
  );
}

assert.ok(
  finalizer.includes("getByLegacyProductIds"),
  "Webhook finalization must load paid products without requiring them to remain available on retry.",
);
assert.ok(
  !finalizer.includes("requireAvailableCartItems"),
  "Webhook retries must not fail because inventory was already sold by the first attempt.",
);
assert.ok(
  finalizer.includes("consumeCheckoutReservationAfterSale"),
  "Reserved cart purchases must consume their reservation exactly once.",
);
assert.ok(
  finalizer.includes("decrementOrderInventoryOnce"),
  "Accepted offers and other non-reserved checkouts must use the exactly-once order journal.",
);
assert.ok(
  finalizer.includes("loadStripePaidCheckoutAmounts"),
  "Order finalization must rebuild paid prices and totals from Stripe line items.",
);
assert.ok(
  finalizer.includes('onConflict: "store_id,order_id,product_id"'),
  "Order item retries must upsert one row per paid product.",
);
assert.ok(
  finalizer.indexOf("consumeCheckoutReservationAfterSale") <
    finalizer.indexOf('.from("order_items").upsert'),
  "Inventory consumption must occur before order-item upsert so an upsert retry cannot double-decrement.",
);
assert.ok(
  finalizer.includes("paidUnitPrice"),
  "Order items must store the Stripe-paid unit price rather than the mutable listing price.",
);
assert.doesNotMatch(
  finalizer,
  /price:\s*Number\(product\.price\)/,
  "Order finalization must never write the current listing price as the paid price.",
);
assert.ok(
  finalizer.includes("stableOrderPayload") &&
    finalizer.includes("paymentReviewRequired && mayApplySafetyReview"),
  "Webhook retries must update stable payment facts without resetting progressed order status.",
);
assert.doesNotMatch(
  finalizer,
  /\.update\(orderPayload\)/,
  "Webhook retries must not overwrite the full initial order payload.",
);

for (const contract of [
  "claimStripeWebhookEvent",
  "processStripeRefundEvent",
  "processStripeDisputeEvent",
  "updateSellerPayoutAccountFromStripe",
  "handleAccountCardVerification",
  "handleBindingOfferSetup",
  "finalizeCheckoutOrder",
  "finishStripeWebhookEvent",
  "failStripeWebhookEvent",
]) {
  assert.ok(webhookRoute.includes(contract), `Webhook router lost: ${contract}`);
}

type LineState = {
  quantity: number;
  consumed: boolean;
  itemInserted: boolean;
};

function processLine(state: LineState, requested: number, failInsert = false) {
  if (!state.consumed) {
    assert.ok(state.quantity >= requested, "inventory must cover the paid quantity");
    state.quantity -= requested;
    state.consumed = true;
  }

  if (!state.itemInserted) {
    if (failInsert) throw new Error("simulated_order_item_insert_failure");
    state.itemInserted = true;
  }
}

{
  const cart: LineState = { quantity: 2, consumed: false, itemInserted: false };
  processLine(cart, 1);
  processLine(cart, 1);
  assert.deepEqual(cart, { quantity: 1, consumed: true, itemInserted: true });
}

{
  const cart: LineState = { quantity: 2, consumed: false, itemInserted: false };
  assert.throws(() => processLine(cart, 1, true));
  assert.equal(cart.quantity, 1);
  assert.equal(cart.consumed, true);
  assert.equal(cart.itemInserted, false);
  processLine(cart, 1);
  assert.deepEqual(cart, { quantity: 1, consumed: true, itemInserted: true });
}

{
  const first: LineState = { quantity: 1, consumed: false, itemInserted: false };
  const second: LineState = { quantity: 1, consumed: false, itemInserted: false };
  processLine(first, 1);
  assert.throws(() => processLine(second, 1, true));
  processLine(first, 1);
  processLine(second, 1);
  assert.deepEqual(first, { quantity: 0, consumed: true, itemInserted: true });
  assert.deepEqual(second, { quantity: 0, consumed: true, itemInserted: true });
}

{
  const acceptedOffer: LineState = {
    quantity: 1,
    consumed: false,
    itemInserted: false,
  };
  processLine(acceptedOffer, 1);
  processLine(acceptedOffer, 1);
  assert.deepEqual(acceptedOffer, {
    quantity: 0,
    consumed: true,
    itemInserted: true,
  });
}

console.log("Checkout webhook idempotency simulations passed: 4/4 failure paths plus structural contracts");
