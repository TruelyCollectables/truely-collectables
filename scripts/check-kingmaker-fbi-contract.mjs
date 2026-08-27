import fs from "node:fs";

const files = {
  page: fs.readFileSync("src/app/kingmaker/pending/page.tsx", "utf8"),
  scan: fs.readFileSync("src/app/api/account/seller/inventory/instacomp-front-back/route.ts", "utf8"),
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

requireText("page", "rotatedImageFile", "rotation must change the bytes sent to AI");
requireText("page", 'formData.set("frontImage", frontImage)', "front file must be submitted");
requireText("page", 'formData.set("backImage", backImage)', "back file must be submitted");
requireText("page", "Retry This Card", "failed cards need an attached retry action");
requireText("page", "Replace Manual Identity with AI", "manual identity replacement must be explicit");
requireText("page", "job?.error", "durable per-card errors must be displayed");
forbidText("page", 'failed: 100', "failures must never be shown as fake 100 percent completion");
forbidText("page", "window.setTimeout(() => setStage", "progress must not be simulated by timers");

requireText("scan", "DUPLICATE_IMAGE_BYTES", "front and back bytes must be distinct");
requireText("scan", "manualIdentityLocked", "seller-corrected identities must be protected");
requireText("scan", "backEvidenceText", "back evidence must be retained");
requireText("scan", "identity_complete_pricing_pending", "identity must persist before pricing");
requireText("scan", "forceWnbaBaseTitle", "WNBA base normalization must be explicit");
requireText("scan", "setNamePreserved: true", "WNBA set name preservation must be part of the response contract");
forbidText("scan", '.replace(/\\bprizm\\b/gi, "")', "generic Prizm removal can damage the set name");

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
