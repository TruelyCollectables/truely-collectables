import assert from "node:assert/strict";
import fs from "node:fs";
import {
  belongsToActiveStorePayment,
  isCompletedPaidCheckout,
} from "../src/lib/post-purchase-status";

const storeId = "00000000-0000-4000-8000-000000000001";
const paidSession = {
  mode: "payment" as const,
  status: "complete" as const,
  payment_status: "paid" as const,
  metadata: { store_id: storeId },
};

assert.equal(
  belongsToActiveStorePayment(paidSession, storeId),
  true,
  "A payment session for the active store must be eligible for verification.",
);
assert.equal(
  isCompletedPaidCheckout(paidSession),
  true,
  "Only a complete paid Stripe Checkout Session may confirm payment.",
);
assert.equal(
  isCompletedPaidCheckout({ ...paidSession, status: "open" }),
  false,
  "An open Checkout Session must not confirm payment.",
);
assert.equal(
  isCompletedPaidCheckout({ ...paidSession, payment_status: "unpaid" }),
  false,
  "An unpaid Checkout Session must not confirm payment.",
);
assert.equal(
  belongsToActiveStorePayment(
    { ...paidSession, metadata: { store_id: "other-store" } },
    storeId,
  ),
  false,
  "A cross-store Checkout Session must fail verification.",
);
assert.equal(
  belongsToActiveStorePayment({ ...paidSession, mode: "setup" }, storeId),
  false,
  "A setup-mode Checkout Session must not be treated as a purchase.",
);

const resolver = fs.readFileSync("src/lib/post-purchase-status.ts", "utf8");
const successPage = fs.readFileSync("src/app/success/page.tsx", "utf8");
const clearCart = fs.readFileSync("src/components/ClearCartOnSuccess.tsx", "utf8");
const accountOrdersRoute = fs.readFileSync(
  "src/app/api/account/orders/route.ts",
  "utf8",
);
const accountSession = fs.readFileSync(
  "src/app/account/account-session.ts",
  "utf8",
);
const buyerOrdersPage = fs.readFileSync(
  "src/app/account/orders/page.tsx",
  "utf8",
);
const buyerOrdersLayout = fs.readFileSync(
  "src/app/account/orders/layout.tsx",
  "utf8",
);
const navbar = fs.readFileSync("src/app/components/Navbar.tsx", "utf8");

assert.match(
  resolver,
  /getStripeLiveSecretKey[\s\S]*getStripeTestSecretKey/,
  "Post-purchase verification must be able to resolve configured live or test sessions.",
);
assert.match(
  resolver,
  /state:\s*"processing"[\s\S]*signed webhook is still finalizing/,
  "A verified payment that beats the webhook must show processing, not failure.",
);
assert.match(
  resolver,
  /\.eq\("stripe_session_id", session\.id\)/,
  "Order confirmation must be tied to the exact Stripe Checkout Session.",
);
assert.match(
  successPage,
  /paymentVerified\s*&&\s*postPurchase\.purchaseType === "cart"/,
  "Only a verified cart checkout may authorize cart clearing.",
);
assert.match(
  successPage,
  /<ClearCartOnSuccess clearOnLoad=\{shouldClearCart\}/,
  "The success page must pass the server-verified clearing decision.",
);
assert.match(
  successPage,
  /robots:\s*\{[\s\S]*index:\s*false/,
  "Stripe return pages must not be indexed.",
);
assert.match(
  successPage,
  /Payment Received/,
  "Webhook-race state must be explained to the buyer.",
);
assert.match(
  successPage,
  /Checkout Not Completed/,
  "Open or unpaid sessions must not display purchase confirmation.",
);
assert.doesNotMatch(
  clearCart,
  /URLSearchParams|success=true|params\.get\("success"\)/,
  "A forged query parameter must never clear cart storage.",
);
assert.match(
  clearCart,
  /if \(!clearOnLoad\) return/,
  "Cart storage may clear only after explicit verified authorization.",
);
assert.match(
  accountOrdersRoute,
  /\.eq\("account_id", account\.id\)/,
  "Buyer order history must remain account-scoped.",
);
assert.match(
  accountOrdersRoute,
  /from\("order_items"\)[\s\S]*\.in\("order_id", orderIds\)/,
  "Buyer history must load items only for the account-scoped order IDs.",
);
assert.match(
  accountOrdersRoute,
  /payment_status/,
  "Buyer history must include payment status.",
);
assert.match(
  accountOrdersRoute,
  /items:\s*itemsByOrderId\.get/,
  "Buyer history must return item detail with each order.",
);
assert.match(
  accountSession,
  /export async function fetchWithAccountSession[\s\S]*response\.status !== 401[\s\S]*getFreshAccountSession\(0, true\)[\s\S]*response = await fetch/,
  "Protected buyer requests must refresh and retry once after an unauthorized response.",
);
assert.match(
  buyerOrdersPage,
  /fetchWithAccountSession\("\/api\/account\/orders"/,
  "The standalone buyer orders page must authenticate through the refresh-and-retry session helper.",
);
assert.doesNotMatch(
  buyerOrdersPage,
  /Authorization:\s*`Bearer \$\{session\.access_token\}`/,
  "The standalone buyer orders page must not send a frozen local-storage token directly.",
);
assert.match(
  buyerOrdersPage,
  /Copy Tracking/,
  "Tracking references must be usable on mobile instead of plain table text only.",
);
assert.match(
  buyerOrdersPage,
  /order\.items\.map/,
  "The standalone buyer orders page must show purchased item detail.",
);
assert.match(
  buyerOrdersLayout,
  /index:\s*false/,
  "Buyer order history must stay out of search indexes.",
);
assert.ok(
  navbar.includes('{ href: "/account/orders", label: "Orders" }'),
  "Orders must be reachable from the public navigation.",
);

console.log("Post-purchase buyer-flow simulations passed.");
