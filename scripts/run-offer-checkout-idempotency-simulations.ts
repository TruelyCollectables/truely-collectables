import assert from "node:assert/strict";
import fs from "node:fs";
import { offerCheckoutAttemptId } from "../src/lib/offer-checkout-attempt";

function source(path: string) {
  return fs.readFileSync(path, "utf8");
}

const createOfferRoute = source("src/app/api/offers/create/route.ts");
const acceptOfferRoute = source("src/app/api/offers/update-status/route.ts");
const counterOfferRoute = source("src/app/api/offers/counter/route.ts");
const buyerCheckoutRoute = source("src/app/api/offers/buyer-checkout/route.ts");
const reservedOfferCheckout = source("src/lib/reserved-offer-checkout.ts");
const offerCheckoutAttempt = source("src/lib/offer-checkout-attempt.ts");
const offerCheckoutToken = source("src/lib/offer-checkout-token.ts");
const attachedReservationMigration = source(
  "supabase/migrations/20260726234000_consume_attached_offer_checkout_reservations.sql",
);

for (const [name, route] of [
  ["public offer creation", createOfferRoute],
  ["accepted offer decision", acceptOfferRoute],
  ["counteroffer decision", counterOfferRoute],
  ["buyer-configured offer checkout", buyerCheckoutRoute],
] as const) {
  assert.match(
    route,
    /createServerInventoryEngine\(\)/,
    `${name} must use the public sports-card-scoped inventory engine.`,
  );
  assert.match(
    route,
    /requireAvailableCartItems\(\[/,
    `${name} must reject unavailable or launch-excluded products.`,
  );
}

for (const [name, route] of [
  ["accepted offer decision", acceptOfferRoute],
  ["counteroffer decision", counterOfferRoute],
] as const) {
  assert.match(route, /createOfferCheckoutToken/);
  assert.match(route, /\/offer-checkout\/\$\{offer\.id\}\?token=/);
  assert.doesNotMatch(route, /checkout\.sessions\.create/);
}

assert.match(buyerCheckoutRoute, /parseOfferCheckoutToken/);
assert.match(buyerCheckoutRoute, /startReservedOfferCheckout\(\{/);
assert.doesNotMatch(buyerCheckoutRoute, /checkout\.sessions\.create/);

for (const contract of [
  "retrieveVerifiedOfferSession",
  "legacy.status === \"open\" && legacyAttemptId",
  "return replayResult(legacy, legacyAttemptId)",
  "legacy.status === \"open\" && !legacyAttemptId",
  "checkout.sessions.expire(legacy.id)",
  "releaseCheckoutReservationForExpiredSession",
  "previousStripeSessionId = existing.id",
  "generation < 5",
  "reserveCheckoutInventory({",
  "checkout.sessions.create(",
  "attachStripeSessionToCheckoutReservation",
  "expectedCount: reservation.rows.length",
  "completeCheckoutAttempt",
  "stripeSessionId,",
]) {
  assert.ok(
    reservedOfferCheckout.includes(contract),
    `Accepted-offer checkout is missing ${contract}.`,
  );
}
assert.ok(
  reservedOfferCheckout.indexOf("reserveCheckoutInventory({") <
    reservedOfferCheckout.indexOf("checkout.sessions.create("),
  "Accepted-offer inventory must be reserved before Stripe creates a payable session.",
);
assert.match(
  reservedOfferCheckout,
  /const stripeIdempotencyKey = `truely_offer_checkout_\$\{params\.storeId\}_\$\{checkoutAttemptId\}`/,
);
assert.doesNotMatch(reservedOfferCheckout, /selectionKey/);

const reservedReplayStart = reservedOfferCheckout.indexOf(
  'if (legacy.status === "open" && legacyAttemptId)',
);
const unreservedExpiryStart = reservedOfferCheckout.indexOf(
  'if (legacy.status === "open" && !legacyAttemptId)',
);
assert.ok(
  reservedReplayStart >= 0 && unreservedExpiryStart > reservedReplayStart,
  "The reservation-backed replay branch must precede the legacy unreserved retirement branch.",
);
const reservedReplayBlock = reservedOfferCheckout.slice(
  reservedReplayStart,
  unreservedExpiryStart,
);
assert.match(
  reservedReplayBlock,
  /return replayResult\(legacy, legacyAttemptId\)/,
  "A second browser must replay the valid reservation-backed open session.",
);
assert.doesNotMatch(
  reservedReplayBlock,
  /checkout\.sessions\.expire\(legacy\.id\)/,
  "A second browser must never expire a valid reservation-backed open session.",
);
const unreservedExpiryBlock = reservedOfferCheckout.slice(
  unreservedExpiryStart,
  reservedOfferCheckout.indexOf(
    "await releaseExpiredSessionReservation({",
    unreservedExpiryStart,
  ),
);
assert.match(
  unreservedExpiryBlock,
  /checkout\.sessions\.expire\(legacy\.id\)/,
  "Only the old unreserved accepted-offer session may be retired during migration.",
);
assert.match(
  offerCheckoutAttempt,
  /previousStripeSessionId/,
  "Expired Stripe sessions must rotate the accepted-offer idempotency generation.",
);
assert.match(buyerCheckoutRoute, /buyer_protection_selected/);
assert.match(
  attachedReservationMigration,
  /reservation\.stripe_session_id = v_order_stripe_session_id[\s\S]*set status = 'consumed'/,
);

const storeId = "00000000-0000-0000-0000-000000000001";
const initial = offerCheckoutAttemptId({ storeId, offerId: 101 });
const initialReplay = offerCheckoutAttemptId({ storeId, offerId: 101 });
const replacement = offerCheckoutAttemptId({
  storeId,
  offerId: 101,
  previousStripeSessionId: "cs_live_expired_one",
});
const secondReplacement = offerCheckoutAttemptId({
  storeId,
  offerId: 101,
  previousStripeSessionId: "cs_live_expired_two",
});
assert.equal(initial, initialReplay);
assert.notEqual(initial, replacement);
assert.notEqual(replacement, secondReplacement);
for (const attempt of [initial, replacement, secondReplacement]) {
  assert.match(
    attempt,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
}

for (const token of [
  "createHmac",
  "timingSafeEqual",
  "expiresAt",
  "payload.storeId !== params.storeId",
  "payload.offerId !== params.offerId",
]) {
  assert.ok(offerCheckoutToken.includes(token));
}

console.log(
  "Offer checkout scope, reservation, replay, expiration rotation, and idempotency simulations passed.",
);
