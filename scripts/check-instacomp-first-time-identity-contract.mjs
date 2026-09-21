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

const core = read("src/lib/instacomp-core-visual-evidence.ts");
for (const required of [
  "first-time sports-card evidence reader",
  "year",
  "manufacturer",
  "player",
  "cardNumber",
  "Do NOT decide Base versus any parallel",
  'detail: "high"',
]) {
  requireText(core, required, `Core visual reader is missing: ${required}`);
}

const exact = read(
  "src/app/api/kingmaker/instacomp-front-back-exact/route.ts",
);
for (const required of [
  "year_product_player_card_then_color_pattern_serial",
  "archiveWithMacBestEffort",
  "const identityComplete = Boolean(certifiedCandidate);",
  'receipt.checklistOutcome !== "exact_match"',
  "macCoreEvidence(macCandidate, macReceipt)",
  "Mac Registry did not lock one exact identity",
  "remote_parallel_inference_deferred",
  "titleRegistryDimensionHints",
  "registryRecoveryAttempts",
  "expandedAttemptHints",
  "_family_only",
  "physical_parallel_evidence_verified",
  "parallelPhysicalProof",
  "allowTitleBasedIdentityRecovery = false",
  "IDENTITY_TARGET_MS = 10_000",
  "MAC_IDENTITY_TIMEOUT_MS = 5_500",
  "const selectedRegistryIdentityId = certifiedCandidate?.identityId || null;",
  "certifiedCandidate?.fingerprintSha256 || null",
  'source: "checklist_registry"',
  "trustedForIdentity: Boolean(certifiedCandidate)",
  "pricingGroupKey: selectedRegistryFingerprintSha256",
  '"identity_review_required"',
  "status: identityComplete ? 200 : 202",
]) {
  requireText(exact, required, `Exact route is missing: ${required}`);
}
for (const forbidden of [
  "Mac InstaComp AI supplied a trusted exact Registry identity; no second visual parallel vote was required.",
  "const identityComplete = Boolean(macCandidate);",
  "readInstaCompCoreVisualEvidence",
  "resolveChecklistParallelFromVision",
  "normalizeInstaCompSideImages",
  "runInstaCompScan",
  "getInstaCompServiceToken",
  "scanPayload?.ai",
  "Identity scan failed.",
  "const identityComplete = true;",
  "checklist_disabled_visual_ai_only",
  "visual_ai_identity_locked_without_checklist",
  "Build-contract compatibility breadcrumbs",
  "if (receipt.pricingAllowed !== true) return null;",
]) {
  forbidText(
    exact,
    forbidden,
    `First-time identity still depends on the neutral legacy scan route: ${forbidden}`,
  );
}

const mac = read("services/instacomp-ai/app/main.py");
for (const required of [
  'receipt.startswith("registry_fingerprint:")',
  'status = "model_unavailable"',
  "pricing_allowed = False",
]) {
  requireText(
    mac,
    required,
    `Mac fail-closed Registry contract is missing: ${required}`,
  );
}
for (const required of [
  "mac_registry_title_hint_recovery_exact",
  "registryRecoveryAttempts",
  "identityTrace",
]) {
  requireText(
    exact,
    required,
    `Exact seller identity path is missing deterministic Registry recovery/trace: ${required}`,
  );
}

const intake = read(
  "src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts",
);
requireText(
  intake,
  'from "../instacomp-front-back-exact/route"',
  "Fresh scanner intake must use the repaired exact route.",
);
forbidText(
  intake,
  "persistNormalizedInstaCompImagePair",
  "Fresh scanner intake must not store provisional raw images before the Mac-normalized exact pass.",
);
requireText(
  intake,
  'exactForm.set("frontImage", front)',
  "Fresh scanner intake must hand original uploads directly to the exact Mac-normalized route.",
);

const batchQueue = read("src/app/kingmaker/KingmakerInstaCompQueue.tsx");
requireText(
  batchQueue,
  'fetch("/api/kingmaker/instacomp-scan-intake-v2"',
  "Multi-card upload must call the full exact InstaComp pipeline directly.",
);
requireText(
  batchQueue,
  "Front orienting",
  "Multi-card upload must not display raw browser previews as finished card images.",
);
requireText(
  batchQueue,
  "const CONCURRENCY = 1;",
  "Physical card intake must admit only one Mac scan at a time.",
);
requireText(
  batchQueue,
  "queueTailRef",
  "Overlapping image drops must share one serialized physical-scan queue.",
);

const sellerScanner = read("src/app/seller/instacomp-scan/page.tsx");
requireText(
  sellerScanner,
  'fetch("/api/kingmaker/instacomp-scan-intake-v2"',
  "Single-card upload must call the full exact InstaComp pipeline directly.",
);

const config = read("next.config.ts");
requireText(
  config,
  'destination: "/api/kingmaker/instacomp-front-back-exact"',
  "Pending retries must use the repaired exact route.",
);

console.log("First-time card identity deadlock repair contract passed.");
