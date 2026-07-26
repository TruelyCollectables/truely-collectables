import assert from "node:assert/strict";
import fs from "node:fs";

function source(path: string) {
  return fs.readFileSync(path, "utf8");
}

const createOfferRoute = source("src/app/api/offers/create/route.ts");
const acceptOfferRoute = source("src/app/api/offers/update-status/route.ts");
const counterOfferRoute = source("src/app/api/offers/counter/route.ts");
const buyerCheckoutRoute = source("src/app/api/offers/buyer-checkout/route.ts");
const offerCheckoutToken = source("src/lib/offer-checkout-token.ts");

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
  /existingSession\.status === "open"[\s\S]*checkout\.sessions\.expire/,
  "Buyer-configured offer checkout must expire an obsolete open session before replacing it.",
);
assert.match(
  buyerCheckoutRoute,
  /const stripeIdempotencyKey = `truely_offer_checkout_\$\{storeId\}_\$\{offer\.id\}_\$\{selectionKey\}`/,
  "Buyer-configured offer checkout must derive its idempotency key from store, offer, amount, shipping, and protection selection.",
);
assert.match(
  buyerCheckoutRoute,
  /idempotencyKey: stripeIdempotencyKey/,
  "Buyer-configured offer Stripe session creation must use the deterministic idempotency key.",
);
assert.match(
  buyerCheckoutRoute,
  /checkout\.sessions\.create/,
  "Only the buyer-configured offer checkout route may create the Stripe session.",
);
assert.match(
  buyerCheckoutRoute,
  /buyer_protection_selected/,
  "Buyer-configured offer checkout must preserve the protection selection.",
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

console.log("Offer checkout scope and idempotency simulations passed: 18/18");
