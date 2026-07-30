import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  proxy: await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
  template: await readFile(
    new URL("../src/app/admin/template.tsx", import.meta.url),
    "utf8",
  ),
  refresh: await readFile(
    new URL("../src/app/api/admin/session/refresh/route.ts", import.meta.url),
    "utf8",
  ),
  reconcile: await readFile(
    new URL(
      "../src/app/api/admin/reconcile-platform-fees/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  refund: await readFile(
    new URL("../src/app/api/orders/refund/route.ts", import.meta.url),
    "utf8",
  ),
  ledger: await readFile(
    new URL("../src/lib/seller-payout-ledger.ts", import.meta.url),
    "utf8",
  ),
};

assert(
  files.proxy.includes('hostname.endsWith(".vercel.app")') &&
    files.proxy.includes("canonicalAdminHostRedirect"),
  "Admin browser routes must canonicalize Vercel aliases to the customer domain.",
);
assert(
  files.proxy.includes(
    "appendAdminSessionCookies(response.headers, req.nextUrl.hostname, sessionValue)",
  ),
  "Every valid protected request must refresh the admin session cookie.",
);
assert(
  files.template.includes('/api/admin/session/refresh') &&
    files.refresh.includes("createAdminSessionValue") &&
    files.refresh.includes("appendAdminSessionCookies"),
  "The admin shell must actively rotate the durable signed session.",
);
assert(
  files.template.includes('/api/admin/reconcile-platform-fees') &&
    files.reconcile.includes('.is("seller_account_id", null)') &&
    files.reconcile.includes('.delete()'),
  "Admin startup must remove legacy direct-store platform fee rows.",
);
assert(
  files.template.includes('/api/orders/refund') &&
    files.template.includes("Issue full refund and cancel order") &&
    files.template.includes("minimum 10"),
  "The orders workspace must expose a deliberate full-refund control with a reason.",
);
assert(
  files.refund.includes("stripe.refunds.create") &&
    files.refund.includes("idempotencyKey") &&
    files.refund.includes('fulfillment_status: "cancelled"') &&
    files.refund.includes('inventory_restore: "false"'),
  "Refunds must be idempotent, cancel fulfillment, and avoid unsafe automatic relisting.",
);
assert(
  files.refund.includes("order.shipped_at") &&
    files.refund.includes('fulfillment_status || "").toLowerCase() === "shipped"'),
  "The unfulfilled-order refund control must block already-shipped orders.",
);
assert(
  files.ledger.includes(
    "const feeItems = params.orderItems.filter((item) => item.seller_account_id)",
  ) &&
    files.ledger.includes('.is("seller_account_id", null)') &&
    files.ledger.includes("TCOS marketplace seller-owned checkout items only"),
  "TCOS platform fees must apply only to seller-owned marketplace items, never direct store inventory.",
);

console.log("Admin session, refund, and marketplace fee contract passed.");
