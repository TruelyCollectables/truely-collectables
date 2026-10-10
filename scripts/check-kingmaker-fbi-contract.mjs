import fs from "node:fs";

const files = {
  page: fs.readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8"),
  shim: fs.readFileSync("src/app/api/account/seller/inventory/instacomp-front-back/route.ts", "utf8"),
  scan: fs.readFileSync("src/app/api/kingmaker/instacomp-front-back-exact/route.ts", "utf8"),
  intake: fs.readFileSync("src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts", "utf8"),
  edit: fs.readFileSync("src/app/api/account/seller/inventory/instacomp-card-edit/route.ts", "utf8"),
  status: fs.readFileSync("src/app/api/account/seller/inventory/instacomp-job-status/route.ts", "utf8"),
};

const failures = [];
const requireText = (file, value, reason) => {
  if (!files[file].includes(value)) failures.push(`${file}: ${reason}`);
};
const forbidText = (file, value, reason) => {
  if (files[file].includes(value)) failures.push(`${file}: ${reason}`);
};

requireText("page", "Retry This Card", "failed cards need an attached retry action");
requireText("page", "Replace Manual Identity with AI", "manual identity replacement must be explicit");
requireText("page", "job?.error", "durable per-card errors must be displayed");
forbidText("page", "failed: 100", "failures must never be shown as fake 100 percent completion");
forbidText("page", "window.setTimeout(() => setStage", "progress must not be simulated by timers");
requireText("shim", "runKingmakerExactFrontBack", "legacy route must delegate to the exact Mac route");
requireText("scan", 'validFile(value("frontImage"), "front")', "front file must be accepted");
requireText("scan", 'validFile(value("backImage"), "back")', "back file must be accepted");
requireText("scan", "DUPLICATE_IMAGE_BYTES", "front and back bytes must be distinct");
requireText("scan", "manualIdentityLocked", "seller-corrected identities must be protected");
requireText("scan", "runKingmakerMacScan", "front/back identity scan must use the Mac authority");
requireText("scan", "searchMarket: false", "identity scan must not block on pricing");
requireText("scan", 'nothingPublished: true', "identity scan must never publish");
requireText("scan", 'sourceOfTruth: "mac_local"', "Mac must remain identity authority");
requireText("scan", "KINGMAKER exact scan is owner-only", "exact re-scan route must remain owner-only");
requireText("intake", "FRONT_BACK_IMAGES_DUPLICATE", "new scan intake must reject duplicate sides");
requireText("intake", "identity_complete_pricing_pending", "identity must persist before pricing");
requireText("intake", "background_refresh_queued", "pricing must be queued after identity");
requireText("intake", 'sourceOfTruth: "mac_local"', "new scan intake must preserve Mac identity authority");

requireText("edit", "manualIdentityLocked: true", "seller edits must become authoritative");
requireText("edit", "identityRefreshRequired: false", "manual edits must not auto-queue an overwriting rescan");
requireText("edit", "manual_identity_saved_pricing_pending", "manual identity and pricing must remain separate");

requireText("status", "lastError", "durable error details must be readable after reload");
requireText("status", "lastErrorCode", "durable error codes must be readable after reload");
requireText("status", "backEvidenceText", "back evidence must be readable after reload");

if (failures.length) {
  console.error("Kingmaker FBI contract FAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Kingmaker FBI contract PASSED");
