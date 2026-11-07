import fs from "node:fs";

const files = {
  page: [
    fs.readFileSync("src/app/kingmaker/pending/page.tsx", "utf8"),
    fs.readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8"),
  ].join("\n"),
  scan: fs.readFileSync("src/app/api/kingmaker/instacomp-front-back-exact/route.ts", "utf8"),
  edit: fs.readFileSync("src/app/api/account/seller/inventory/instacomp-card-edit/route.ts", "utf8"),
  status: fs.readFileSync("src/app/api/account/seller/inventory/instacomp-job-status/route.ts", "utf8"),
  rotation: [
    fs.readFileSync("src/app/api/account/seller/inventory/instacomp-image-rotate/route.ts", "utf8"),
    fs.readFileSync("src/app/kingmaker/pending/PendingClient.tsx", "utf8"),
  ].join("\n"),
};

const failures = [];
const requireText = (file, value, reason) => {
  if (!files[file].includes(value)) failures.push(`${file}: ${reason}`);
};
const forbidText = (file, value, reason) => {
  if (files[file].includes(value)) failures.push(`${file}: ${reason}`);
};

requireText("rotation", "archiveInstaCompAiLocalSupervisedScan", "rotation must persist the normalized pair on the Mac");
requireText("rotation", 'form.set("frontImage", frontImage)', "front file must be submitted");
requireText("rotation", 'form.set("backImage", backImage)', "back file must be submitted");
requireText("rotation", "rotateClockwise90", "browser rotation must rewrite image pixels");
requireText("rotation", 'if (side === "front") frontImage = await rotateClockwise90', "front rotation must happen exactly once before persistence");
requireText("rotation", 'else backImage = await rotateClockwise90', "back rotation must happen exactly once before persistence");
requireText("page", "Retry This Card", "failed cards need an attached retry action");
requireText("page", "Replace Manual Identity with AI", "manual identity replacement must be explicit");
requireText("page", "job?.error", "durable per-card errors must be displayed");
forbidText("page", 'failed: 100', "failures must never be shown as fake 100 percent completion");
forbidText("page", "window.setTimeout(() => setStage", "progress must not be simulated by timers");

requireText("scan", "DUPLICATE_NORMALIZED_IMAGES", "front and back bytes must be distinct");
requireText("scan", "manualIdentityLocked", "seller-corrected identities must be protected");
requireText("scan", "backEvidenceText", "back evidence must be retained");
requireText("scan", "identity_complete_pricing_pending", "identity must persist before pricing");
requireText("scan", "exactRegistryProduct", "WNBA base normalization must be explicit");
requireText("scan", 'return `${brand} WNBA`;', "WNBA product normalization must preserve league identity");
requireText("scan", "const setName = text(identity.set_name ?? identity.setName ?? identity.product, 200);", "registry set name must be preserved independently from product normalization");
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
