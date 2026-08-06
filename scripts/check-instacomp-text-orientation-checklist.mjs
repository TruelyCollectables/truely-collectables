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

const auditPage = read("src/app/kingmaker/instacomp-audit/page.tsx");
requireText(
  auditPage,
  '"/api/account/seller/inventory/instacomp-kingmaker"',
  "The audit desk must use the bounded workbench loader.",
);
for (const forbidden of [
  "MutationObserver",
  "Rotate left",
  "Rotate right",
  "Swap front / back",
  "editImage(",
]) {
  forbidText(
    auditPage,
    forbidden,
    `The audit desk still contains obsolete image controls: ${forbidden}`,
  );
}
requireMissing(
  "src/app/kingmaker/instacomp-audit/automatic-image-policy.tsx",
  "The recursive DOM policy file must remain deleted.",
);
requireMissing(
  "src/app/kingmaker/instacomp-audit/layout.tsx",
  "The obsolete nested policy layout must remain deleted.",
);

const pendingPage = read("src/app/kingmaker/pending/page.tsx");
requireText(
  pendingPage,
  "year, set, player, card number, visible parallel",
  "Pending must explain the exact identity order.",
);
requireText(
  pendingPage,
  "Velocity and Cracked Ice are treated as different patterns",
  "Pending must preserve the Velocity/Cracked Ice distinction.",
);
requireText(
  pendingPage,
  "Card {side} · automatically oriented",
  "Pending must display the saved automatic orientation.",
);
requireText(
  pendingPage,
  "Enter Base or the exact checklist parallel. Blank no longer means Base.",
  "Pending manual corrections must require an explicit parallel.",
);
for (const forbidden of [
  "rotatedImageFile",
  "createImageBitmap",
  "Rotate ↷",
  "↶ Rotate",
  "autoRunning",
  "batchRunning",
  "rotations",
]) {
  forbidText(
    pendingPage,
    forbidden,
    `Pending still contains the obsolete browser rotation/auto-run path: ${forbidden}`,
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
  "addScanFrame?: boolean",
  "Stored-card retries must be able to avoid nested scan frames.",
);
requireText(
  orientation,
  "backStandalonePrizm: null",
  "Orientation must never decide Base or a parallel.",
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

const matcher = read("src/lib/instacomp-parallel-pattern-matcher.ts");
requireText(
  matcher,
  'return "cracked_ice"',
  "The matcher must have a distinct Cracked Ice signature.",
);
requireText(
  matcher,
  'return "velocity"',
  "The matcher must have a distinct Velocity signature.",
);
requireText(
  matcher,
  "base_conflicts_with_visible_",
  "Visible parallel treatment must block Base.",
);
requireText(
  matcher,
  "serial_run_",
  "Serial denominators must participate in exact identity matching.",
);

const parallelVision = read("src/lib/instacomp-checklist-parallel-vision.ts");
requireText(
  parallelVision,
  "Do NOT choose a checklist identity",
  "Vision must extract features before software chooses an identity.",
);
requireText(
  parallelVision,
  "Velocity and Cracked Ice are never interchangeable",
  "The visual reader must explicitly distinguish the two patterns.",
);
requireText(
  parallelVision,
  "Green Prizm or other colored solid prizm is not Base",
  "Colored Prizms must not be erased to Base.",
);
requireText(
  parallelVision,
  "resolveChecklistParallelFromVisualFeatures",
  "Checklist selection must be deterministic after feature extraction.",
);
forbidText(
  parallelVision,
  "selectedIdentityId: {",
  "The visual model must not directly return a checklist identity ID.",
);

const exactRoute = read(
  "src/app/api/kingmaker/instacomp-front-back-exact/route.ts",
);
requireText(
  exactRoute,
  "addScanFrame: multipart",
  "Fresh uploads get one frame and stored retries must not nest frames.",
);
requireText(
  exactRoute,
  "serialNumber: null",
  "Broad candidate retrieval must ignore scanner serial guesses.",
);
requireText(
  exactRoute,
  "core_identity_then_color_pattern_serial_match",
  "The exact identity order must be persisted in the receipt.",
);
requireText(
  exactRoute,
  "No Base or look-alike parallel was substituted",
  "Ambiguous parallels must remain review-required.",
);
for (const forbidden of [
  "forcedBaseFromBack",
  "backDesignationConfidence >=",
  "no_prizm_on_back_forced_base",
]) {
  forbidText(
    exactRoute,
    forbidden,
    `The exact route contains a forbidden Base shortcut: ${forbidden}`,
  );
}

const intakeV2 = read(
  "src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts",
);
requireText(
  intakeV2,
  "runExactFrontBack",
  "New scans and pending retries must use the same exact identity pipeline.",
);
requireText(
  intakeV2,
  "imagesPreserved: true",
  "An unresolved scan must preserve its front and back.",
);
requireText(
  intakeV2,
  'stage: "review_required"',
  "An unresolved scan must become a reviewable draft instead of disappearing.",
);

const cardEdit = read(
  "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts",
);
requireText(
  cardEdit,
  "Blank is not accepted as Base",
  "Manual correction must require Base or an exact parallel.",
);
requireText(
  cardEdit,
  "exactSerialStamp",
  "Manual correction must preserve the exact serial numerator and denominator.",
);
requireText(
  cardEdit,
  "confirmInstaCompAiLocalLesson",
  "Manual correction must teach the local InstaComp engine.",
);

const jobStatus = read(
  "src/app/api/account/seller/inventory/instacomp-job-status/route.ts",
);
requireText(
  jobStatus,
  "suppressStaleFailure",
  "A completed or locked card must not display an old failed stage.",
);
requireText(
  jobStatus,
  "visualPattern",
  "Pending must receive the visual pattern receipt.",
);

const config = read("next.config.ts");
requireText(
  config,
  'destination: "/api/kingmaker/instacomp-front-back-exact"',
  "Pending exact scans must route through the new pipeline.",
);
requireText(
  config,
  'destination: "/api/kingmaker/instacomp-scan-intake-v2"',
  "Fresh scanner intake must bypass the legacy Base shortcut.",
);

console.log("KINGMAKER exact orientation and parallel contracts passed.");
