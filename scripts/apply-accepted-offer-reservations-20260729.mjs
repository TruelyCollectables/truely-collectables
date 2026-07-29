import fs from "node:fs";
import { execFileSync } from "node:child_process";

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, content) {
  const directory = filePath.split("/").slice(0, -1).join("/");
  if (directory) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`);
}

function fromAuditPr(filePath) {
  return run("git", ["show", `origin/pr142:${filePath}`]);
}

function replaceOrThrow(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Could not locate ${label}.`);
  return source.replace(before, after);
}

for (const filePath of [
  "src/lib/offer-checkout-attempt.ts",
  "src/lib/reserved-offer-checkout.ts",
  "src/lib/checkout-inventory-reservations.ts",
  "src/app/api/offers/buyer-checkout/route.ts",
  "scripts/run-offer-checkout-idempotency-simulations.ts",
  "supabase/migrations/20260726234000_consume_attached_offer_checkout_reservations.sql",
  "supabase/migrations/20260727141000_hold_attached_checkout_reservations.sql",
  "supabase/migrations/20260727144000_preserve_reserved_product_identity.sql",
]) {
  write(filePath, fromAuditPr(filePath));
}

const finalizationPath = "src/lib/checkout-order-finalization.ts";
let finalization = read(finalizationPath);
finalization = replaceOrThrow(
  finalization,
  '        checkoutType === "cart" && checkoutAttemptId\n',
  "        checkoutAttemptId\n",
  "reserved checkout consumption condition",
);
write(finalizationPath, finalization);

const webhookPath = "src/app/api/webhook/route.ts";
let webhook = read(webhookPath);
webhook = replaceOrThrow(
  webhook,
  'import { finalizeCheckoutOrder } from "../../../lib/checkout-order-finalization";\n',
  [
    'import { finalizeCheckoutOrder } from "../../../lib/checkout-order-finalization";',
    'import { releaseCheckoutReservationForExpiredSession } from "../../../lib/checkout-inventory-reservations";',
    "",
  ].join("\n"),
  "webhook reservation import",
);
webhook = replaceOrThrow(
  webhook,
  '    if (event.type === "account.updated") {',
  [
    '    if (event.type === "checkout.session.expired") {',
    "      const session = event.data.object as Stripe.Checkout.Session;",
    "      const metadata = session.metadata || {};",
    "",
    '      if (session.mode !== "payment" || metadata.store_id !== storeId) {',
    "        await finishStripeWebhookEvent({",
    "          ...journal,",
    '          status: "ignored",',
    '          metadata: { outcome: "expired_session_not_store_payment" },',
    "        });",
    "        return NextResponse.json({ received: true });",
    "      }",
    "",
    "      const released = await releaseCheckoutReservationForExpiredSession({",
    "        supabase,",
    "        storeId,",
    "        stripeSessionId: session.id,",
    "      });",
    "      await finishStripeWebhookEvent({",
    "        ...journal,",
    '        status: "processed",',
    "        metadata: {",
    '          outcome: "expired_checkout_reservation_released",',
    "          released_reservation_count: released.releasedCount,",
    "        },",
    "      });",
    "      return NextResponse.json({ received: true });",
    "    }",
    "",
    '    if (event.type === "account.updated") {',
  ].join("\n"),
  "expired Checkout Session webhook branch",
);
write(webhookPath, webhook);

const livePaymentPath = "src/lib/live-payment-launch-core.ts";
let livePayment = read(livePaymentPath);
livePayment = replaceOrThrow(
  livePayment,
  '  "checkout.session.completed",\n',
  '  "checkout.session.completed",\n  "checkout.session.expired",\n',
  "required expired Checkout Session event",
);
write(livePaymentPath, livePayment);

