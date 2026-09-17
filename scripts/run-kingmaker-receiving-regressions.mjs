import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const purchases = read("src/app/api/account/seller/instacomp-purchases/route.ts");
const match = read("src/app/api/account/seller/instacomp-purchase-match/route.ts");
const receive = read("src/app/api/account/seller/instacomp-purchase-receive/route.ts");
const linkPurchase = read("src/app/api/account/seller/instacomp-purchase-link/route.ts");
const disposition = read("src/app/api/account/seller/instacomp-inventory-disposition/route.ts");
const adminReceive = read("src/app/api/admin/market-intel/purchases/[id]/receive/route.ts");
const internalReceive = read("src/app/api/internal/pending-receiving/route.js");
const shell = read("src/app/kingmaker/KingmakerShell.tsx");
const receiving = read("src/app/kingmaker/receiving/ReceivingClient.tsx");

assert.match(purchases, /2026-09-16/);
assert.match(purchases, /\/pending-purchases/);
assert.match(purchases, /\/purchase-intake-sync/);
assert.match(match, /\/purchase-match-bulk/);
assert.match(match, /assertOwnedInventoryIds/);
assert.match(match, /seller_account_id/);
assert.match(receive, /verified physical scan and exact purchase match are required/i);
assert.match(receive, /inventory_lifecycle/);
assert.match(receive, /acquisitionItemId/);
assert.ok(
  receive.indexOf('if (!item) return Response.json({ error: "Inventory item not found." }') <
    receive.indexOf('postInstaCompMacAccounting("/v1/kingmaker/accounting/receive"'),
  "seller inventory authorization must happen before Mac-local receive mutation",
);
assert.ok(
  linkPurchase.indexOf('if (!item) return Response.json({ error: "Inventory item not found." }') <
    linkPurchase.indexOf('postInstaCompMacAccounting("/v1/kingmaker/accounting/link-existing"'),
  "existing-inventory link must authorize storefront ownership before Mac-local mutation",
);
assert.ok(
  disposition.indexOf('if (!item) return Response.json({ error: "Inventory item not found." }') <
    disposition.indexOf('postInstaCompMacAccounting("/v1/kingmaker/accounting/inventory-disposition"'),
  "inventory disposition must authorize storefront ownership before Mac-local mutation",
);
assert.doesNotMatch(adminReceive, /\.from\("tcos_mi_purchase_lots"\)/);
assert.match(adminReceive, /Receiving is scan-gated in KINGMAKER/);
assert.doesNotMatch(internalReceive, /\.update\(\{ status: "received"/);
assert.match(internalReceive, /SCAN_GATED_RECEIVING_REQUIRED/);
assert.match(shell, /href: "\/kingmaker\/receiving"/);
assert.match(receiving, /Receive → Resale/);
assert.match(receiving, /Receive → Investment Stash/);
assert.match(receiving, /instacomp-purchase-match/);
assert.match(receiving, /instacomp-purchase-receive/);

console.log("KINGMAKER receiving web regression contract: PASS");
