import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");

const desiredReaders = route.match(
  /function desiredAiCouncilReaders\([\s\S]*?\n}\n\nfunction dataUrlMimeType/,
)?.[0];
assert.ok(desiredReaders, "desiredAiCouncilReaders block was not found");
assert.match(desiredReaders, /return 0;/);
assert.doesNotMatch(
  desiredReaders,
  /courtroom|dealer|high_end|INSTACOMP_AI_COUNCIL_ALWAYS_ON|INSTACOMP_AI_COUNCIL_MIN_READERS/,
);

const providerPlan = route.match(
  /function buildAiCouncilProviderPlan\(\)[\s\S]*?\n}\n\nasync function identifyCardWithOpenAiCompatibleCouncilProvider/,
)?.[0];
assert.ok(providerPlan, "buildAiCouncilProviderPlan block was not found");
assert.match(providerPlan, /return \[\];/);
assert.doesNotMatch(providerPlan, /builtInAiCouncilProviderPlan|customAiCouncilProviderSlots/);

assert.doesNotMatch(route, /provider:\s*"openai_emergency"/);
assert.match(route, /runSecondaryVision:\s*false/);
assert.match(route, /requestedTier:\s*"basic"/);

console.log("InstaComp no-external-reader execution plan gate passed.");