const simulation = `import assert from "node:assert/strict";
import fs from "node:fs";
import { offerCheckoutAttemptId } from "../src/lib/offer-checkout-attempt";

const source = (filePath: string) => fs.readFileSync(filePath, "utf8");
const offerRoute = source("src/app/api/offers/buyer-checkout/route.ts");
const helper = source("src/lib/reserved-offer-checkout.ts");
const reservations = source("src/lib/checkout-inventory-reservations.ts");
const finalization = source("src/lib/checkout-order-finalization.ts");
const webhook = source("src/app/api/webhook/route.ts");
const livePayment = source("src/lib/live-payment-launch-core.ts");
const consumeMigration = source(
  "supabase/migrations/20260726234000_consume_attached_offer_checkout_reservations.sql",
);
const holdMigration = source(
  "supabase/migrations/20260727141000_hold_attached_checkout_reservations.sql",
);
const identityMigration = source(
  "supabase/migrations/20260727144000_preserve_reserved_product_identity.sql",
);

for (const contract of [
  "startReservedOfferCheckout({",
  "reservationExpiresAt",
  "ReservedOfferCheckoutError",
]) {
  assert.ok(offerRoute.includes(contract), contract);
}
assert.equal(offerRoute.includes("checkout.sessions.create("), false);

const reserveIndex = helper.indexOf("reserveCheckoutInventory({");
const stripeIndex = helper.indexOf("checkout.sessions.create(");
assert.ok(reserveIndex >= 0 && stripeIndex > reserveIndex);
for (const contract of [
  "stripeExpiresAt >= reservation.expiresAtUnix",
  "attachStripeSessionToCheckoutReservation",
  "expectedCount: reservation.rows.length",
  'legacy.status === "open" && legacyAttemptId',
  "return replayResult(legacy, legacyAttemptId)",
  'legacy.status === "open" && !legacyAttemptId',
  "checkout.sessions.expire(legacy.id)",
  "releaseCheckoutReservationForExpiredSession",
  "generation < 5",
]) {
  assert.ok(helper.includes(contract), contract);
}

for (const contract of [
  "releaseCheckoutReservationForExpiredSession",
  "expectedCount?: number",
  "Checkout reservation returned the wrong products",
]) {
  assert.ok(reservations.includes(contract), contract);
}
assert.ok(finalization.includes("checkoutAttemptId"));
assert.ok(finalization.includes("? await consumeCheckoutReservationAfterSale"));
assert.equal(
  finalization.includes('checkoutType === "cart" && checkoutAttemptId'),
  false,
);

for (const contract of [
  'event.type === "checkout.session.expired"',
  "metadata.store_id !== storeId",
  "releaseCheckoutReservationForExpiredSession({",
  "expired_checkout_reservation_released",
]) {
  assert.ok(webhook.includes(contract), contract);
}
assert.ok(livePayment.includes('"checkout.session.expired"'));

for (const migration of [consumeMigration, holdMigration, identityMigration]) {
  assert.ok(/^begin;/im.test(migration));
  assert.ok(/^commit;/im.test(migration));
}
const reservationLookup = consumeMigration.indexOf(
  "reservation.stripe_session_id = v_order_stripe_session_id",
);
const consumptionUpdate = consumeMigration.indexOf("set status = 'consumed'");
assert.ok(reservationLookup >= 0 && consumptionUpdate > reservationLookup);
assert.ok(holdMigration.includes("stripe_session_id is not null"));
assert.ok(holdMigration.includes("reservation_cart_session_attached"));
assert.ok(identityMigration.includes("on delete restrict"));

const storeId = "00000000-0000-0000-0000-000000000001";
const initial = offerCheckoutAttemptId({ storeId, offerId: 55 });
const replay = offerCheckoutAttemptId({ storeId, offerId: 55 });
const rotated = offerCheckoutAttemptId({
  storeId,
  offerId: 55,
  previousStripeSessionId: "cs_expired_example",
});
assert.equal(initial, replay);
assert.notEqual(initial, rotated);
assert.ok(
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(
    initial,
  ),
);

console.log(
  "Accepted-offer reservation, session replay, signed expiration release, and paid consumption regressions passed.",
);
`;
write("scripts/run-accepted-offer-reservation-simulations.ts", simulation);

const packagePath = "package.json";
const packageJson = JSON.parse(read(packagePath));
packageJson.scripts["simulate:accepted-offer-reservations"] =
  "node --import tsx scripts/run-accepted-offer-reservation-simulations.ts";
write(packagePath, JSON.stringify(packageJson, null, 2));

console.log("Applied accepted-offer inventory reservation safety changes.");
