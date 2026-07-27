import assert from "node:assert/strict";
import fs from "node:fs";
import {
  ebayQuantityRetryDelaySeconds,
  selectLowestSafeEbayQuantity,
} from "../src/lib/ebay-quantity-sync-safety";
import { offerCheckoutAttemptId } from "../src/lib/offer-checkout-attempt";

function source(path: string) {
  return fs.readFileSync(path, "utf8");
}

const webhook = source("src/app/api/webhook/route.ts");
const webhookRequirements = source("src/lib/live-payment-launch-core.ts");
const reservations = source("src/lib/checkout-inventory-reservations.ts");
const reserveMigration = source(
  "supabase/migrations/20260727141000_hold_attached_checkout_reservations.sql",
);
const offerMigration = source(
  "supabase/migrations/20260726234000_consume_attached_offer_checkout_reservations.sql",
);
const reserveSource = source("src/app/api/checkout/route.ts");
const offerSource = source("src/lib/reserved-offer-checkout.ts");
const finalizer = source("src/lib/checkout-order-finalization.ts");
const outboxMigration = source(
  "supabase/migrations/20260726233000_post_sale_ebay_quantity_sync_outbox.sql",
);
const notificationSource = source("src/lib/order-notifications.ts");

for (const contract of [
  '"checkout.session.expired"',
  'event.type === "checkout.session.expired"',
  "releaseCheckoutReservationForExpiredSession",
  "expired_checkout_reservation_released",
]) {
  assert.ok(
    webhook.includes(contract) || webhookRequirements.includes(contract),
    `Expired Checkout lifecycle is missing ${contract}.`,
  );
}
assert.ok(
  webhook.indexOf('event.type === "checkout.session.expired"') <
    webhook.indexOf('event.type !== "checkout.session.completed"'),
  "Expired Checkout Sessions must be handled before the generic ignored-event branch.",
);

for (const contract of [
  "reservation.stripe_session_id is null",
  "reservation.stripe_session_id is not null",
  "reservation.checkout_attempt_id <>",
  "pg_advisory_xact_lock",
]) {
  assert.ok(
    reserveMigration.includes(contract),
    `Attached-reservation migration is missing ${contract}.`,
  );
}
for (const contract of [
  "reservation.status in ('active', 'expired')",
  "reservation.stripe_session_id is not null",
  "pg_advisory_xact_lock",
]) {
  assert.ok(
    offerMigration.includes(contract),
    `Accepted-offer delayed-webhook protection is missing ${contract}.`,
  );
}
assert.ok(
  reservations.includes('.eq("stripe_session_id", params.stripeSessionId)') &&
    reservations.includes('.eq("status", "active")') &&
    reservations.includes('.select("id")'),
  "Expired Stripe Sessions must release only their own active reservations and return an auditable count.",
);
assert.ok(
  reserveSource.includes("expectedCount: reservation.rows.length") &&
    offerSource.includes("expectedCount: reservation.rows.length"),
  "Both cart and accepted-offer Checkout must prove every reserved row was attached to Stripe.",
);
assert.ok(
  finalizer.includes("loadStripePaidCheckoutAmounts") &&
    finalizer.includes("existingOrderItemsByProductId") &&
    finalizer.includes('.from("order_items").insert') &&
    !finalizer.includes('.from("order_items").upsert') &&
    finalizer.includes("paidUnitPrice") &&
    finalizer.includes("ledgerOrderItems.reduce"),
  "Order finalization must use Stripe-paid amounts and persisted seller ownership on retries.",
);
assert.ok(
  outboxMigration.includes("before update of quantity on public.products") &&
    outboxMigration.includes("before update of quantity, status on public.inventory_items") &&
    outboxMigration.includes("and outbox.status = 'pending'"),
  "Pending post-sale eBay writes must prevent inbound inventory resurrection.",
);
assert.ok(
  notificationSource.includes('.in("status", ["pending", "failed", "sending"])') &&
    notificationSource.includes('.lt("attempt_count", 10)') &&
    notificationSource.includes("retryOrderNotifications"),
  "Customer notification failures must be durably retryable with a bounded attempt count.",
);

type Reservation = {
  attempt: string;
  status: "active" | "consumed" | "released";
  attached: boolean;
};

type Model = {
  quantity: number;
  sessions: Set<string>;
  consumptions: Set<string>;
  reservations: Map<string, Reservation>;
};

function model(initialQuantity = 1): Model {
  return {
    quantity: initialQuantity,
    sessions: new Set(),
    consumptions: new Set(),
    reservations: new Map(),
  };
}

function unavailableQuantity(state: Model, excludingAttempt?: string) {
  let total = 0;
  for (const reservation of state.reservations.values()) {
    if (
      reservation.attempt !== excludingAttempt &&
      reservation.status === "active"
    ) {
      total += 1;
    }
  }
  return total;
}

