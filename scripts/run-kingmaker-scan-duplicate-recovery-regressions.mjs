import assert from "node:assert/strict";
import fs from "node:fs";

const intake = fs.readFileSync(
  "src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts",
  "utf8",
);
const pendingApi = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/route.ts",
  "utf8",
);
const queueUi = fs.readFileSync(
  "src/app/kingmaker/KingmakerInstaCompQueue.tsx",
  "utf8",
);
const listingsUi = fs.readFileSync(
  "src/app/kingmaker/pending/PendingClient.tsx",
  "utf8",
);

assert.ok(
  intake.includes("const isRecoverableScannerStub ="),
  "duplicate scan intake must distinguish recoverable scanner stubs",
);
assert.ok(
  intake.includes("inventoryItemId = String(duplicate.id);") &&
    intake.includes('lastStage: "duplicate_scan_resume"'),
  "recoverable duplicate scans must resume the existing inventory row",
);
assert.ok(
  intake.includes("masterListingReviewHref") &&
    intake.includes("reviewHref: masterListingReviewHref"),
  "duplicate scan results must deep-link to the existing Master Listing",
);
assert.ok(
  pendingApi.includes("hasScanPairReceipt") &&
    pendingApi.includes("instaComp.imagePairSha256"),
  "scanner stubs with a preserved pair receipt must remain visible in verification",
);
assert.ok(
  pendingApi.includes("const requestedFocus") &&
    pendingApi.includes("String(row.id) === requestedFocus"),
  "Master Listings must support opening an exact inventory row by focus id",
);
assert.ok(
  queueUi.includes("card.result.reviewHref") &&
    queueUi.includes("Already in inventory — no duplicate created"),
  "scanner UI must open the existing row instead of a generic empty folder",
);
assert.ok(
  listingsUi.includes('locationParams.get("focus")') &&
    listingsUi.includes('searchParams.delete("focus")'),
  "Master Listings reloads must preserve focus until the operator changes folders",
);

console.log("KINGMAKER duplicate scan recovery regressions passed.");
