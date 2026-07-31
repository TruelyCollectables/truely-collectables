import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BUYER_PROTECTION_CLAIM_DEADLINE_DAYS,
  BUYER_PROTECTION_MAX_COVERAGE,
  BUYER_PROTECTION_MAX_ITEM_SUBTOTAL,
  BUYER_PROTECTION_MIN_CLAIM_DAYS,
  BUYER_PROTECTION_POLICY_VERSION,
  BUYER_PROTECTION_RATE,
  buyerProtectionClaimWindow,
  evaluateBuyerProtectionClaimWindow,
  getBuyerProtectionEligibility,
  getBuyerProtectionQuote,
} from "../src/lib/buyer-protection";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

assert.equal(BUYER_PROTECTION_RATE, 0.1);
assert.equal(BUYER_PROTECTION_MAX_ITEM_SUBTOTAL, 20);
assert.equal(BUYER_PROTECTION_MAX_COVERAGE, 25);
assert.equal(BUYER_PROTECTION_MIN_CLAIM_DAYS, 7);
assert.equal(BUYER_PROTECTION_CLAIM_DEADLINE_DAYS, 21);
assert.match(BUYER_PROTECTION_POLICY_VERSION, /^truely-shipment-protection-v\d+/);

assert.deepEqual(
  getBuyerProtectionEligibility({
    shippingMethod: "STANDARD_ENVELOPE",
    itemSubtotal: 20,
    itemCount: 4,
  }),
  { eligible: true, coveredAmount: 20, reason: null },
);
assert.deepEqual(
  getBuyerProtectionQuote({
    shippingMethod: "STANDARD_ENVELOPE",
    itemSubtotal: 20,
    shippingAmount: 1.99,
    itemCount: 4,
  }),
  {
    eligible: true,
    coveredAmount: 21.99,
    reason: null,
    rate: 0.1,
    feeBase: 21.99,
    feeAmount: 2.2,
    itemSubtotal: 20,
    shippingAmount: 1.99,
  },
);
assert.equal(
  getBuyerProtectionEligibility({
    shippingMethod: "GROUND_ADVANTAGE",
    itemSubtotal: 10,
    itemCount: 1,
  }).eligible,
  false,
);
assert.equal(
  getBuyerProtectionEligibility({
    shippingMethod: "STANDARD_ENVELOPE",
    itemSubtotal: 20.01,
    itemCount: 1,
  }).eligible,
  false,
);

const shippedAt = "2026-07-01T12:00:00.000Z";
const window = buyerProtectionClaimWindow(shippedAt);
assert.equal(window.earliestClaimAt, "2026-07-08T12:00:00.000Z");
assert.equal(window.claimDeadlineAt, "2026-07-22T12:00:00.000Z");
assert.equal(
  evaluateBuyerProtectionClaimWindow({
    shippedAt,
    now: new Date("2026-07-08T11:59:59.999Z"),
  }).status,
  "too_early",
);
assert.equal(
  evaluateBuyerProtectionClaimWindow({
    shippedAt,
    now: new Date("2026-07-08T12:00:00.000Z"),
  }).status,
  "eligible",
);
assert.equal(
  evaluateBuyerProtectionClaimWindow({
    shippedAt,
    now: new Date("2026-07-22T12:00:00.000Z"),
  }).status,
  "eligible",
);
assert.equal(
  evaluateBuyerProtectionClaimWindow({
    shippedAt,
    now: new Date("2026-07-22T12:00:00.001Z"),
  }).status,
  "expired",
);

const cart = read("src/app/cart/CartClient.tsx");
assert.match(cart, /BuyerProtectionOption/);
assert.match(cart, /getBuyerProtectionQuote/);
assert.match(cart, /buyerProtection=\{resolvedBuyerProtection\}/);
assert.match(cart, /buyerProtectionAvailable=\{buyerProtectionAvailable\}/);

const protectionOption = read("src/app/cart/BuyerProtectionOption.tsx");
for (const token of [
  "Always add to qualifying orders",
  "Add to this order only",
  "Decline for this order and future orders",
  "storedConsentCurrent",
  "requiresReacceptance",
  "declineAcknowledged",
  "10%",
  "loss or damage",
]) {
  assert.ok(
    protectionOption.includes(token),
    `Protection choice must include ${token}.`,
  );
}

const checkout = read("src/app/api/checkout/route.ts");
for (const token of [
  "resolveBuyerProtectionSelection",
  'tcos_line_type: "buyer_protection"',
  "buyer_protection_selected",
  "buyer_protection_fee_base",
  "buyer_protection_policy_version",
  "buyer_protection_decline_acknowledged_at",
]) {
  assert.ok(checkout.includes(token), `Checkout must include ${token}.`);
}
assert.match(checkout, /buyerProtection\.feeAmount \* 100/);

const finalizer = read("src/lib/checkout-order-finalization.ts");
assert.ok(finalizer.includes("persistBuyerProtectionForOrder"));

const protectionOrder = read("src/lib/buyer-protection-order.ts");
for (const token of [
  'params.shippingMethod !== "STANDARD_ENVELOPE"',
  "calculateBuyerProtectionFee",
  "BUYER_PROTECTION_POLICY_VERSION",
  'covered_components: ["item_subtotal", "shipping"]',
  'non_reimbursable: ["buyer_protection_fee"]',
]) {
  assert.ok(
    protectionOrder.includes(token),
    `Paid protection must enforce ${token}.`,
  );
}