function reserve(state: Model, attempt: string) {
  const existing = state.reservations.get(attempt);
  if (existing?.status === "active") return true;
  if (state.quantity - unavailableQuantity(state, attempt) < 1) return false;
  state.reservations.set(attempt, {
    attempt,
    status: "active",
    attached: false,
  });
  return true;
}

function attach(state: Model, attempt: string) {
  const reservation = state.reservations.get(attempt);
  assert.equal(reservation?.status, "active");
  reservation.attached = true;
  state.sessions.add(attempt);
}

function expire(state: Model, attempt: string) {
  const reservation = state.reservations.get(attempt);
  if (reservation?.status === "active" && reservation.attached) {
    reservation.status = "released";
  }
}

function complete(state: Model, attempt: string) {
  const reservation = state.reservations.get(attempt);
  if (state.consumptions.has(attempt)) return;
  assert.equal(reservation?.status, "active");
  assert.equal(reservation.attached, true);
  assert.ok(state.quantity > 0);
  state.quantity -= 1;
  reservation.status = "consumed";
  state.consumptions.add(attempt);
}

function assertInvariants(state: Model, initialQuantity: number) {
  assert.ok(state.quantity >= 0, "inventory may never become negative");
  assert.ok(
    state.quantity + state.consumptions.size === initialQuantity,
    "each completed payment must consume inventory exactly once",
  );
  assert.ok(
    unavailableQuantity(state) <= state.quantity,
    "active reservations may never exceed remaining inventory",
  );
}

{
  const state = model(1);
  assert.equal(reserve(state, "buyer-a"), true);
  assert.equal(reserve(state, "buyer-a"), true);
  attach(state, "buyer-a");
  attach(state, "buyer-a");
  assert.equal(state.sessions.size, 1, "repeated clicks must retain one payable session");
  assert.equal(reserve(state, "buyer-b"), false, "a second buyer cannot reserve the same card");
  complete(state, "buyer-a");
  complete(state, "buyer-a");
  assertInvariants(state, 1);
}

{
  const state = model(1);
  reserve(state, "abandoned");
  attach(state, "abandoned");
  expire(state, "abandoned");
  assert.equal(reserve(state, "replacement"), true);
  attach(state, "replacement");
  complete(state, "replacement");
  assertInvariants(state, 1);
}

{
  const attempts = Array.from({ length: 200 }, (_, index) => `attempt-${index}`);
  for (let seed = 1; seed <= 250; seed += 1) {
    const state = model(1);
    let value = seed >>> 0;
    const random = () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
    for (let step = 0; step < 2_000; step += 1) {
      const attempt = attempts[Math.floor(random() * attempts.length)];
      const action = Math.floor(random() * 4);
      if (action === 0) reserve(state, attempt);
      if (action === 1 && state.reservations.get(attempt)?.status === "active") {
        attach(state, attempt);
      }
      if (
        action === 2 &&
        state.reservations.get(attempt)?.status === "active" &&
        state.reservations.get(attempt)?.attached &&
        state.quantity > 0
      ) {
        complete(state, attempt);
      }
      if (action === 3) expire(state, attempt);
      assertInvariants(state, 1);
    }
  }
}

for (let local = 0; local <= 10; local += 1) {
  for (let remote = 0; remote <= 10; remote += 1) {
    for (let journaled = 0; journaled <= 10; journaled += 1) {
      assert.equal(
        selectLowestSafeEbayQuantity([local, remote, journaled]),
        Math.min(local, remote, journaled),
        "outbound eBay quantity must always choose the lowest durable evidence",
      );
    }
  }
}
for (let attempt = 0; attempt < 100; attempt += 1) {
  const delay = ebayQuantityRetryDelaySeconds(attempt);
  assert.ok(delay >= 15 * 60 && delay <= 6 * 60 * 60);
  if (attempt > 0) {
    assert.ok(delay >= ebayQuantityRetryDelaySeconds(attempt - 1));
  }
}

const offerIds = new Set<string>();
for (let offerId = 1; offerId <= 10_000; offerId += 1) {
  const attemptId = offerCheckoutAttemptId({
    storeId: "00000000-0000-0000-0000-000000000001",
    offerId,
  });
  assert.match(
    attemptId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(offerIds.has(attemptId), false, "offer attempt IDs must not collide");
  offerIds.add(attemptId);
}

console.log(
  "Titanic release stress simulations passed: 250 randomized 2,000-step checkout races, duplicate clicks/webhooks, session expiration release, 1,331 stale-eBay quantity combinations, retry backoff, and 10,000 deterministic offer IDs.",
);
