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
requireText(
  analyze,
  "await reader.analyze(",
  "The private Mac may use its local Ollama reader as an evidence fallback.",
);
requireText(
  analyze,
  "suggestion_registry = await checklist_gateway.match(",
  "Any local Ollama suggestion must be re-checked against the Registry.",
);
requireText(
  analyze,
  "suggestion_registry.outcome == ChecklistOutcome.EXACT_MATCH",
  "Local Ollama evidence may not become trusted identity without an exact Registry match.",
);
requireText(
  analyze,
  "suggestion_registry.identity_id",
  "Trusted local evidence must include a Registry identity ID.",
);
requireText(
  analyze,
  'receipt.startswith("registry_fingerprint:")',
  "Trusted local evidence must include a Registry fingerprint receipt.",
);
requireText(
  analyze,
  "pricing_allowed = False",
  "Unresolved local evidence must keep pricing blocked.",
);
requireText(
  analyze,
  'status = "needs_review"',
  "Unresolved cards must retain a private review path.",
);
requireText(
  analyze,
  'status = "needs_checklist"',
  "Missing Registry configuration must return needs_checklist.",
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
  storage,
  "card_uuid",
  "Mac storage must preserve physical-card UUID identity.",
);
requireText(
  readiness,
  'architecture: ["instacomp_ai"]',
  "Production readiness must expose InstaComp AI as the internal identity architecture.",
);
requireText(
  readiness,
  "localModelReady",
  "Production readiness must expose the internal identity readiness gate.",
);

// Seller correction route: certify actual authorization, ownership, mutation,
// and Mac-learning behavior instead of checking for its own filename literal.
requireText(
  editRoute,
  "getAuthenticatedAccountFromRequest(request)",
  "Seller card correction must require an authenticated account.",
);
requireText(
  editRoute,
  "ensureAccountStoreMembership({",
  "Seller card correction must require active store membership.",
);
requireText(
  editRoute,
  'role: "seller"',
  "Seller card correction must enforce seller role membership.",
);
requireText(
  editRoute,
  '.eq("status", "draft")',
  "Seller card correction must be limited to draft inventory.",
);
requireText(
  editRoute,
  'query.eq("seller_account_id", account.id)',
  "Seller card correction must be scoped to the seller-owned inventory item.",
);
requireText(
  editRoute,
  "confirmInstaCompAiLocalLesson({",
  "Seller-confirmed corrections must be teachable to the private Mac engine.",
);
requireText(
  editRoute,
  'identity_source: "seller_manual_edit"',
  "Seller correction metadata must record its human source.",
);
requireText(
  editRoute,
  "manualIdentityLocked: true",
  "Seller-confirmed identity must be locked against automatic replacement.",
);
requireText(
  editRoute,
  "suggestedPrice: null",
  "Seller identity correction must not silently auto-price the card.",
);
requireText(
  editRoute,
  "published: false",
  "Seller card correction must remain unpublished until downstream review.",
);

console.log("InstaComp local-primary contract passed: local Ollama is evidence-only, Registry remains identity authority, seller corrections are protected, and outside identity readers stay disabled.");
