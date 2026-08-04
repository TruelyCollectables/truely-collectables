import fs from "node:fs";
import assert from "node:assert/strict";

const publishRoute = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/publish/route.ts",
  "utf8",
);
const readinessRoute = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/readiness/route.ts",
  "utf8",
);
const dashboard = fs.readFileSync(
  "src/app/seller/instacomp-pending/ChecklistReadinessDashboard.tsx",
  "utf8",
);
const layout = fs.readFileSync(
  "src/app/seller/instacomp-pending/layout.tsx",
  "utf8",
);

assert(
  publishRoute.includes("assertChecklistRegistryReceipt(metadata)"),
  "Publishing must assert a persisted Checklist Registry receipt.",
);
assert(
  publishRoute.includes("CHECKLIST_IDENTITY_REQUIRED"),
  "Publish failures must preserve the Checklist identity error code.",
);
assert(
  publishRoute.indexOf("assertChecklistRegistryReceipt(metadata)") <
    publishRoute.indexOf("inventoryEngine.setStatus"),
  "Registry receipt validation must occur before inventory activation.",
);
assert(
  readinessRoute.includes("checklistRegistryReceiptBlockers"),
  "Readiness must use the same server receipt blockers as publishing.",
);
assert(
  dashboard.includes("runVerifiedInstaCompPricingBatch"),
  "Dashboard retries must use the shared verified-pricing client.",
);
assert(
  !dashboard.includes('/inventory/instacomp"'),
  "Dashboard must never call the unverified pricing route.",
);
assert(
  layout.includes("ChecklistReadinessDashboard"),
  "Pending Listings must mount the Registry readiness dashboard.",
);

console.log("InstaComp publish-readiness contract certified.");
