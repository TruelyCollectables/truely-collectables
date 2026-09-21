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
  "runKingmakerMacScan",
  "getMacKingmakerInventoryItem",
  "fetchInstaCompAiLocalScanImage",
  'sourceOfTruth: "mac_local"',
  "status: result.identityComplete ? 200 : 202",
]) {
  requireText(exact, required, `Exact route is missing: ${required}`);
}

const macServer = read("src/lib/kingmaker-mac-scan-server.ts");
for (const required of [
  "analyzeWithInstaCompAiLocal",
  "registryIdentityId",
  "registryFingerprintSha256",
  "pricingGroupKey:",
  'identitySource: identity.exact ? "mac_checklist_registry_exact"',
]) {
  requireText(
    macServer,
    required,
    `Mac-local KINGMAKER authority is missing: ${required}`,
  );
}
for (const forbidden of [
  "runInstaCompScan",
  "getInstaCompServiceToken",
  "scanPayload?.ai",
  "Identity scan failed.",
]) {
  forbidText(
    exact,
    forbidden,
    `First-time identity still depends on the neutral legacy scan route: ${forbidden}`,
  );
}

const mac = read("services/instacomp-ai/app/main.py");
for (const required of [
  "interactive_fast_scan = not deep_recovery",
  "suggestion_registry = printed_registry",
  'match_source="checklist_registry"',
  "pricing_allowed=autonomy.pricing_allowed",
  "if settings.ollama_runtime_reader_enabled and not parallel_only_unresolved and not interactive_fast_scan:",
  'receipt.startswith("registry_fingerprint:")',
  'else "ollama_backup"',
  'status = "model_unavailable"',
  "pricing_allowed = False",
]) {
  requireText(
    mac,
    required,
    `Mac first-time identity hardening is missing: ${required}`,
  );
}
forbidText(
  mac,
  "No Ollama or external identity reader is called here",
  "The original first-time-card deadlock must not be restored.",
);

const intake = read(
  "src/app/api/kingmaker/instacomp-scan-intake-v2/route.ts",
);
for (const required of [
  "runKingmakerMacScan",
  "searchMarket: false",
  "after(async () =>",
  "refreshKingmakerMacMarketForScan",
  'sourceOfTruth: "mac_local"',
]) {
  requireText(
    intake,
    required,
    `Fresh scanner intake is missing the Mac-first fast path: ${required}`,
  );
}
for (const forbidden of [
  "persistNormalizedInstaCompImagePair",
  "runInstaCompScan",
  'from "../instacomp-front-back-exact/route"',
]) {
  forbidText(
    intake,
    forbidden,
    `Fresh scanner intake must not use the retired serial intake path: ${forbidden}`,
  );
}

const batchQueue = read("src/app/kingmaker/KingmakerInstaCompQueue.tsx");
requireText(
  batchQueue,
  'fetch("/api/account/seller/instacomp-scan/intake"',
  "Multi-card upload must use the inventory-preserving Mac-local seller intake.",
);
requireText(
  batchQueue,
  "Front orienting",
  "Multi-card upload must not display raw browser previews as finished card images.",
);

const sellerIntake = read(
  "src/app/api/account/seller/instacomp-scan/intake/route.ts",
);
for (const required of [
  "analyzeWithInstaCompAiLocal",
  'identitySource: "mac_checklist_registry_exact"',
  "pricingGroupKey: registryFingerprint",
  "persistNormalizedInstaCompImagePair",
  "after(async () =>",
  "pricingBackgroundQueued: false",
]) {
  requireText(
    sellerIntake,
    required,
    `Inventory-preserving seller intake is missing: ${required}`,
  );
}

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
