import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const runtime = readFileSync(
  "src/lib/instacomp-ai-council-runtime.ts",
  "utf8",
);

const runtimeStart = runtime.indexOf(
  "export function shouldContinueCouncilRuntime(",
);
assert.notEqual(runtimeStart, -1, "shared council runtime gate was not found");
const runtimeTail = runtime.slice(runtimeStart);
const runtimeEnd = runtimeTail.indexOf("\n}\n", runtimeTail.indexOf(") {"));
assert.notEqual(runtimeEnd, -1, "shared council runtime gate body was not found");
const runtimeGate = runtimeTail.slice(0, runtimeEnd + 3);

assert.match(runtimeGate, /Production identity belongs exclusively to InstaComp AI on the Mac\./);
assert.match(runtimeGate, /return false;/);
assert.doesNotMatch(runtimeGate, /return\s*\(/);

assert.doesNotMatch(route, /provider:\s*"openai_emergency"/);
assert.match(route, /runSecondaryVision:\s*false/);
assert.match(route, /requestedTier:\s*"basic"/);

console.log("InstaComp no-external-reader execution gate passed.");
