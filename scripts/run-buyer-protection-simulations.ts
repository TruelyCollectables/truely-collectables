import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BUYER_PROTECTION_CLAIM_DEADLINE_DAYS,
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_MAX_COVERAGE,
  BUYER_PROTECTION_MIN_CLAIM_DAYS,
  BUYER_PROTECTION_POLICY_VERSION,
  buyerProtectionClaimWindow,
  evaluateBuyerProtectionClaimWindow,
  getBuyerProtectionEligibility,
} from "../src/lib/buyer-protection";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

assert.equal(BUYER_PROTECTION_FEE, 0.75);
assert.equal(BUYER_PROTECTION_MAX_COVERAGE, 20);
assert.equal(BUYER_PROTECTION_MIN_CLAIM_DAYS, 7);
assert.equal(BUYER_PROTECTION_CLAIM_DEADLINE_DAYS, 21);
assert.match(BUYER_PROTECTION_POLICY_VERSION, /^truely-buyer-protection-v\d+/);

assert.deepEqual(
  getBuyerProtectionEligibility({
    shippingMethod: "STANDARD_ENVELOPE",
    itemSubtotal: 20,
    itemCount: 4,
  }),
  { eligible: true, coveredAmount: 20, reason: null },
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
assert.match(cart, /BUYER_PROTECTION_FEE/);
assert.match(cart, /buyerProtection=\{resolvedBuyerProtection\}/);

const protectionOption = read("src/app/cart/BuyerProtectionOption.tsx");
for (const token of [
  "Always add to qualifying orders",
  "Add to this order only",
  "Do not add protection",
  "storedConsentCurrent",
  "requiresReacceptance",
  "7 full days",
  "21 calendar days",
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
  "buyer_protection_policy_version",
  "buyer_protection_terms_accepted_at",
]) {
  assert.ok(checkout.includes(token), `Checkout must include ${token}.`);
}

const finalizer = read("src/lib/checkout-order-finalization.ts");
assert.ok(finalizer.includes("persistBuyerProtectionForOrder"));

const protectionOrder = read("src/lib/buyer-protection-order.ts");
for (const token of [
  'params.shippingMethod !== "STANDARD_ENVELOPE"',
  "BUYER_PROTECTION_FEE",
  "BUYER_PROTECTION_POLICY_VERSION",
  'non_reimbursable: ["shipping", "buyer_protection_fee"]',
]) {
  assert.ok(
    protectionOrder.includes(token),
    `Paid protection must enforce ${token}.`,
  );
}

const offerCreate = read("src/app/api/offers/create/route.ts");
assert.ok(offerCreate.includes("resolveBuyerProtectionSelection"));
assert.ok(offerCreate.includes("buyer_protection_selected"));

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
for (const token of [
  "parseOfferCheckoutToken",
  "requestedShippingMethod",
  "buyerProtectionSelected",
  'tcos_line_type: "buyer_protection"',
  "checkout.sessions.create",
]) {
  assert.ok(
    offerBuyerCheckout.includes(token),
    `Offer checkout must include ${token}.`,
  );
}

const claims = read("src/app/api/account/buyer-protection/claims/route.ts");
for (const token of [
  "evaluateBuyerProtectionClaimWindow",
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
  'shipping_refunded: "false"',
  'protection_fee_refunded: "false"',
  "idempotencyKey",
]) {
  assert.ok(
    adminClaims.includes(token),
    `Admin reimbursement must include ${token}.`,
  );
}

const migration = read(
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
  assert.ok(migration.includes(token), `Migration must include ${token}.`);
}

const policy = read("src/app/buyer-protection/page.tsx");
assert.ok(policy.includes("not insurance"));
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

console.log("Buyer Protection and storefront image simulations passed.");
