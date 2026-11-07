import fs from "node:fs";

const files = {
  legacyListPage: fs.readFileSync("src/app/list/page.tsx", "utf8"),
  listLayout: fs.readFileSync("src/app/list/layout.tsx", "utf8"),
  intakePage: fs.readFileSync(
    "src/app/admin/pending-card-import/page.tsx",
    "utf8",
  ),
  intakeClient: fs.readFileSync(
    "src/app/admin/pending-card-import/PendingCardImportClient.tsx",
    "utf8",
  ),
  queue: fs.readFileSync("src/app/list/SimpleListingQueue.tsx", "utf8"),
  pendingApi: fs.readFileSync(
    "src/app/api/admin/pending-card-import/route.ts",
    "utf8",
  ),
  legacyProduct: fs.readFileSync(
    "src/app/admin/products/new/page.tsx",
    "utf8",
  ),
  shortcut: fs.readFileSync(
    "src/app/components/AdminInstaCompMobileShortcut.tsx",
    "utf8",
  ),
};

const checks = [
  [
    "/list redirects into the permanent card workspace",
    files.legacyListPage.includes('redirect("/admin/pending-card-import")'),
  ],
  [
    "legacy /list remains behind the admin-session layout",
    files.listLayout.includes("isValidAdminSessionValue") &&
      files.listLayout.includes("/admin/login"),
  ],
  [
    "card intake page includes the reusable package importer",
    files.intakePage.includes("PendingCardImportClient"),
  ],
  [
    "card intake page includes the listing queue",
    files.intakePage.includes("SimpleListingQueue"),
  ],
  [
    "card intake page links to InstaComp 2.0",
    files.intakePage.includes('href="/admin/instacomp/v2"'),
  ],
  [
    "legacy add-product route uses the permanent card workspace",
    files.legacyProduct.includes('redirect("/admin/pending-card-import")'),
  ],
  [
    "admin mobile quick tool links to Card Intake",
    files.shortcut.includes('href: "/admin/pending-card-import"') &&
      files.shortcut.includes('label: "Card Intake"'),
  ],
  [
    "package intake accepts an extracted folder",
    files.intakeClient.includes("webkitdirectory") &&
      files.intakeClient.includes("pending-import JSON manifest"),
  ],
  [
    "package intake exposes persistent live progress",
    files.intakeClient.includes("Live import status") &&
      files.intakeClient.includes('role="progressbar"') &&
      files.intakeClient.includes("aria-valuenow={percentage}"),
  ],
  [
    "package intake reports percentage and remaining card count",
    files.intakeClient.includes("{percentage}%") &&
      files.intakeClient.includes('label="Remaining"'),
  ],
  [
    "package intake reports cards currently processing",
    files.intakeClient.includes("Processing now") &&
      files.intakeClient.includes("activeCards"),
  ],
  [
    "package intake refreshes the listing queue after import",
    files.intakeClient.includes("tcos:simple-list-drafts-created"),
  ],
  [
    "pending import API is admin-only",
    files.pendingApi.includes('actor.type !== "admin"'),
  ],
  [
    "pending import API creates zero-dollar drafts",
    files.pendingApi.includes("price: 0") &&
      files.pendingApi.includes("quantity: 1") &&
      files.pendingApi.includes('status: "draft"'),
  ],
  [
    "purchase cost is excluded from pricing data",
    files.pendingApi.includes("excludedFromInstaComp: true") &&
      files.pendingApi.includes("excludedFromMarketComps: true"),
  ],
  [
    "listing queue supports selective publishing",
    files.queue.includes('type="checkbox"') &&
      files.queue.includes("toggleSelected") &&
      files.queue.includes('runAction("publish-website")'),
  ],
  [
    "eBay publishing still requires confirmation",
    files.queue.includes("Confirm marketplace publishing") &&
      files.queue.includes("Yes, list selected cards"),
  ],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`Card Intake & Listing audit failed ${failed}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Card Intake & Listing audit passed ${checks.length}/${checks.length} checks.`);
