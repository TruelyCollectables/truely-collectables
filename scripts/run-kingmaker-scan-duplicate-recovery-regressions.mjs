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
const exactScan = fs.readFileSync(
  "src/app/api/kingmaker/instacomp-front-back-exact/route.ts",
  "utf8",
);
const repairRoute = fs.readFileSync(
  "src/app/api/account/seller/inventory/instacomp-orphan-scan-repair/route.ts",
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
  exactScan.includes('source: "kingmaker_raw_intake_preservation"') &&
    exactScan.indexOf('source: "kingmaker_raw_intake_preservation"') <
      exactScan.indexOf("const normalizedSides = await normalizeInstaCompSideImages"),
  "front/back uploads must be persisted before orientation or provider calls can fail",
);
assert.ok(
  exactScan.includes("const webOrientationTrusted =") &&
    exactScan.includes('params.webOrientation?.status === "completed"') &&
    exactScan.includes("frontRotation: webOrientationTrusted") &&
    exactScan.includes(": undefined"),
  "Mac-local orientation must remain available when the web orientation provider fails",
);
assert.equal(
  exactScan.includes('if (normalizedSides.orientation.status !== "completed")'),
  false,
  "web orientation failure must not block the Mac-local fallback before it runs",
);
assert.ok(
  repairRoute.includes("rows.length > 1") &&
    repairRoute.includes('.is("legacy_product_id", null)') &&
    repairRoute.includes('.is("card_uuid", null)') &&
    repairRoute.includes('instacomp.identityComplete !== true') &&
    repairRoute.includes("!rowsWithImages.has"),
  "orphan cleanup must archive only duplicate, unlinked, identity-incomplete rows with no saved images",
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
