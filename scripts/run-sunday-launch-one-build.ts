import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateShipping,
  getStandardEnvelopeEligibility,
  resolveShippingMethod,
} from "../src/lib/shipping";

type Check = {
  name: string;
  passed: boolean;
  detail: string;
};

const checks: Check[] = [];

function check(name: string, condition: unknown, detail: string) {
  const passed = Boolean(condition);
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
}

function equal(name: string, actual: unknown, expected: unknown) {
  check(
    name,
    Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function contains(path: string, patterns: Array<string | RegExp>) {
  const content = source(path);
  for (const pattern of patterns) {
    const passed =
      typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
    check(
      `${path} contains ${String(pattern)}`,
      passed,
      `required launch contract is missing: ${String(pattern)}`,
    );
  }
}

function shippingChecks() {
  equal(
    "Standard Envelope one-card rate",
    calculateShipping({ itemCount: 1, subtotal: 10, method: "STANDARD_ENVELOPE" }),
    0.78,
  );
  equal(
    "Standard Envelope two-card rate",
    calculateShipping({ itemCount: 2, subtotal: 10, method: "STANDARD_ENVELOPE" }),
    1.07,
  );
  equal(
    "Standard Envelope three-card rate",
    calculateShipping({ itemCount: 3, subtotal: 20, method: "STANDARD_ENVELOPE" }),
    1.36,
  );
  equal(
    "Four cards exceed Standard Envelope weight",
    getStandardEnvelopeEligibility({ itemCount: 4, subtotal: 20 }).eligible,
    false,
  );
  equal(
    "Over-$20 Standard Envelope request falls back to Ground Advantage",
    resolveShippingMethod({
      requestedMethod: "STANDARD_ENVELOPE",
      itemCount: 1,
      subtotal: 20.01,
    }).method,
    "GROUND_ADVANTAGE",
  );
  equal(
    "Ground Advantage first five cards",
    calculateShipping({ itemCount: 5, subtotal: 100, method: "GROUND_ADVANTAGE" }),
    6.99,
  );
  equal(
    "Ground Advantage sixth card",
    calculateShipping({ itemCount: 6, subtotal: 100, method: "GROUND_ADVANTAGE" }),
    7.24,
  );
  equal(
    "Ground Advantage free-shipping threshold",
    calculateShipping({ itemCount: 6, subtotal: 149, method: "GROUND_ADVANTAGE" }),
    0,
  );
  equal(
    "Priority Mail first five cards",
    calculateShipping({ itemCount: 5, subtotal: 100, method: "PRIORITY_MAIL" }),
    12.99,
  );
  equal(
    "Priority Mail sixth card",
    calculateShipping({ itemCount: 6, subtotal: 100, method: "PRIORITY_MAIL" }),
    13.24,
  );
  equal(
    "Priority Mail free-shipping threshold",
    calculateShipping({ itemCount: 6, subtotal: 500, method: "PRIORITY_MAIL" }),
    0,
  );
}

function paymentAndInventoryChecks() {
  contains("src/app/api/checkout/route.ts", [
    "requireAvailableCartItems(cart)",
    "reserveCheckoutInventory",
    "attachStripeSessionToCheckoutReservation",
    "CHECKOUT_RESERVATION_MINUTES",
    'payment_method_types: ["card"]',
    "expires_at: stripeExpiresAt",
    "31 * 60",
    "idempotencyKey: stripeIdempotencyKey",
    "inventory_reservation_expires_at",
    "legacy_product_id: String(product.legacyProductId)",
    "checkout.sessions.expire(session.id)",
    "reservationMayBeReleased = false",
  ]);

  contains("src/lib/checkout-inventory-reservations.ts", [
    "tcos_reserve_checkout_inventory",
    "CHECKOUT_RESERVATION_MINUTES = 32",
    "consumeCheckoutReservationAfterSale",
    "decrementOrderInventoryOnce",
    "releaseCheckoutReservation",
    "Checkout reservation did not cover every cart line",
  ]);

  contains(
    "supabase/migrations/20260725010000_checkout_inventory_reservations.sql",
    [
      "create table if not exists public.checkout_inventory_reservations",
      "for update",
      "reservation.checkout_attempt_id <> p_checkout_attempt_id",
      "insufficient_inventory",
      "grant select, insert, update, delete",
      "grant execute on function public.tcos_reserve_checkout_inventory",
    ],
  );

  contains(
    "supabase/migrations/20260725170000_consume_checkout_reservations.sql",
    [
      "create table if not exists public.order_inventory_consumptions",
      "tcos_consume_checkout_reservation_after_sale",
      "tcos_decrement_order_inventory_once",
      "pg_advisory_xact_lock",
      "status = 'consumed'",
      "already_consumed",
    ],
  );

  contains("src/app/api/webhook/route.ts", [
    "claimStripeWebhookEvent",
    'event.type !== "checkout.session.completed"',
    "finalizeCheckoutOrder",
    "processStripeRefundEvent",
    "processStripeDisputeEvent",
    "finishStripeWebhookEvent",
    "failStripeWebhookEvent",
  ]);

  contains("src/lib/checkout-order-finalization.ts", [
    '.eq("stripe_session_id", session.id)',
    "getByLegacyProductIds",
    "consumeCheckoutReservationAfterSale",
    "decrementOrderInventoryOnce",
    "syncEbayQuantityAfterSale",
    'status: "paid_inventory_review"',
    "existingProductIds",
    "createTransactionEvidenceReport",
  ]);

  contains("src/lib/stripe-reconciliation.ts", [
    'mismatch_type: expectedCategory ? "stripe_only"',
    'severity: category === "charge" ? "critical"',
    "Stripe ${category} has no TCOS record",
    "stripe_reconciliation_items",
  ]);

  contains("src/app/api/cron/stripe-reconciliation/route.ts", [
    "validCronAuthorization",
    "reconcileStripeDaily",
    'source: "scheduled_cron"',
  ]);
}

function inventorySyncChecks() {
  contains("src/app/api/ebay/full-sync/route.ts", [
    "const MAX_BATCHES = 25",
    "importEbayListingsPage",
    'message: "Full eBay sync completed"',
    "policyNeedsReview",
    "policyBlocked",
    "markedSold",
  ]);

  contains("src/lib/ebay-sync.ts", [
    "upsertFromEbayListing",
    "markEbayListingInactive",
    'reason: "missing_sku"',
    'reason: "invalid_listing_price"',
  ]);

  contains("src/modules/inventory/engine.ts", [
    "last_seen_at: new Date().toISOString()",
    "getEbayReconciliationStatus",
    'issues.push("stale_sync")',
  ]);

  contains("src/proxy.ts", [
    'if (pathname.startsWith("/api/ebay")) return true',
    'url.hostname = "truelycollectables.com"',
  ]);
}

function searchVisibilityChecks() {
  contains("src/app/robots.ts", [
    'allow: ["/", "/shop", "/product/"]',
    '"/admin/"',
    '"/api/"',
    "sitemap:",
  ]);
  contains("src/app/sitemap.ts", [
    "inventoryEngine.listAvailable()",
    "`${origin}/product/${product.legacyProductId}`",
    "images: image ? [image] : undefined",
  ]);
  contains("src/app/layout.tsx", [
    "GOOGLE_SITE_VERIFICATION",
    '"@type": "Organization"',
    "metadataBase",
  ]);
  contains("src/app/shop/page.tsx", [
    'canonical: "/shop"',
    'title: "Shop Sports Cards"',
  ]);
  contains("src/app/product/[id]/page.tsx", [
    '"@type": "Product"',
    '"@type": "Offer"',
    "canonicalPath",
    "https://schema.org/InStock",
  ]);
  contains("src/app/cart/page.tsx", [
    "index: false",
    "follow: false",
  ]);
}

shippingChecks();
paymentAndInventoryChecks();
inventorySyncChecks();
searchVisibilityChecks();

const failed = checks.filter((item) => !item.passed);
const output = {
  suite: "truely-sunday-launch-one-build-v2",
  checkedAt: new Date().toISOString(),
  passed: failed.length === 0,
  total: checks.length,
  failed: failed.length,
  checks,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(output, null, 2));
} else {
  for (const item of checks) {
    console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name}`);
  }
  console.log(`Sunday launch contract passed: ${checks.length}/${checks.length}`);
}
