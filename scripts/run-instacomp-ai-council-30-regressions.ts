import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/instacomp/scan/route.ts"),
  "utf8",
);

const checks: Array<[string, boolean]> = [
  [
    "AI council hard cap is 30",
    route.includes("const INSTACOMP_AI_COUNCIL_MAX_READERS = 30;"),
  ],
  [
    "default minimum backup council is 8",
    route.includes("process.env.INSTACOMP_AI_COUNCIL_MIN_READERS || 8"),
  ],
  [
    "adaptive scans run the backup council unless explicitly disabled",
    route.includes("const INSTACOMP_AI_COUNCIL_ALWAYS_ON =") &&
      route.includes("return INSTACOMP_AI_COUNCIL_MIN_READERS;"),
  ],
  [
    "tiers scale through 12, 16, 24, and 30 readers",
    route.includes('if (tier === "pro") return 12;') &&
      route.includes('if (tier === "dealer") return 16;') &&
      route.includes('tier === "high_end" || tier === "high-end"') &&
      route.includes("return 24;") &&
      route.includes("return INSTACOMP_AI_COUNCIL_MAX_READERS;"),
  ],
  [
    "custom OpenAI-compatible slots are configurable without exposing secrets",
    route.includes("INSTACOMP_AI_COUNCIL_${slot}") &&
      route.includes("`${prefix}_BASE_URL`") &&
      route.includes("`${prefix}_API_KEY`") &&
      route.includes("`${prefix}_MODEL`") &&
      !route.includes("apiKey: providerMeta.apiKey"),
  ],
  [
    "reader passes include full, OCR, parallel, and clean-context views",
    route.includes('detailMode: "full"') &&
      route.includes('detailMode: "ocr"') &&
      route.includes('detailMode: "parallel"') &&
      route.includes('detailMode: "context"'),
  ],
  [
    "failed readers are replaced from reserve capacity",
    route.includes("while (") &&
      route.includes("completedReaders < desiredReaders") &&
      route.includes("cursor < configuredPlan.length"),
  ],
  [
    "only one reader per AI family is eligible to vote",
    route.includes("function markAiCouncilFamilyWinners") &&
      route.includes("winners.set(reader.family, reader)") &&
      route.includes(".filter((councilReader) => councilReader.voteEligible)"),
  ],
  [
    "checklist evidence remains outside the AI family vote cap",
    route.includes("buildChecklistRegistryCatalogEvidence") &&
      route.includes("buildInstaCompEvidenceIdentityDecision"),
  ],
];

for (const [label, passed] of checks) {
  assert.equal(passed, true, label);
}

console.log(`InstaComp 8-30 AI council regressions passed (${checks.length} assertions).`);
