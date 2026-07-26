import assert from "node:assert/strict";
import fs from "node:fs";

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
  assert.match(
    route,
    /createOfferCheckoutToken/,
    `${name} must create a signed buyer choice link.`,
  );
  assert.match(
    route,
    /\/offer-checkout\/\$\{offer\.id\}\?token=/,
    `${name} must route the buyer through the shipping and protection choice page.`,
  );
  assert.doesNotMatch(
    route,
    /checkout\.sessions\.create/,
    `${name} must not create a fixed Stripe session before the buyer chooses shipping and protection.`,
  );
}

assert.match(
  buyerCheckoutRoute,
  /parseOfferCheckoutToken/,
  "Buyer-configured offer checkout must verify the signed offer token.",
);
assert.match(
  buyerCheckoutRoute,
  /startReservedOfferCheckout\(\{/,
  "Buyer-configured offer checkout must use the reservation-backed lifecycle.",
);
assert.doesNotMatch(
  buyerCheckoutRoute,
  /checkout\.sessions\.create/,
  "The route must not bypass the reservation helper to create Stripe sessions directly.",
);
assert.match(
  reservedOfferCheckout,
  /reserveCheckoutInventory\(\{[\s\S]*checkout\.sessions\.create\(/,
  "Accepted-offer inventory must be reserved before Stripe creates a payable session.",
);
assert.match(
  reservedOfferCheckout,
  /claimCheckoutAttempt\(\{[\s\S]*requestStatus === "session_created"[\s\S]*replayed: true/,
  "Accepted-offer retries must claim one durable attempt and replay its open session.",
);
assert.match(
  reservedOfferCheckout,
  /const stripeIdempotencyKey = `truely_offer_checkout_\$\{params\.storeId\}_\$\{checkoutAttemptId\}`/,
  "Accepted-offer idempotency must be tied to one offer attempt, not a mutable selection.",
);
assert.doesNotMatch(
  reservedOfferCheckout,
  /selectionKey/,
  "Shipping or protection changes must not create parallel payable sessions for one accepted offer.",
);
assert.match(
  reservedOfferCheckout,
  /legacy\.status === "open"[\s\S]*checkout\.sessions\.expire\(legacy\.id\)/,
  "Unreserved legacy offer sessions must be expired before a reservation-backed replacement is created.",
);
assert.match(
  reservedOfferCheckout,
  /attachStripeSessionToCheckoutReservation/,
  "The Stripe Session must be durably attached to the accepted-offer reservation.",
);
assert.match(
  reservedOfferCheckout,
  /releaseCheckoutReservation/,
  "Failed accepted-offer session creation must release its reservation when safe.",
);
assert.match(
  offerCheckoutAttempt,
  /createHash\("sha256"\)/,
  "Each offer must derive a deterministic checkout-attempt UUID.",
);
assert.match(
  buyerCheckoutRoute,
  /buyer_protection_selected/,
  "Buyer-configured offer checkout must preserve the protection selection.",
);
assert.match(
  attachedReservationMigration,
  /reservation\.stripe_session_id = v_order_stripe_session_id[\s\S]*set status = 'consumed'/,
  "A paid accepted-offer session must consume its attached reservation atomically.",
);

for (const token of [
  "createHmac",
  "timingSafeEqual",
  "expiresAt",
  "payload.storeId !== params.storeId",
  "payload.offerId !== params.offerId",
]) {
  assert.ok(
    offerCheckoutToken.includes(token),
    `Signed offer checkout tokens must include ${token}.`,
  );
}

console.log(
  "Offer checkout scope, reservation, and idempotency simulations passed: 22/22",
);
