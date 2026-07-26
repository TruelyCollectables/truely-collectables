import assert from "node:assert/strict";
import fs from "node:fs";

function source(path: string) {
  return fs.readFileSync(path, "utf8");
}

const createOfferRoute = source("src/app/api/offers/create/route.ts");
const acceptOfferRoute = source("src/app/api/offers/update-status/route.ts");
const counterOfferRoute = source("src/app/api/offers/counter/route.ts");

for (const [name, route] of [
  ["public offer creation", createOfferRoute],
  ["accepted offer checkout", acceptOfferRoute],
  ["counteroffer checkout", counterOfferRoute],
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

assert.match(
  acceptOfferRoute,
  /const stripeIdempotencyKey = \[[\s\S]*"offer",[\s\S]*"accept",[\s\S]*String\(offer\.id\),[\s\S]*String\(Math\.round\(amount \* 100\)\)/,
  "Accepted-offer checkout must derive its Stripe idempotency key from the store, offer, and accepted amount.",
);
assert.match(
  acceptOfferRoute,
  /idempotencyKey: stripeIdempotencyKey/,
  "Accepted-offer Stripe session creation must use the deterministic idempotency key.",
);

assert.match(
  counterOfferRoute,
  /const stripeIdempotencyKey = \[[\s\S]*"offer",[\s\S]*"counter",[\s\S]*String\(offer\.id\),[\s\S]*String\(Math\.round\(amount \* 100\)\)/,
  "Counteroffer checkout must derive its Stripe idempotency key from the store, offer, and counter amount.",
);
assert.match(
  counterOfferRoute,
  /idempotencyKey: stripeIdempotencyKey/,
  "Counteroffer Stripe session creation must use the deterministic idempotency key.",
);

console.log("Offer checkout scope and idempotency simulations passed: 10/10");
