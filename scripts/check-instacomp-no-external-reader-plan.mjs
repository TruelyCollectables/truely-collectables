import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const runtime = readFileSync(
  "src/lib/instacomp-ai-council-runtime.ts",
  "utf8",
);

assert.match(runtime, /export function shouldContinueCouncilRuntime/);
assert.match(runtime, /void params;/);
assert.match(runtime, /return false;/);
assert.doesNotMatch(runtime, /return true;/);

assert.doesNotMatch(route, /provider:\s*"openai_emergency"/);
assert.match(route, /provider:\s*"instacomp_internal"/);
assert.match(route, /const serialOcr = null as InstaCompSerialOcrResult \| null;/);
assert.match(route, /analyzeWithInstaCompAiLocalSecondary/);
assert.match(route, /secondary_vision_instacomp_local_established/);
assert.match(route, /family: \"instacomp_local_established\"/);
assert.match(route, /consensusEscalation\.runSecondaryVision && !primaryUsedEstablishedOllama/);

console.log("InstaComp no-external-reader execution gate passed.");
