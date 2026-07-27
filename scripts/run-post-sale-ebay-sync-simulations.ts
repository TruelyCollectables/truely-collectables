import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientIdentityTestHelpers } from "../src/lib/client-identity";
import {
  ebayQuantityRetryDelaySeconds,
  selectLowestSafeEbayQuantity,
} from "../src/lib/ebay-quantity-sync-safety";
import { offerCheckoutAttemptId } from "../src/lib/offer-checkout-attempt";

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

assert.equal(
  clientIdentityTestHelpers.firstHeaderIp("203.0.113.10:443"),
  "203.0.113.10",
  "IPv4 proxy ports must be stripped without altering the address",
);
assert.equal(
  clientIdentityTestHelpers.firstHeaderIp("[2606:4700:4700::1111]:443"),
  "2606:4700:4700::1111",
  "IPv6 addresses must not be truncated at the first colon",
);
assert.equal(
  clientIdentityTestHelpers.firstHeaderIp(
    'for="[2606:4700:4700::1111]:443";proto=https',
  ),
  "2606:4700:4700::1111",
  "Forwarded IPv6 syntax must preserve the complete address",
);
assert.equal(
  clientIdentityTestHelpers.isPrivateOrReservedIp("10.0.0.1"),
  true,
);
assert.equal(
  clientIdentityTestHelpers.isPrivateOrReservedIp("2606:4700:4700::1111"),
  false,
);

const offerAttemptA = offerCheckoutAttemptId({
  storeId: "00000000-0000-0000-0000-000000000001",
  offerId: 101,
});
const offerAttemptAReplay = offerCheckoutAttemptId({
  storeId: "00000000-0000-0000-0000-000000000001",
  offerId: 101,
});
const offerAttemptB = offerCheckoutAttemptId({
  storeId: "00000000-0000-0000-0000-000000000001",
  offerId: 102,
});
assert.match(
  offerAttemptA,
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  "accepted offers must map to a valid deterministic checkout UUID",
);
assert.equal(offerAttemptA, offerAttemptAReplay);
assert.notEqual(offerAttemptA, offerAttemptB);

const migration = readFileSync(
  "supabase/migrations/20260726233000_post_sale_ebay_quantity_sync_outbox.sql",
  "utf8",
);
const attachedReservationMigration = readFileSync(
  "supabase/migrations/20260726234000_consume_attached_offer_checkout_reservations.sql",
  "utf8",
);
const cronRoute = readFileSync(
  "src/app/api/cron/ebay-store-fixed-price-sync/route.ts",
  "utf8",
);
const checkoutButton = readFileSync(
  "src/app/components/CheckoutButton.tsx",
  "utf8",
);
const clearCartOnSuccess = readFileSync(
  "src/components/ClearCartOnSuccess.tsx",
  "utf8",
);
const checkoutRoute = readFileSync("src/app/api/checkout/route.ts", "utf8");
const clientIdentity = readFileSync("src/lib/client-identity.ts", "utf8");
const offerCreateRoute = readFileSync(
  "src/app/api/offers/create/route.ts",
  "utf8",
);
const offerCheckoutRoute = readFileSync(
  "src/app/api/offers/buyer-checkout/route.ts",
  "utf8",
);
const reservedOfferCheckout = readFileSync(
  "src/lib/reserved-offer-checkout.ts",
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

const redirectBlockStart = checkoutButton.indexOf("if (data.url) {");
const redirectBlockEnd = checkoutButton.indexOf(
  "if (data.retryable !== true)",
  redirectBlockStart,
);
assert.ok(redirectBlockStart >= 0 && redirectBlockEnd > redirectBlockStart);
const redirectBlock = checkoutButton.slice(redirectBlockStart, redirectBlockEnd);
assert.ok(
  !redirectBlock.includes("clearCheckoutAttempt()"),
  "the browser must retain the attempt while the Stripe Session remains open",
);
assert.ok(
  checkoutRoute.includes('claim.requestStatus === "session_created"') &&
    checkoutRoute.includes("replayed: true"),
  "the cart server must replay an existing open Stripe Session",
);
assert.ok(
  clearCartOnSuccess.includes(
    "sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY)",
  ),
  "the attempt must clear only after the success page verifies payment",
);

assert.ok(
  clientIdentity.includes("if (!intelligenceRequired)") &&
    clientIdentity.includes("missing_public_ip_unchecked") &&
    clientIdentity.includes("private_or_reserved_ip_unchecked"),
  "optional TCOS IP intelligence must not block the Truely Collectables storefront",
);

assert.ok(
  offerCreateRoute.includes("ownerNotificationDelivered") &&
    offerCreateRoute.includes('console.error("Best-offer owner notification failed:"'),
  "a saved offer must remain successful when the owner email fails",
);

const offerReservePosition = reservedOfferCheckout.indexOf(
  "reserveCheckoutInventory({",
);
const offerStripeCreatePosition = reservedOfferCheckout.indexOf(
  "checkout.sessions.create(",
);
assert.ok(offerReservePosition >= 0 && offerStripeCreatePosition >= 0);
assert.ok(
  offerReservePosition < offerStripeCreatePosition,
  "accepted-offer inventory must be reserved before Stripe creates a payable session",
);
assert.ok(
  reservedOfferCheckout.includes("function replayResult(") &&
    reservedOfferCheckout.includes("if (claim.stripeSessionId)") &&
    reservedOfferCheckout.includes("return replayResult(existing, checkoutAttemptId)") &&
    reservedOfferCheckout.includes("replayed: true"),
  "accepted-offer retries must verify and replay the existing open Stripe Session",
);
assert.ok(
  reservedOfferCheckout.includes(
    "const stripeIdempotencyKey = `truely_offer_checkout_${params.storeId}_${checkoutAttemptId}`",
  ),
  "accepted-offer idempotency must not vary by shipping or protection choice",
);
assert.ok(
  offerCheckoutRoute.includes("startReservedOfferCheckout({") &&
    !offerCheckoutRoute.includes("checkout.sessions.create("),
  "the accepted-offer route must use the reservation-backed session lifecycle exclusively",
);
assert.ok(
  attachedReservationMigration.indexOf("reservation.stripe_session_id") <
    attachedReservationMigration.indexOf("select coalesce(sum(reservation.quantity)"),
  "an attached paid reservation must be consumed before the legacy unreserved decrement path",
);
assert.ok(
  attachedReservationMigration.includes("set status = 'consumed'") &&
    attachedReservationMigration.includes("insert into public.order_inventory_consumptions"),
  "accepted-offer reservation consumption must update both reservation and exactly-once consumption records",
);

console.log(
  "Post-sale eBay quantity, customer notification, checkout replay, storefront identity, offer submission, and accepted-offer reservation safety simulations passed.",
);
