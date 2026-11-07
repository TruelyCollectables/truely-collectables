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
const registryReceipt = fs.readFileSync(
  "src/lib/instacomp-registry-receipt.ts",
  "utf8",
);
const listingReadiness = fs.readFileSync(
  "src/lib/kingmaker-listing-readiness.ts",
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
  registryReceipt.includes('error.code = "CHECKLIST_IDENTITY_REQUIRED"') &&
    publishRoute.includes('code: error?.code || "PUBLISH_BLOCKED"'),
  "Publish failures must preserve the Checklist identity error code from the shared receipt helper.",
);
assert(
  publishRoute.indexOf("assertChecklistRegistryReceipt(metadata)") <
    publishRoute.indexOf("inventoryEngine.setStatus"),
  "Registry receipt validation must occur before inventory activation.",
);
assert(
  publishRoute.includes(
    'postInstaCompMacAccounting(\n        "/v1/kingmaker/accounting/listing-readiness"',
  ),
  "Publishing must re-check Mac-local physical inventory readiness at the final mutation boundary.",
);
assert(
  publishRoute.includes('"PHYSICAL_INVENTORY_NOT_READY"') &&
    publishRoute.includes('"MAC_INVENTORY_LEDGER_UNAVAILABLE"'),
  "Publishing must fail closed when physical inventory is not ready or the Mac ledger is unavailable.",
);
assert(
  publishRoute.indexOf('"/v1/kingmaker/accounting/listing-readiness"') <
    publishRoute.indexOf("inventoryEngine.setStatus"),
  "Mac physical inventory readiness must be verified before inventory activation.",
);
assert(
  publishRoute.includes("buildKingmakerListingReadiness({") &&
    publishRoute.includes('assertKingmakerListingReadiness(listingReadiness, "website")'),
  "Final website activation must use the shared KINGMAKER listing-readiness contract.",
);
assert(
  publishRoute.indexOf('assertKingmakerListingReadiness(listingReadiness, "website")') <
    publishRoute.indexOf("inventoryEngine.setStatus"),
  "Shared KINGMAKER listing readiness must pass before inventory activation.",
);
assert(
  listingReadiness.includes('"price_guide_not_checked_1_year"') &&
    listingReadiness.includes('label: "1-year eBay Price Guide checked"') &&
    listingReadiness.includes('"price_guide_not_checked_1_year",'),
  "The shared readiness contract must keep the 1-year eBay Price Guide as a core blocker.",
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
