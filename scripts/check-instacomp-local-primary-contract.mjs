import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message);
}

const route = read("src/app/api/instacomp/scan/route.ts");
const client = read("src/lib/instacomp-ai-local.ts");
const editRoute = read(
  "src/app/api/account/seller/inventory/instacomp-card-edit/route.ts",
);
const readinessRoute = read(
  "src/app/api/instacomp/internal-readiness/route.ts",
);
const service = read("services/instacomp-ai/app/main.py");
const storage = read("services/instacomp-ai/app/storage.py");
const images = read("services/instacomp-ai/app/images.py");
const models = read("services/instacomp-ai/app/models.py");
const ollama = read("services/instacomp-ai/app/ollama.py");

const internalProvider = route.indexOf('provider: "instacomp_internal"');
const emergencyProvider = route.indexOf('provider: "openai_emergency"');
if (internalProvider < 0 || emergencyProvider < 0 || internalProvider >= emergencyProvider) {
  throw new Error(
    "Website provider order must be InstaComp internal first and OpenAI emergency second.",
  );
}
if (route.includes('provider: "openai_primary"')) {
  throw new Error("OpenAI may not be configured as the primary card reader.");
}
requireText(
  route,
  "const preflightSerialOcrPromise = null;",
  "OpenAI serial vision must not preflight before InstaComp.",
);
requireText(
  route,
  'primaryAiResult.family === "openai" && shouldRunSerialVision',
  "OpenAI serial vision must be limited to the emergency OpenAI path.",
);
requireText(
  route,
  'primaryAiResult.family !== "instacomp_internal"',
  "Known internal matches must not start the external AI council.",
);

const visualMemory = service.indexOf("find_trusted_image_match");
const ollamaBackupCall = service.indexOf("reader.analyze");
if (visualMemory < 0 || ollamaBackupCall < 0 || visualMemory >= ollamaBackupCall) {
  throw new Error("Trusted InstaComp visual memory must run before Ollama backup.");
}
requireText(
  ollama,
  'provider="instacomp_ollama_backup"',
  "Ollama must identify itself as the backup reader.",
);
requireText(
  ollama,
  '"back_visible_text": []',
  "Ollama backup must return separate back-only visible text.",
);
requireText(
  models,
  "back_visible_text: list[str]",
  "The local evidence schema must retain back-only printed text.",
);
requireText(
  images,
  "REFERENCE_MAX_EDGE = 384",
  "Compact reference images must remain capped at 384px.",
);
requireText(
  images,
  'format="WEBP"',
  "Compact learned card references must use WebP.",
);
requireText(
  storage,
  "exact_image_pair",
  "Trusted exact image-pair memory matching is required.",
);
requireText(
  storage,
  "trusted_visual_memory",
  "Trusted near-visual memory matching is required.",
);
requireText(
  storage,
  "if not back_perceptual_hash:",
  "Near-visual automation must require both sides.",
);
requireText(
  storage,
  "front_distance > 4",
  "Front visual-memory distance must stay strict.",
);
requireText(
  storage,
  "back_distance > 4",
  "Back visual-memory distance must stay strict.",
);
requireText(
  storage,
  "score < 0.9375",
  "Near-visual trusted-memory confidence must remain at least 93.75%.",
);
requireText(
  storage,
  "identity.serial_run",
  "The print run must be part of the learned identity fingerprint.",
);
if (storage.includes("identity.serial_number,")) {
  throw new Error(
    "The individual copy number may not be part of the learned identity fingerprint.",
  );
}

requireText(
  client,
  "internalScanId: safeScanId(scan.scan_id)",
  "The website must retain the internal scan receipt for later teaching.",
);
requireText(
  client,
  "confirmInstaCompAiLocalLesson",
  "The website must expose seller-confirmed lesson storage.",
);
requireText(
  client,
  "const backEvidence = [...backVisibleText, ...backNotes]",
  "The website must pass dedicated back evidence into identity rules.",
);
requireText(
  client,
  "backEvidence,",
  "The card result must retain back-only evidence.",
);
requireText(
  editRoute,
  "await confirmInstaCompAiLocalLesson",
  "Seller corrections must teach the internal engine.",
);
requireText(
  editRoute,
  'learningStatus = "stored"',
  "Seller correction learning must record a durable success state.",
);
requireText(
  editRoute,
  "serial_run: printRunNumber(normalizedPrintRun)",
  "Seller corrections must teach only the print-run denominator.",
);
requireText(
  editRoute,
  "manualIdentityLocked: true",
  "Seller corrections must remain authoritative and locked.",
);

requireText(
  readinessRoute,
  "internalMemoryReady",
  "Production must expose a safe internal-memory readiness receipt.",
);
requireText(
  readinessRoute,
  "checklistReady",
  "Production readiness must include the Checklist Registry.",
);
if (readinessRoute.includes("INSTACOMP_AI_LOCAL_URL:")) {
  throw new Error("The public readiness response may not expose the internal URL.");
}

console.log(
  "InstaComp internal memory -> Checklist Registry -> Ollama backup -> OpenAI emergency contract passed.",
);
