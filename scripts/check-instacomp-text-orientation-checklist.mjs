import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, value, message) {
  if (!source.includes(value)) throw new Error(message);
}

function forbidText(source, value, message) {
  if (source.includes(value)) throw new Error(message);
}

function requireMissing(path, message) {
  if (fs.existsSync(path)) throw new Error(message);
}

const page = read("src/app/kingmaker/instacomp-audit/page.tsx");
requireText(
  page,
  '"/api/account/seller/inventory/instacomp-kingmaker"',
  "KINGMAKER must use the fast workbench loader.",
);
requireText(
  page,
  "Re-run Automatic Orientation + Checklist",
  "KINGMAKER must expose the automatic repair workflow.",
);
requireText(
  page,
  "Save, Lock & Teach InstaComp",
  "KINGMAKER must make learning promotion explicit.",
);
for (const forbidden of [
  "MutationObserver",
  "Rotate left",
  "Rotate right",
  "Swap front / back",
  "editImage(",
  "correctedBaseTitle",
  "hasImpossibleBaseParallelTitle",
]) {
  forbidText(
    page,
    forbidden,
    `KINGMAKER still contains obsolete manual/automatic-coercion code: ${forbidden}`,
  );
}
requireMissing(
  "src/app/kingmaker/instacomp-audit/automatic-image-policy.tsx",
  "The recursive DOM policy file must be deleted.",
);
requireMissing(
  "src/app/kingmaker/instacomp-audit/layout.tsx",
  "The obsolete nested policy layout must be deleted.",
);

const loader = read(
  "src/app/api/account/seller/inventory/instacomp-kingmaker/route.ts",
);
requireText(
  loader,
  "MAX_WORKBENCH_CARDS = 100",
  "The workbench loader must have a bounded card limit.",
);
requireText(
  loader,
  "identityComplete || manuallyLocked",
  "Unresolved scanner parallel guesses must be hidden.",
);
for (const forbidden of [
  "getInstaCompAiLocalScanArchive",
  "resolveInstaCompChecklistFirstFromRegistry",
  "for (const row of rows",
]) {
  forbidText(
    loader,
    forbidden,
    `The normal page loader still contains per-card heavy work: ${forbidden}`,
  );
}

const orientation = read("src/lib/instacomp-image-orientation.ts");
requireText(
  orientation,
  "Use the direction of printed writing as the primary evidence",
  "Orientation must be based on printed writing.",
);
requireText(
  orientation,
  'image_url: { url: params.frontDataUrl, detail: "high" }',
  "Front orientation must use high-detail vision.",
);
requireText(
  orientation,
  'image_url: { url: params.backDataUrl, detail: "high" }',
  "Back orientation must use high-detail vision.",
);
requireText(
  orientation,
  "backStandalonePrizm: null",
  "Orientation must not decide the parallel.",
);

const storage = read("src/lib/instacomp-normalized-image-storage.ts");
requireText(
  storage,
  "Normalized image persistence failed its front/back read-back verification.",
  "Normalized storage must verify the saved pair.",
);
requireText(
  storage,
  "preservedAdditionalImages",
  "Normalized storage must preserve extra images.",
);
forbidText(
  storage,
  '.from("inventory_images")\n    .delete()',
  "Normalized storage must never delete every card image before replacement.",
);

const parallel = read("src/lib/instacomp-checklist-parallel-vision.ts");
requireText(
  parallel,
  "never trust a prior scanner label by itself",
  "Parallel resolution must not trust the scanner guess.",
);
requireText(
  parallel,
  "selectedIsBase ? 0.9 : 0.82",
  "Base must require stronger positive visual proof.",
);
forbidText(
  parallel,
  "aiParallel",
  "Scanner-provided parallel labels must not bypass visual checklist review.",
);

const route = read(
  "src/app/api/kingmaker/instacomp-front-back-auto/route.ts",
);
requireText(
  route,
  "previousFrontImageUrl: pair.front.url",
  "The automatic route must replace the assigned rows without losing the card.",
);
requireText(
  route,
  "serialNumber: null",
  "Broad checklist retrieval must not trust scanner serial/type guesses.",
);
requireText(
  route,
  "Checklist identity remains ambiguous. Base was not assumed",
  "Ambiguous cards must never default to Base.",
);
requireText(
  route,
  "stripTrailingChecklistParallel",
  "Title updates must be suffix-scoped rather than deleting color words globally.",
);
for (const forbidden of [
  "aiParallel:",
  "forcedBaseFromBack",
  "backStandalonePrizm",
  "Base was not assumed and pricing is blocked" + "x",
]) {
  forbidText(
    route,
    forbidden,
    `The automatic route still contains unsafe parallel logic: ${forbidden}`,
  );
}

const manual = read(
  "src/app/api/account/seller/inventory/instacomp-manual-identity/route.ts",
);
requireText(
  manual,
  "Parallel is required. Enter Base or the exact checklist parallel",
  "Manual save must require an explicit parallel choice.",
);
requireText(
  manual,
  "confirmInstaCompKnowledge",
  "Manual corrections must promote reusable InstaComp knowledge.",
);
requireText(
  manual,
  "learningPromotion",
  "Manual learning must persist an audit receipt.",
);
forbidText(
  manual,
  "normalizeBaseParallel",
  "Blank parallel values must not silently become Base.",
);

const config = read("next.config.ts");
requireText(
  config,
  'source: "/api/account/seller/inventory/instacomp-front-back"',
  "Existing front/back requests must route through the automatic pipeline.",
);
requireText(
  config,
  'destination: "/api/kingmaker/instacomp-front-back-auto"',
  "The automatic route rewrite is missing.",
);

const intake = read(
  "src/app/api/account/seller/instacomp-scan/intake/route.ts",
);
requireText(
  intake,
  "normalizeInstaCompSideImages",
  "New-card intake must normalize orientation before creating the draft.",
);
requireText(
  intake,
  "persistNormalizedInstaCompImagePair",
  "New-card intake must persist the normalized pair.",
);
requireText(
  orientation,
  "backDesignationConfidence: 0",
  "The legacy back-word Base gate must remain impossible while legacy intake code is removed.",
);

console.log("KINGMAKER forensic orientation/checklist contracts passed.");