const offerCreate = read("src/app/api/offers/create/route.ts");
assert.ok(offerCreate.includes("resolveBuyerProtectionSelection"));
assert.ok(offerCreate.includes("buyerProtectionDeclineAcknowledged"));

const offerAccept = read("src/app/api/offers/update-status/route.ts");
const offerCounter = read("src/app/api/offers/counter/route.ts");
for (const source of [offerAccept, offerCounter]) {
  assert.ok(source.includes("createOfferCheckoutToken"));
  assert.ok(source.includes("Choose Shipping and Pay"));
  assert.doesNotMatch(
    source,
    /checkout\.sessions\.create/,
    "Admin offer decisions must not create a fixed Stripe session before the buyer chooses shipping and protection.",
  );
}

const offerBuyerCheckout = read("src/app/api/offers/buyer-checkout/route.ts");
const reservedOfferCheckout = read("src/lib/reserved-offer-checkout.ts");
for (const token of [
  "parseOfferCheckoutToken",
  "requestedShippingMethod",
  "buyerProtectionSelected",
  "buyerProtectionDeclineAcknowledged",
  "getBuyerProtectionQuote",
  'tcos_line_type: "buyer_protection"',
  "startReservedOfferCheckout",
]) {
  assert.ok(
    offerBuyerCheckout.includes(token),
    `Offer checkout must include ${token}.`,
  );
}
assert.ok(
  reservedOfferCheckout.includes("checkout.sessions.create"),
  "The reservation-backed accepted-offer helper must create the Stripe Session only after inventory is reserved.",
);
assert.ok(
  reservedOfferCheckout.indexOf("reserveCheckoutInventory") <
    reservedOfferCheckout.indexOf("checkout.sessions.create"),
  "Accepted-offer inventory must be reserved before Stripe creates a payable session.",
);

const claims = read("src/app/api/account/buyer-protection/claims/route.ts");
for (const token of [
  "evaluateBuyerProtectionClaimWindow",
  '"not_received" | "damaged"',
  "deliveredEvidencePresent",
  "buyer_protection_claims",
  'status: "claim_submitted"',
]) {
  assert.ok(claims.includes(token), `Claims API must include ${token}.`);
}

const adminClaims = read(
  "src/app/api/admin/buyer-protection/claims/update/route.ts",
);
for (const token of [
  "refundAmountCents",
  "covered_item_amount",
  'shipping_refunded: "true"',
  'protection_fee_refunded: "false"',
  'reimbursement_scope: "item_subtotal_and_shipping"',
  "idempotencyKey",
]) {
  assert.ok(
    adminClaims.includes(token),
    `Admin reimbursement must include ${token}.`,
  );
}

const originalMigration = read(
  "supabase/migrations/20260726070000_truely_buyer_protection.sql",
);
for (const token of [
  "account_buyer_protection_preferences",
  "order_buyer_protections",
  "buyer_protection_claims",
  "interval '7 days'",
  "interval '21 days'",
  "truely_lock_buyer_protection_claim_window",
  "truely_start_buyer_protection_claim_window",
  "enable row level security",
]) {
  assert.ok(originalMigration.includes(token), `Migration must include ${token}.`);
}
const v2Migration = read(
  "supabase/migrations/20260731040000_shipment_protection_v2.sql",
);
for (const token of [
  "fee_amount > 0 and fee_amount <= 2.50",
  "covered_item_amount > 0 and covered_item_amount <= 25",
  "reason in ('not_received', 'damaged')",
  "reimbursement_amount >= 0 and reimbursement_amount <= 25",
  "shipping_reimbursable set default true",
]) {
  assert.ok(v2Migration.includes(token), `V2 migration must include ${token}.`);
}

const policy = read("src/app/buyer-protection/page.tsx");
assert.ok(policy.includes("not insurance"));
assert.ok(policy.includes("does not waive"));
assert.ok(policy.includes("BUYER_PROTECTION_POLICY_VERSION"));

const shop = read("src/app/shop/page.tsx");
assert.ok(shop.includes("preferHighResolutionListingImage"));
assert.ok(shop.includes("quality={90}"));
assert.doesNotMatch(shop, /\bunoptimized\b/);

const inventoryEngine = read("src/modules/inventory/engine.ts");
assert.ok(
  inventoryEngine.includes("last_seen_at: new Date().toISOString()"),
  "The storefront image fix must not remove existing eBay freshness writes.",
);
assert.ok(
  inventoryEngine.includes("backfillInventoryItemsFromProducts"),
  "The storefront image fix must not replace the complete inventory engine.",
);

const duckAiWitness = read("src/app/admin/instacomp/DuckAiWitness.tsx");
assert.match(
  duckAiWitness,
  /useState<SavedWitness\[\]>\(loadSavedWitnesses\)/,
  "Duck.ai witness history must use lazy browser storage initialization.",
);
assert.doesNotMatch(
  duckAiWitness,
  /useEffect\(\(\) => \{\s*setSavedWitnesses\(loadSavedWitnesses\(\)\)/,
  "Duck.ai witness history must not synchronously set state inside an effect.",
);

console.log("Shipment Protection and storefront image simulations passed.");
