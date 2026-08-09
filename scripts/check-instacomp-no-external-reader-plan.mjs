import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
const runtime = readFileSync(
  "src/lib/instacomp-ai-council-runtime.ts",
  "utf8",
);

const runtimeGate = runtime.match(
  /export function shouldContinueCouncilRuntime\([\s\S]*?\n}/,
)?.[0];
assert.ok(runtimeGate, "shared council runtime gate was not found");
assert.match(runtimeGate, /return false;/);
assert.doesNotMatch(runtimeGate, /return\s*\(/);

assert.doesNotMatch(route, /provider:\s*"openai_emergency"/);
assert.match(route, /provider:\s*"instacomp_internal"/);
assert.match(route, /const serialOcr = null as InstaCompSerialOcrResult \| null;/);

console.log("InstaComp no-external-reader execution gate passed.");
