import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const runtime = readFileSync(
  "src/lib/instacomp-ai-council-runtime.ts",
  "utf8",
);

// The parameter itself is an object type, so a lazy match to the first `\n}`
// stops at the type declaration instead of the function body. Match through
// `}) {` first, then inspect the actual implementation.
const runtimeGate = runtime.match(
  /export function shouldContinueCouncilRuntime\([\s\S]*?\}\)\s*\{[\s\S]*?\n\}/,
)?.[0];
assert.ok(runtimeGate, "shared council runtime gate was not found");
assert.match(runtimeGate, /return false;/);
assert.doesNotMatch(runtimeGate, /return\s*\(/);

assert.doesNotMatch(route, /provider:\s*"openai_emergency"/);
assert.match(route, /runSecondaryVision:\s*false/);
assert.match(route, /requestedTier:\s*"basic"/);

console.log("InstaComp no-external-reader execution gate passed.");
