import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, value, label) {
  if (!source.includes(value)) {
    throw new Error(`Missing ${label}: ${value}`);
  }
}

const orientation = read("src/lib/instacomp-image-orientation.ts");
requireText(orientation, "backStandalonePrizm: boolean | null", "back designation receipt");
requireText(orientation, "backDesignationConfidence", "back designation confidence");
requireText(
  orientation,
  "The phrase Panini - WNBA Prizm Basketball in copyright or product text does NOT prove a Prizm parallel.",
  "copyright/product-text exclusion",
);

const intake = read("src/app/api/account/seller/instacomp-scan/intake/route.ts");
requireText(intake, "normalizeInstaCompSideImages", "intake orientation normalization");
requireText(intake, "persistNormalizedInstaCompImagePair", "permanent image persistence");
requireText(
  intake,
  "wnba_back_without_standalone_prizm_forced_base",
  "WNBA Base evidence rule",
);
requireText(intake, "normalizedImages: persistedImages", "normalized image receipt");

const imageEdit = read("src/app/api/admin/card-listing-images/route.ts");
requireText(imageEdit, "manualIdentityLocked: false", "image edit unlock");
requireText(imageEdit, "identityRefreshRequired: true", "image edit rescan requirement");

const page = read("src/app/kingmaker/instacomp-audit/page.tsx");
if (page.includes("disabled={locked || Boolean(action?.busy)}")) {
  throw new Error("KINGMAKER still disables image changes when the identity is locked.");
}
if (page.includes("Unlock the identity before changing its image evidence.")) {
  throw new Error("KINGMAKER still blocks locked image edits in the browser.");
}
requireText(page, "const sourceTitle = status?.title || item.title", "locked-title correction");

console.log("Automatic orientation, Base designation, and rotation contract passed.");
