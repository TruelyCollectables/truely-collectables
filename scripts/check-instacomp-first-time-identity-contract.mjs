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
  "readInstaCompCoreVisualEvidence",
  "filterCandidatesByProduct",
  "resolveInstaCompChecklistFirstFromRegistry",
  "resolveChecklistParallelFromVision",
  "year_product_player_card_then_color_pattern_serial",
  "archiveWithMacBestEffort",
  "status: identityComplete ? 200 : 202",
]) {
  requireText(exact, required, `Exact route is missing: ${required}`);
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
  "suggestion = await reader.analyze(",
  "suggestion_registry = await checklist_gateway.match(",
  "suggestion_registry.identity_id",
  'receipt.startswith("registry_fingerprint:")',
  'match_source = "ollama_backup"',
  'status = "model_unavailable"',
  "pricing_allowed = False",
]) {
  requireText(
    mac,
    required,
    `Mac first-time evidence fallback is missing: ${required}`,
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
requireText(
  intake,
  'from "../instacomp-front-back-exact/route"',
  "Fresh scanner intake must use the repaired exact route.",
);

const config = read("next.config.ts");
requireText(
  config,
  'destination: "/api/kingmaker/instacomp-front-back-exact"',
  "Pending retries must use the repaired exact route.",
);

console.log("First-time card identity deadlock repair contract passed.");
