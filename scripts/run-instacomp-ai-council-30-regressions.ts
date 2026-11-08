import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { shouldContinueCouncilRuntime } from "../src/lib/instacomp-ai-council-runtime";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/instacomp/scan/route.ts"),
  "utf8",
);

const runtimeSource = readFileSync(
  resolve(process.cwd(), "src/lib/instacomp-ai-council-runtime.ts"),
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
    "adaptive scans retain the dormant backup council plan",
    route.includes("const INSTACOMP_AI_COUNCIL_ALWAYS_ON =") &&
      route.includes("return INSTACOMP_AI_COUNCIL_MIN_READERS;"),
  ],
  [
    "tiers retain 12, 16, 24, and 30 reader capacity definitions",
    route.includes('if (tier === "pro") return 12;') &&
      route.includes('if (tier === "dealer") return 16;') &&
      route.includes('tier === "high_end" || tier === "high-end"') &&
      route.includes("return 24;") &&
      route.includes("return INSTACOMP_AI_COUNCIL_MAX_READERS;"),
  ],
  [
    "custom OpenAI-compatible slots remain configurable without exposing secrets",
    route.includes("INSTACOMP_AI_COUNCIL_${slot}") &&
      route.includes("`${prefix}_BASE_URL`") &&
      route.includes("`${prefix}_API_KEY`") &&
      route.includes("`${prefix}_MODEL`") &&
      !route.includes("apiKey: providerMeta.apiKey"),
  ],
  [
    "reader passes retain full, OCR, parallel, and clean-context definitions",
    route.includes('detailMode: "full"') &&
      route.includes('detailMode: "ocr"') &&
      route.includes('detailMode: "parallel"') &&
      route.includes('detailMode: "context"'),
  ],
  [
    "route delegates council continuation to the shared runtime kill-switch",
    route.includes("while (") &&
      route.includes("shouldContinueCouncilRuntime({") &&
      route.includes("completedReaders,") &&
      route.includes("configuredReaderCount: configuredPlan.length"),
  ],
  [
    "only one reader per AI family would be eligible to vote if council runtime is restored",
    route.includes("function markAiCouncilFamilyWinners") &&
      route.includes("winners.set(reader.family, reader)") &&
      route.includes(".filter((councilReader) => councilReader.voteEligible)"),
  ],
  [
    "checklist evidence remains outside the dormant AI family vote cap",
    route.includes("buildChecklistRegistryCatalogEvidence") &&
      route.includes("buildInstaCompEvidenceIdentityDecision"),
  ],
  [
    "website council execution is explicitly disabled because production identity belongs to InstaComp AI on the Mac",
    runtimeSource.includes("Production identity belongs exclusively to InstaComp AI on the Mac.") &&
      runtimeSource.includes("return false;"),
  ],
];

for (const [label, passed] of checks) {
  assert.equal(passed, true, label);
}

for (const scenario of [
  {
    completedReaders: 6,
    desiredReaders: 8,
    completedFamilies: ["google", "groq"],
    configuredFamilies: ["google", "groq", "ollama"],
    cursor: 8,
    configuredReaderCount: 12,
    primaryFamily: "openai",
  },
  {
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["google"],
    configuredFamilies: ["google", "groq"],
    cursor: 8,
    configuredReaderCount: 12,
    primaryFamily: "google",
  },
  {
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["google", "groq"],
    configuredFamilies: ["google", "groq", "ollama"],
    cursor: 8,
    configuredReaderCount: 12,
    primaryFamily: "google",
  },
]) {
  assert.equal(
    shouldContinueCouncilRuntime(scenario),
    false,
    "website AI council runtime remains disabled for every capacity/family state",
  );
}

console.log(`InstaComp 8-30 council boundary regressions passed (${checks.length + 3} assertions).`);
