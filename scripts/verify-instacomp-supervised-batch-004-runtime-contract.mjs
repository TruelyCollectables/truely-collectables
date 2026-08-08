import assert from "node:assert/strict";
import fs from "node:fs";

const routePath = "src/app/api/release/instacomp-supervised-batch-004/route.ts";
const truthPath = "src/lib/instacomp-supervised-batch-004.ts";
const route = fs.readFileSync(routePath, "utf8");
const truth = fs.readFileSync(truthPath, "utf8");

const checks = [
  ["Vercel team token authorization", () => assert.match(route, /releaseRuntimeTeamIsAllowed/)],
  ["Vercel team validation", () => assert.match(route, /https:\/\/api\.vercel\.com\/v2\/teams\?limit=100/)],
  ["private Mac URL", () => assert.match(route, /process\.env\.INSTACOMP_AI_LOCAL_URL/)],
  ["private Mac key", () => assert.match(route, /process\.env\.INSTACOMP_AI_LOCAL_KEY/)],
  ["trusted training examples only", () => assert.match(route, /training\/examples\?trusted_only=true/)],
  ["internal Checklist Registry", () => assert.match(route, /resolveInstaCompChecklistFirstFromRegistry/)],
  ["read-only receipt", () => assert.match(route, /nothingMutated:\s*true/)],
  ["nothing published", () => assert.match(route, /nothingPublished:\s*true/)],
  ["no lessons mutation", () => assert.doesNotMatch(route, /\/v1\/lessons["'`]/)],
  ["no public card research", () => assert.doesNotMatch(route, /ebay|google|beckett|cardboard|comc|pricecharting/i)],
  ["Batch 004 contains 25 cards", () => assert.equal((truth.match(/ordinal:\s*\d+/g) || []).length, 25)],
  ["Alanna Smith Holo correction", () => assert.match(truth, /ordinal:\s*88[\s\S]*?player:\s*"Alanna Smith"[\s\S]*?parallel:\s*"Holo"/)],
  ["Alanna Smith unnumbered lesson", () => assert.match(truth, /exact parallel is Holo and the card is unnumbered/i)],
];

for (const [name, check] of checks) {
  try {
    check();
  } catch (error) {
    throw new Error(`Batch 004 runtime contract failed: ${name}`, { cause: error });
  }
}

console.log(JSON.stringify({ ok: true, contract: "instacomp-supervised-batch-004-runtime", checks: checks.length }, null, 2));
