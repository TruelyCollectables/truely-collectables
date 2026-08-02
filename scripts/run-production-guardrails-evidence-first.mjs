import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(scriptsDir, "check-production-guardrails.mjs");
const generatedPath = resolve(
  scriptsDir,
  ".check-production-guardrails-evidence-first.generated.mjs",
);

const staleMarker = '  "buildInstaCompCuratedChecklistEvidence",\n';
const evidenceFirstMarkers = [
  '  "resolveChecklistRegistry",',
  '  "buildChecklistRegistryReviewEvidence",',
  '  "buildInstaCompEvidenceIdentityDecision",',
  '  "evidenceConsensus",',
  '  "identityDecision.confirmed",',
  '  "threshold: 0.95",',
  "",
].join("\n");

const source = readFileSync(sourcePath, "utf8");
const occurrences = source.split(staleMarker).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected exactly one stale curated-checklist route marker, found ${occurrences}.`,
  );
}

writeFileSync(
  generatedPath,
  source.replace(staleMarker, evidenceFirstMarkers),
  "utf8",
);

try {
  await import(`${pathToFileURL(generatedPath).href}?v=${Date.now()}`);
} finally {
  unlinkSync(generatedPath);
}
