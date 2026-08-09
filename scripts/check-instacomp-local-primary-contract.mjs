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
const councilRuntime = read("src/lib/instacomp-ai-council-runtime.ts");

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

const councilGate = councilRuntime.match(
  /export function shouldContinueCouncilRuntime\([\s\S]*?\n}/,
)?.[0];
if (!councilGate) {
  throw new Error("Shared AI council runtime gate was not found.");
}
requireText(
  councilGate,
  "return false;",
  "Website AI council execution must remain hard-stopped.",
);
if (/return\s*\(/.test(councilGate)) {
  throw new Error("Website AI council runtime may not contain an executable continuation path.");
}

const analyze = service.split("async def analyze_scan", 2)[1]?.split(
  '@app.post(\n    "/v1/lessons"',
  1,
)[0];
if (!analyze) throw new Error("Could not isolate the Mac analyze_scan route.");

// Local Ollama is permitted as evidence after trusted memory + OCR/Registry.
// It is never an identity authority: the exact Registry identity and current
// fingerprint are required before it can unlock identity or pricing.
requireText(
  analyze,
  "LOCAL EVIDENCE FALLBACK",
  "Mac scan must identify local-model execution as evidence fallback.",
);
requireText(
  analyze,
  "suggestion = await reader.analyze(",
  "Mac scan must retain its local Ollama evidence fallback.",
);
requireText(
  analyze,
  "suggestion_registry = await checklist_gateway.match(",
  "Local-model evidence must be sent back through the Checklist Registry.",
);
requireText(
  analyze,
  "suggestion_registry.outcome == ChecklistOutcome.EXACT_MATCH",
  "Local-model evidence may only lock an exact Registry match.",
);
requireText(
  analyze,
  'receipt.startswith("registry_fingerprint:")',
  "Local-model evidence requires a current Registry fingerprint receipt.",
);
requireText(
  analyze,
  'match_source = "ollama_backup"',
  "Registry-locked local-model evidence must retain explicit provenance.",
);
requireText(
  analyze,
  "trusted_identity = None",
  "Unresolved local evidence must not become trusted identity.",
);
requireText(
  analyze,
  "pricing_allowed = False",
  "Unresolved local evidence must keep pricing blocked.",
);
requireText(
  analyze,
  "_save_scan(",
  "Every scan outcome must remain archived with its scan ID and checklist receipt.",
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
  "Production readiness may not depend only on Ollama.",
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

console.log("InstaComp Registry-locked local-primary contract passed.");
