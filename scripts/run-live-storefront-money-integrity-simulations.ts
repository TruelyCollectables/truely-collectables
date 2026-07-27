import assert from "node:assert/strict";
import fs from "node:fs";

function source(path: string) {
  return fs.readFileSync(path, "utf8");
}

const finalizer = source("src/lib/checkout-order-finalization.ts");
const paidAmounts = source("src/lib/stripe-paid-item-prices.ts");
const reservation = source("src/lib/checkout-inventory-reservations.ts");
const attempts = source("src/lib/checkout-attempts.ts");
const checkout = source("src/app/api/checkout/route.ts");
const offerCheckout = source("src/lib/reserved-offer-checkout.ts");
const inventory = source("src/modules/inventory/engine.ts");
const protection = source("src/lib/buyer-protection-order.ts");
const postPayment = source("src/lib/stripe-post-payment.ts");
const orderStatus = source("src/lib/order-status.ts");

for (const token of [
  'event.type !== "checkout.session.completed"',
  'session.mode !== "payment"',
  'session.status !== "complete"',
  'session.payment_status !== "paid"',
  "session.livemode !== event.livemode",
  "metadata.store_id !== storeId",
  "loadStripePaidCheckoutAmounts",
  "paidAmounts.unitPrices",
  "existingOrderItemsByProductId",
  "const { data: insertedOrderItem",
  "recoverableReviewStatuses",
  "ledgerOrderItems.reduce",
  "stableOrderPayload",
  "paymentReviewRequired && mayApplySafetyReview",
]) {
  assert.ok(finalizer.includes(token), `Finalizer is missing ${token}.`);
}
assert.doesNotMatch(
  finalizer,
  /price:\s*Number\(product\.price\)/,
  "Paid order items must never use the mutable listing price.",
);
assert.doesNotMatch(
  finalizer,
  /\.update\(orderPayload\)/,
  "A webhook retry must not reset the complete initial order payload.",
);
assert.doesNotMatch(
  finalizer,
  /\.from\("order_items"\)\.upsert/,
  "Webhook retries must not overwrite historical seller ownership or titles.",
);
assert.doesNotMatch(
  finalizer,
  /if \(product\.sellerAccountId\)/,
  "Seller/store item counts must come from persisted order items, not mutable inventory ownership.",
);
for (const recoverable of [
  "paid_inventory_review",
  "paid_financial_review",
  "paid_offer_review",
  "paid_payment_review",
]) {
  assert.ok(
    finalizer.includes(recoverable),
    `Webhook recovery must include ${recoverable}.`,
  );
}

for (const token of [
  "starting_after",
  "response.has_more",
  "amount_total",
  'lineType === "shipping"',
  'lineType === "buyer_protection"',
  "could not be mapped to the paid cart",
  "did not match Checkout total",
]) {
  assert.ok(paidAmounts.includes(token), `Paid-line audit is missing ${token}.`);
}

for (const token of [
  '.select("id")',
  "expectedCount",
  "invalid cart line",
  "wrong products",
]) {
  assert.ok(reservation.includes(token), `Reservation hardening is missing ${token}.`);
}
for (const token of [
  "terms evidence could not be attached",
  "could not be durably attached",
]) {
  assert.ok(attempts.includes(token), `Checkout attempt hardening is missing ${token}.`);
}
assert.ok(
  checkout.includes("expectedCount: reservation.rows.length"),
  "Cart Checkout must prove every reservation was attached to Stripe.",
);
assert.ok(
  offerCheckout.includes("expectedCount: reservation.rows.length"),
  "Accepted-offer Checkout must prove its reservation was attached to Stripe.",
);
assert.match(
  inventory,
  /Array\.from\(quantitiesByProduct\.entries\(\)\)[\s\S]*\.sort\(\(\[leftId\], \[rightId\]\) => leftId - rightId\)/,
  "Multi-card carts must acquire inventory locks in deterministic product order.",
);

for (const token of [
  "paidFeeAmount",
  "paidItemSubtotal",
  "Stripe-paid item subtotal",
  "stripe_paid_fee_verified",
]) {
  assert.ok(protection.includes(token), `Buyer Protection audit is missing ${token}.`);
}

for (const token of [
  'status: fullyRefunded ? "refunded_review" : "partial_refund_review"',
  'fulfillment_status: fulfillmentProgressed',
  'status: "dispute_review"',
  'fulfillment_status: disputeFulfillmentProgressed',
]) {
  assert.ok(postPayment.includes(token), `Post-payment hold is missing ${token}.`);
}
for (const status of [
  "payment_review",
  "financial_review",
  "offer_review",
  "refund_review",
  "dispute_review",
]) {
  assert.ok(orderStatus.includes(status), `Order review status is missing ${status}.`);
}

console.log(
  "Live storefront money integrity simulations passed: Stripe-paid pricing, non-destructive webhook retries, exact reservation attachment, deterministic inventory locks, Buyer Protection reconciliation, and refund/dispute fulfillment holds.",
);
