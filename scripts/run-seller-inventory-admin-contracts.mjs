import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = {
  accountLayout: await readFile("src/app/account/layout.tsx", "utf8"),
  accountBar: await readFile(
    "src/app/account/AccountSellerAdminBar.tsx",
    "utf8",
  ),
  accountLogin: await readFile("src/app/account/login/page.tsx", "utf8"),
  page: await readFile("src/app/seller/admin/inventory/page.tsx", "utf8"),
  route: await readFile(
    "src/app/api/account/seller/inventory-admin/route.ts",
    "utf8",
  ),
  access: await readFile("src/lib/seller-inventory-access.ts", "utf8"),
};

assert.match(files.accountLayout, /AccountSellerAdminBar/);
assert.match(files.accountBar, /href="\/seller\/admin\/inventory"/);
assert.match(files.accountBar, /Inventory Admin/);
assert.match(files.accountLogin, /safeAccountReturnPath/);
assert.match(files.accountLogin, /candidate\.startsWith\("\/\/"\)/);
assert.match(files.accountLogin, /router\.push\(safeAccountReturnPath\(\)\)/);
assert.match(files.page, /Save Selected Edits/);
assert.match(files.page, /Apply Values to/);
assert.match(files.page, /Edit complete listing/);
assert.match(files.page, /Open eBay/);
assert.match(files.page, /fetchWithAccountSession/);
assert.match(files.route, /MAX_BULK_EDITS = 100/);
assert.match(files.route, /canManageSellerInventoryRow/);
assert.match(files.route, /isStoreOwnerSellerAccount/);
assert.match(files.route, /publishesToEbay: false/);
assert.match(files.route, /Sold or reserved inventory is read-only/);
assert.match(files.access, /sales@truelycollectables\.com/);
assert.match(files.access, /params\.sellerAccountId === params\.accountId/);

console.log("Seller inventory admin contracts passed.");
