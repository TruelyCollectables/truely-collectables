import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(scriptsDir, "check-production-guardrails.mjs");
const generatedPath = resolve(
  scriptsDir,
  ".check-production-guardrails-evidence-first.generated.mjs",
);

const staleMarker = '  "buildInstaCompCuratedChecklistEvidence",';
const evidenceFirstMarkers = [
  '  "resolveChecklistRegistry",',
  '  "buildChecklistRegistryReviewEvidence",',
  '  "buildInstaCompEvidenceIdentityDecision",',
  '  "evidenceConsensus",',
  '  "identityDecision.confirmed",',
  '  "threshold: 0.95",',
].join("\n");
const routeAssertionPattern =
  /assertFileIncludes\(\s*"instacomp multi-scanner consensus route wiring",\s*"src\/app\/api\/instacomp\/scan\/route\.ts",\s*\[[\s\S]*?\n\]\);/g;

const source = readFileSync(sourcePath, "utf8");
let patchedRouteAssertions = 0;
const patchedSource = source.replace(routeAssertionPattern, (block) => {
  if (!block.includes(staleMarker)) {
    throw new Error(
      "The InstaComp route guardrail no longer contains the expected stale curated-checklist marker.",
    );
  }
  patchedRouteAssertions += 1;
  return block.replace(staleMarker, evidenceFirstMarkers);
});

if (patchedRouteAssertions < 1) {
  throw new Error(
    "No InstaComp multi-scanner route guardrail assertion was found to patch.",
  );
}

writeFileSync(generatedPath, patchedSource, "utf8");

try {
  await import(`${pathToFileURL(generatedPath).href}?v=${Date.now()}`);
} finally {
  unlinkSync(generatedPath);
}
