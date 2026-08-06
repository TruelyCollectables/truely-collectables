import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message);
}

function forbidText(source, needle, message) {
  if (source.includes(needle)) throw new Error(message);
}

const route = read("src/app/api/instacomp/scan/route.ts");
const client = read("src/lib/instacomp-ai-local.ts");
const service = read("services/instacomp-ai/app/main.py");
const storage = read("services/instacomp-ai/app/storage.py");
const readiness = read("src/app/api/instacomp/internal-readiness/route.ts");
const editRoute = read(
  "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts",
);

requireText(
  route,
  'provider: "instacomp_internal"',
  "Website must use the InstaComp internal identity reader.",
);
forbidText(
  route,
  'provider: "openai_emergency"',
  "OpenAI emergency may not be an identity reader.",
);
requireText(
  route,
  "const serialOcr = null as InstaCompSerialOcrResult | null;",
  "External serial identity reading must remain disabled.",
);
requireText(
  route,
  "runSecondaryVision: false",
  "External AI council execution must remain disabled.",
);
requireText(
  route,
  'requestedTier: "basic"',
  "External AI council must remain on its zero-reader tier.",
);

const analyze = service.split("async def analyze_scan", 2)[1]?.split(
  '@app.post(\n    "/v1/lessons"',
  1,
)[0];
if (!analyze) throw new Error("Could not isolate the Mac analyze_scan route.");
forbidText(
  analyze,
  "await reader.analyze(",
  "Ollama may not execute inside the InstaComp identity scan.",
);
requireText(
  analyze,
  "CHECKLIST-ONLY REVIEW PATH",
  "Unresolved cards must use the checklist-only review path.",
);
requireText(
  analyze,
  'status = "needs_review"',
  "Unresolved cards must return needs_review rather than model_unavailable.",
);
requireText(
  analyze,
  'status = "needs_checklist"',
  "Missing Registry configuration must return needs_checklist.",
);
requireText(
  analyze,
  "No external identity provider was called",
  "Review receipts must prove no external identity provider ran.",
);
requireText(
  analyze,
  "result = AnalyzeResponse(",
  "Every unresolved scan must still construct a response.",
);
requireText(
  analyze,
  "_save_scan(",
  "Every unresolved scan must be archived with its scan ID and checklist receipt.",
);
requireText(
  analyze,
  "return result",
  "The Mac must return its saved review receipt.",
);

forbidText(
  client,
  "if (!identity) return null;",
  "A valid unresolved Mac scan may not be discarded by the website adapter.",
);
forbidText(
  client,
  "if (!player && !cardNumber && !setName) return null;",
  "Partial or unresolved scan receipts may not be discarded.",
);
requireText(
  client,
  "internalStatus: scan.status",
  "Website must preserve the Mac scan status.",
);
requireText(
  client,
  "internalChecklistOutcome",
  "Website must preserve the checklist outcome.",
);
requireText(
  client,
  "internalChecklistCandidateCount",
  "Website must preserve checklist candidate count.",
);
requireText(
  client,
  "internalChecklistReasons",
  "Website must preserve checklist reasons.",
);
requireText(
  client,
  "internalChecklistSourceReceipts",
  "Website must preserve checklist source receipts.",
);
requireText(
  client,
  "internalScanId: safeScanId(scan.scan_id)",
  "Website must preserve the real Mac scan ID.",
);
requireText(
  client,
  "confidence: 0",
  "Unresolved review receipts must not claim identity confidence.",
);

forbidText(
  readiness,
  'const localModelReady = health.ollama === "ready";',
  "Production readiness may not depend on Ollama.",
);
requireText(
  readiness,
  "const localModelReady = internalMemoryReady && checklistReady;",
  "Production readiness must be based on internal memory plus Checklist Registry.",
);
requireText(
  readiness,
  'architecture: ["instacomp_ai"]',
  "Production must advertise one InstaComp AI engine.",
);
forbidText(
  readiness,
  "openAiEmergencyConfigured",
  "Production readiness may not advertise OpenAI emergency.",
);

requireText(
  service,
  "printed_registry = (",
  "Mac engine must query the Checklist Registry from printed evidence.",
);
requireText(
  storage,
  "exact_image_pair",
  "Trusted exact front/back memory matching is required.",
);
requireText(
  storage,
  "trusted_visual_memory",
  "Trusted near-visual memory matching is required.",
);
requireText(
  editRoute,
  "manualIdentityLocked: true",
  "Seller corrections must remain authoritative and locked.",
);

console.log("InstaComp checklist-only unresolved-scan contract passed.");
