import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, text, message) {
  assert.ok(source.includes(text), `${message}: missing ${text}`);
}

function forbidText(source, text, message) {
  assert.equal(source.includes(text), false, `${message}: forbidden ${text}`);
}

const intake = read("src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts");
const pendingApi = read("src/app/api/account/seller/instacomp-pending/route.ts");
const exactScan = read("src/app/api/kingmaker/instacomp-front-back-exact/route.ts");
const macScanServer = read("src/lib/kingmaker-mac-scan-server.ts");
const queueUi = read("src/app/kingmaker/KingmakerInstaCompQueue.tsx");
const scannerUi = read("src/app/seller/instacomp-scan/page.tsx");
const listingsUi = read("src/app/kingmaker/pending/PendingClient.tsx");

for (const required of [
  "runKingmakerMacScan",
  "findMacDuplicateByImagePair",
  "archiveKingmakerMacReviewFallback",
  "front:",
  "back:",
  'sourceOfTruth: "mac_local"',
  "imagesPreserved: true",
  "stagingMirrored: false",
  "retryable:",
  "durationMs:",
]) {
  requireText(intake, required, "backward scan intake contract");
}

for (const forbidden of [
  "createSupabaseServerClient",
  "persistNormalizedInstaCompImagePair",
  "mirrorKingmakerScanToPendingStaging",
  "persistKingmakerPendingStagingImages",
]) {
  forbidText(intake, forbidden, "backward scan must remain Mac-local");
}

for (const required of [
  "FRONT_BACK_IMAGES_DUPLICATE",
  "DUPLICATE_SCAN",
  "imagePairSha256",
  "SCANNER_LOCAL_UNAVAILABLE",
  'headers: noStoreHeaders()',
]) {
  requireText(intake, required, "duplicate and failure recovery contract");
}

for (const required of [
  "resolveInstaCompChecklistFirstFromRegistry",
  "identityComplete",
  "registryFingerprintSha256",
  'source: "checklist_registry"',
]) {
  requireText(exactScan, required, "exact Registry identity contract");
}

for (const forbidden of [
  "readInstaCompCoreVisualEvidence",
  "resolveChecklistParallelFromVision",
  "normalizeInstaCompSideImages",
  "checklist_disabled_visual_ai_only",
  "visual_ai_identity_locked_without_checklist",
]) {
  forbidText(exactScan, forbidden, "exact route must not bypass Registry proof");
}

for (const required of [
  "fastPassOnly?: boolean;",
  "imagePairSha256",
  "createMacKingmakerDraft",
  "updateMacKingmakerDraft",
  '"/v1/kingmaker/accounting/commercial-inventory"',
]) {
  requireText(macScanServer, required, "Mac-local persistence contract");
}

for (const required of [
  "CONCURRENCY = 1",
  "/api/kingmaker/instacomp-scan-intake-v2",
  "queueTailRef",
]) {
  requireText(queueUi, required, "serialized physical scan queue contract");
}

for (const required of [
  "130_000",
  "AbortController",
  "SCANNER_LOCAL_UNAVAILABLE",
]) {
  requireText(scannerUi, required, "browser scan recovery contract");
}

for (const required of [
  "imagePairSha256",
  "inventoryItemId",
  "queueCounts",
]) {
  requireText(pendingApi, required, "Pending Listings backward visibility contract");
}

for (const required of [
  "locationParams.get(\"focus\")",
  "Retry This Card",
  "never auto-published",
]) {
  requireText(listingsUi, required, "Pending Listings review contract");
}

console.log("KINGMAKER backward scan smoke contract passed.");
