import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BUYER_PROTECTION_DECLINE_ACKNOWLEDGMENT,
  BUYER_PROTECTION_RATE,
  getBuyerProtectionQuote,
} from "../src/lib/buyer-protection";
import { selectRotatingAvailableHomepageItems } from "../src/lib/homepage-featured-rotation";

const inventory = Array.from({ length: 20 }, (_, index) => ({
  legacyProductId: index + 1,
  quantity: index % 5 === 0 ? 0 : 1,
  title: `Card ${index + 1}`,
}));

const firstRotation = selectRotatingAvailableHomepageItems(inventory, {
  count: 8,
  now: new Date("2026-07-30T18:00:00.000Z"),
});
const secondRotation = selectRotatingAvailableHomepageItems(inventory, {
  count: 8,
  now: new Date("2026-07-30T18:15:00.000Z"),
});

assert.equal(firstRotation.length, 8);
assert.equal(secondRotation.length, 8);
assert.ok(firstRotation.every((item) => item.quantity > 0));
assert.ok(secondRotation.every((item) => item.quantity > 0));
assert.notDeepEqual(
  firstRotation.map((item) => item.legacyProductId),
  secondRotation.map((item) => item.legacyProductId),
  "The featured-card order must rotate between time buckets.",
);

const quote = getBuyerProtectionQuote({
  shippingMethod: "STANDARD_ENVELOPE",
  itemSubtotal: 15,
  shippingAmount: 1.99,
  itemCount: 1,
});
assert.equal(BUYER_PROTECTION_RATE, 0.1);
assert.equal(quote.eligible, true);
assert.equal(quote.feeBase, 16.99);
assert.equal(quote.feeAmount, 1.7);
assert.equal(quote.coveredAmount, 16.99);

const maxQuote = getBuyerProtectionQuote({
  shippingMethod: "STANDARD_ENVELOPE",
  itemSubtotal: 20,
  shippingAmount: 1.99,
  itemCount: 4,
});
assert.equal(maxQuote.feeAmount, 2.2);
assert.equal(maxQuote.coveredAmount, 21.99);

const ineligible = getBuyerProtectionQuote({
  shippingMethod: "STANDARD_ENVELOPE",
  itemSubtotal: 20.01,
  shippingAmount: 1.99,
  itemCount: 1,
});
assert.equal(ineligible.eligible, false);
assert.match(BUYER_PROTECTION_DECLINE_ACKNOWLEDGMENT, /decline/i);
assert.match(BUYER_PROTECTION_DECLINE_ACKNOWLEDGMENT, /does not waive/i);

const checkoutButton = fs.readFileSync(
  "src/app/components/CheckoutButton.tsx",
  "utf8",
);
const checkoutRoute = fs.readFileSync(
  "src/app/api/checkout/route.ts",
  "utf8",
);
const serverResolver = fs.readFileSync(
  "src/lib/buyer-protection-server.ts",
  "utf8",
);
const claimsRoute = fs.readFileSync(
  "src/app/api/account/buyer-protection/claims/route.ts",
  "utf8",
);

assert.match(checkoutButton, /buyerProtectionDeclineAcknowledged/);
assert.match(checkoutButton, /declining optional Shipment Protection/);
assert.match(checkoutRoute, /buyerProtection\.feeAmount \* 100/);
assert.doesNotMatch(checkoutRoute, /BUYER_PROTECTION_FEE \* 100/);
assert.match(serverResolver, /Acknowledge the Shipment Protection opt-out/);
assert.match(claimsRoute, /"not_received" \| "damaged"/);
assert.match(claimsRoute, /reason === "not_received"/);

console.log("Storefront rotation and Shipment Protection simulations passed.");
