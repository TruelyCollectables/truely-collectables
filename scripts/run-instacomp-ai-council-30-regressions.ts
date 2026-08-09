import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { shouldContinueCouncilRuntime } from "../src/lib/instacomp-ai-council-runtime";

const route = readFileSync(
  resolve(process.cwd(), "src/app/api/instacomp/scan/route.ts"),
  "utf8",
);
const runtime = readFileSync(
  resolve(process.cwd(), "src/lib/instacomp-ai-council-runtime.ts"),
  "utf8",
);

const checks: Array<[string, boolean]> = [
  [
    "legacy council configuration remains bounded if retained for compatibility",
    route.includes("const INSTACOMP_AI_COUNCIL_MAX_READERS = 30;"),
  ],
  [
    "production scan policy is pinned to the basic local-only identity lane",
    route.includes('requestedTier: "basic",'),
  ],
  [
    "production scan never runs outside secondary identity readers",
    route.includes("runSecondaryVision: false"),
  ],
  [
    "shared council runtime is fail-closed even if callers request capacity",
    runtime.includes("Production identity belongs exclusively to InstaComp AI on the Mac.") &&
      runtime.includes("return false;"),
  ],
  [
    "outside providers cannot regain an identity vote through the legacy family winner path",
    route.includes(".filter((councilReader) => councilReader.voteEligible)") &&
      route.includes("runSecondaryVision: false"),
  ],
  [
    "checklist Registry remains the non-model exact-identity referee",
    route.includes("buildChecklistRegistryCatalogEvidence") &&
      route.includes("buildInstaCompEvidenceIdentityDecision"),
  ],
];

for (const [label, passed] of checks) {
  assert.equal(passed, true, label);
}

for (const scenario of [
  {
    completedReaders: 0,
    desiredReaders: 30,
    completedFamilies: [] as string[],
    configuredFamilies: ["google", "groq", "openai"],
    cursor: 0,
    configuredReaderCount: 30,
    primaryFamily: "instacomp_internal",
  },
  {
    completedReaders: 6,
    desiredReaders: 8,
    completedFamilies: ["google", "groq"],
    configuredFamilies: ["google", "groq", "ollama"],
    cursor: 8,
    configuredReaderCount: 12,
    primaryFamily: "instacomp_internal",
  },
  {
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["google", "groq"],
    configuredFamilies: ["google", "groq", "ollama"],
    cursor: 8,
    configuredReaderCount: 12,
    primaryFamily: "instacomp_internal",
  },
]) {
  assert.equal(
    shouldContinueCouncilRuntime(scenario),
    false,
    "outside identity council must remain hard-disabled regardless of requested or reserve capacity",
  );
}

console.log(
  `InstaComp local-only identity council regressions passed (${checks.length + 3} assertions).`,
);
