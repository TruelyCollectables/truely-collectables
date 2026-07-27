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
const attemptHelper = fs.readFileSync("src/lib/checkout-attempts.ts", "utf8");
const checkoutRoute = fs.readFileSync("src/app/api/checkout/route.ts", "utf8");
const checkoutButton = fs.readFileSync(
  "src/app/components/CheckoutButton.tsx",
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
  "releaseCheckoutReservationForExpiredSession",
]) {
  assert.ok(
    reservationHelper.includes(contract),
    `Missing reservation helper contract: ${contract}`,
  );
}

for (const contract of [
  "stripeSessionId?: string | null",
  "stripe_session_id: params.stripeSessionId || null",
]) {
  assert.ok(
    attemptHelper.includes(contract),
    `Failed checkout attempt journaling is missing ${contract}.`,
  );
}
for (const contract of [
  "if (claim.stripeSessionId)",
  "checkout.sessions.retrieve",
  "checkout.sessions.expire",
  "releaseCheckoutReservationForExpiredSession",
  "resetAttempt: true",
  "stripeSessionId: checkoutJournal.stripeSessionId",
  '.from("checkout_inventory_reservations")',
  '.eq("stripe_session_id", existingSession.id)',
]) {
  assert.ok(checkoutRoute.includes(contract), `Cart recovery is missing ${contract}.`);
}
assert.ok(
  checkoutButton.includes("data.retryable !== true") &&
    checkoutButton.includes("clearCheckoutAttempt()"),
  "A nonretryable ended cart session must clear its browser attempt so the next click gets a new idempotency key.",
);

assert.ok(
  finalizer.includes("getByLegacyProductIds"),
  "Webhook finalization must load paid products without requiring them to remain available on retry.",
);
assert.ok(
  !finalizer.includes("requireAvailableCartItems"),
  "Webhook retries must not fail because inventory was already sold by the first attempt.",
);
assert.ok(finalizer.includes("consumeCheckoutReservationAfterSale"));
assert.ok(finalizer.includes("decrementOrderInventoryOnce"));
assert.ok(finalizer.includes("loadStripePaidCheckoutAmounts"));
assert.ok(finalizer.includes("existingOrderItemsByProductId"));
assert.ok(finalizer.includes('.from("order_items").insert'));
assert.doesNotMatch(finalizer, /\.from\("order_items"\)\.upsert/);
assert.ok(
  finalizer.indexOf("consumeCheckoutReservationAfterSale") <
    finalizer.indexOf('.from("order_items").insert'),
);
assert.ok(
  finalizer.includes("recoverableReviewStatuses") &&
    finalizer.includes('"paid_financial_review"') &&
    finalizer.includes('"paid_offer_review"'),
  "A successful webhook retry must clear transient inventory, financial, offer, and payment review states.",
);
assert.ok(finalizer.includes("paidUnitPrice"));
assert.doesNotMatch(finalizer, /price:\s*Number\(product\.price\)/);
assert.ok(
  finalizer.includes("stableOrderPayload") &&
    finalizer.includes("paymentReviewRequired && mayApplySafetyReview"),
);
assert.doesNotMatch(finalizer, /\.update\(orderPayload\)/);

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
  'event.type === "checkout.session.expired"',
  "expired_checkout_reservation_released",
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

console.log(
  "Checkout webhook, orphan-session recovery, expired-session release, and idempotency simulations passed.",
);
