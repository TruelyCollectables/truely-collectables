import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label}: required text was not found`);
  }
}

function forbidText(source, forbidden, label) {
  if (source.includes(forbidden)) {
    throw new Error(`${label}: forbidden text is still present`);
  }
}

const main = read("services/instacomp-ai/app/main.py");
const storage = read("services/instacomp-ai/app/storage.py");
const models = read("services/instacomp-ai/app/models.py");
const readiness = read("src/app/api/instacomp/internal-readiness/route.ts");
const localClient = read("src/lib/instacomp-ai-local.ts");
const queue = read("src/app/api/admin/card-listing-queue/route.ts");
const queueUi = read("src/app/admin/pending-card-import/TcosListingGateway.tsx");
const scanRoute = read("src/app/api/instacomp/scan/route.ts");
const councilRuntime = read("src/lib/instacomp-ai-council-runtime.ts");

forbidText(main, "OllamaReader", "Mac service must not instantiate Ollama");
forbidText(main, "reader.analyze(", "Mac scan path must not call a model reader");
forbidText(main, "import httpx", "Mac scan path must not depend on HTTP model calls");
requireText(main, '"engine_mode": "catalog_only"', "Mac health must advertise catalog-only mode");
requireText(main, '"/v1/scans/reset"', "Mac reset endpoint must exist");
requireText(main, "No exact catalog identity was proven", "Unresolved cards must become manual review");
requireText(storage, "def reset_scans(self, scan_ids", "Selective scan reset must exist");
requireText(models, 'engine_mode: Literal["catalog_only"]', "Health schema must lock catalog-only mode");
requireText(localClient, "resetInstaCompAiLocalScans", "Website must reset matching Mac receipts");
requireText(queue, 'action === "reset-all-catalog-only"', "Queue reset action must exist");
requireText(queue, "catalogOnlyReset", "Pending state backup must be retained in metadata");
requireText(queue, "imagesPreserved: true", "Reset must explicitly preserve images");
requireText(queueUi, "Reset all pending + catalog rescan", "Owner reset control must exist");
requireText(readiness, "catalogOnlyReady", "Readiness must not require a model");
requireText(readiness, "generativeReadersDisabled", "Readiness must disclose disabled model readers");
requireText(councilRuntime, "return false", "External council runtime must remain hard-stopped");
forbidText(scanRoute, 'provider: "openai_emergency"', "OpenAI emergency identity reader");
forbidText(scanRoute, 'provider: "openai_primary"', "OpenAI primary identity reader");

console.log("Catalog-only reset architecture gate passed.");
