import fs from "node:fs";

const page = fs.readFileSync(
  "src/app/admin/pending-card-import/page.tsx",
  "utf8",
);
const gateway = fs.readFileSync(
  "src/app/admin/pending-card-import/TcosListingGateway.tsx",
  "utf8",
);
const api = fs.readFileSync(
  "src/app/api/admin/card-listing-queue/route.ts",
  "utf8",
);
const channels = fs.readFileSync(
  "src/lib/tcos-marketplace-channels.ts",
  "utf8",
);

const checks = [
  ["card intake page uses TCOS listing gateway", page.includes("TcosListingGateway")],
  ["gateway renders front and back images", gateway.includes('side="Front"') && gateway.includes('side="Back"')],
  ["gateway supports full image preview", gateway.includes("PreviewImage") && gateway.includes('aria-modal="true"')],
  ["gateway supports one-card delete", gateway.includes("Delete card")],
  ["gateway supports bulk delete", gateway.includes("Delete selected") && gateway.includes("inventoryItemIds")],
  ["delete requires explicit confirmation", gateway.includes("Yes, delete permanently")],
  ["gateway exposes InstaComp 2.0", gateway.includes("Run InstaComp 2.0")],
  ["gateway supports batch InstaComp progress", gateway.includes("InstaCompProgress") && gateway.includes('role="progressbar"')],
  ["gateway offers website-only destination", gateway.includes("Truely Collectables only")],
  ["gateway offers website plus eBay", gateway.includes("Truely Collectables + eBay")],
  ["gateway has future marketplace connector slots", gateway.includes("connector slot") && channels.includes("whatnot") && channels.includes("comc")],
  ["queue API enriches front and back image URLs", api.includes("frontImageUrl") && api.includes("backImageUrl")],
  ["queue API is admin only", api.includes("requireAdmin(request)")],
  ["queue API runs stored-image InstaComp", api.includes("runInstaCompFast") && api.includes("imageFile")],
  ["queue API preserves title number and print-run rule", api.includes("buildCardListingTitle")],
  ["queue API blocks deletion of active inventory", api.includes("BLOCKED_DELETE_STATUSES")],
  ["queue API types bulk-delete IDs as strings", api.includes("new Set<string>(")],
  ["queue API deletes draft database records and images", api.includes('from("inventory_images")') && api.includes('from("inventory_items")') && api.includes('from("products")')],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`TCOS listing gateway audit failed ${failed}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`TCOS listing gateway audit passed ${checks.length}/${checks.length} checks.`);
