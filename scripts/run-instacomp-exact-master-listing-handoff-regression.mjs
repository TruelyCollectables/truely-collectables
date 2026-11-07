import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const pendingPath = path.join(repoRoot, "src/app/kingmaker/pending/PendingClient.tsx");
const exactPagePath = path.join(
  repoRoot,
  "src/app/seller/admin/inventory/[inventoryItemId]/page.tsx",
);

const pending = fs.readFileSync(pendingPath, "utf8");
const exactPage = fs.readFileSync(exactPagePath, "utf8");

const assertions = [
  {
    label: "pending scan opens exact master listing",
    value: pending.includes('/seller/admin/inventory/${encodeURIComponent(card.inventoryItemId)}'),
  },
  {
    label: "pending scan no longer opens the bulk inventory workspace",
    value: !pending.includes("/seller/inventory?inventoryItemId="),
  },
  {
    label: "exact master listing page returns to pending cards",
    value: exactPage.includes('href="/kingmaker/pending"'),
  },
  {
    label: "exact master listing page no longer points back to the bulk workspace",
    value: !exactPage.includes('href="/seller/admin/inventory"'),
  },
];

const failures = assertions.filter((entry) => !entry.value);
if (failures.length) {
  console.error("Instacomp exact-master-listing handoff regression failed:");
  for (const failure of failures) {
    console.error(`- ${failure.label}`);
  }
  process.exit(1);
}

console.log("Instacomp exact-master-listing handoff regression passed.");
