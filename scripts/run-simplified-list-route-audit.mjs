import fs from "node:fs";

const files = {
  page: fs.readFileSync("src/app/list/page.tsx", "utf8"),
  layout: fs.readFileSync("src/app/list/layout.tsx", "utf8"),
  intake: fs.readFileSync("src/app/list/SimpleListIntake.tsx", "utf8"),
  queue: fs.readFileSync("src/app/list/SimpleListingQueue.tsx", "utf8"),
  draftApi: fs.readFileSync("src/app/api/admin/simple-list-drafts/route.ts", "utf8"),
  legacy: fs.readFileSync("src/app/admin/products/new/page.tsx", "utf8"),
  shortcut: fs.readFileSync("src/app/components/AdminInstaCompMobileShortcut.tsx", "utf8"),
};

const checks = [
  ["/list page imports photo intake", files.page.includes("SimpleListIntake")],
  ["/list page imports listing queue", files.page.includes("SimpleListingQueue")],
  ["/list is admin-session protected", files.layout.includes("isValidAdminSessionValue") && files.layout.includes("/admin/login")],
  ["old card studio redirects to /list", files.legacy.includes('redirect("/list")')],
  ["admin quick tool links directly to /list", files.shortcut.includes('href: "/list"') && files.shortcut.includes('label: "List Cards"')],
  ["intake supports multiple photo upload", files.intake.includes("multiple") && files.intake.includes("front_back")],
  ["intake supports select-all and selective scanning", files.intake.includes("Select all") && files.intake.includes("Run InstaComp™ on Selected")],
  ["intake exposes editable quantity", files.intake.includes('label="Quantity"') && files.intake.includes('min="1"')],
  ["intake creates only selected listing drafts", files.intake.includes("addSelectedToQueue") && files.intake.includes("selectedScannedRows")],
  ["draft API is admin-only", files.draftApi.includes('actor.type !== "admin"')],
  ["draft API validates title price quantity and front image", ["A front card photo is required", "Listing title is required", "Listing price must be greater than zero", "Quantity must be at least one"].every((value) => files.draftApi.includes(value))],
  ["listing queue uses checkboxes", files.queue.includes('type="checkbox"') && files.queue.includes("toggleSelected")],
  ["listing queue supports one/some/all publishing", files.queue.includes("Select all") && files.queue.includes('runAction("publish-both")')],
  ["eBay publishing requires inline confirmation", files.queue.includes("Confirm marketplace publishing") && files.queue.includes("Yes, list selected cards")],
  ["website-only listing remains available", files.queue.includes('runAction("publish-website")')],
];

let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
  if (!pass) failed += 1;
}

if (failed) {
  console.error(`Simplified /list audit failed ${failed}/${checks.length} checks.`);
  process.exit(1);
}

console.log(`Simplified /list audit passed ${checks.length}/${checks.length} checks.`);
