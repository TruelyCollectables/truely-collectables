import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(scriptsDir, "check-production-guardrails.mjs");

const evidenceFirstMarkers = [
  '  "resolveChecklistRegistry",',
  '  "buildChecklistRegistryCatalogEvidence",',
  '  "buildChecklistRegistryReviewEvidence",',
  '  "buildInstaCompEvidenceIdentityDecision",',
  '  "evidenceTrusted: evidenceConsensus.trustedForIdentity",',
  '  "catalogEvidenceToConsensusReferee",',
];
const routeAssertionPattern =
  /assertFileIncludes\(\s*"instacomp multi-scanner consensus route wiring",\s*"src\/app\/api\/instacomp\/scan\/route\.ts",\s*\[[\s\S]*?\n\]\);/g;

const source = readFileSync(sourcePath, "utf8");
const routeAssertions = [...source.matchAll(routeAssertionPattern)].map(
  (match) => match[0],
);

if (routeAssertions.length !== 1) {
  throw new Error(
    `Expected one InstaComp multi-scanner route guardrail assertion; found ${routeAssertions.length}.`,
  );
}

for (const marker of evidenceFirstMarkers) {
  if (!routeAssertions[0].includes(marker)) {
    throw new Error(
      `The InstaComp route guardrail is missing evidence-first marker ${marker.trim()}.`,
    );
  }
}

await import(`${pathToFileURL(sourcePath).href}?evidence-first=${Date.now()}`);
