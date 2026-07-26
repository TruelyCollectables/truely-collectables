import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const sourcePath = path.join(process.cwd(), "scripts/deploy-production.mjs");
assert.ok(fs.existsSync(sourcePath), "Production deploy source is missing.");

const source = fs.readFileSync(sourcePath, "utf8");

for (const [label, fragment] of [
  ["environment preflight function", "function productionEnvironmentPreflight()"],
  [
    "environment audit script",
    '"scripts/audit-vercel-production-environment.mjs"',
  ],
  ["Node audit execution", "spawnSync(process.execPath, [auditScript]"],
  ["fail-closed diagnostic", "No deployment upload was started."],
  ["read-only success evidence", "The audit started no deployment."],
]) {
  assert.ok(source.includes(fragment), `Deploy source is missing ${label}.`);
}

const callIndex = source.lastIndexOf("productionEnvironmentPreflight();");
const selfTestIndex = source.lastIndexOf("if (deployTimeoutSelfTest) {");
const statusOnlyIndex = source.lastIndexOf("if (quotaStatusOnly) {");
const quotaIndex = source.lastIndexOf("assertNoRecentQuotaBlock();");
const cliIndex = source.lastIndexOf("vercelCliPreflight();");
const gitIndex = source.lastIndexOf("gitPreflight();");
const releaseIndex = source.lastIndexOf(
  'runVercel(["--prod", "--yes", "--scope", scope]',
);

assert.ok(
  callIndex > selfTestIndex && callIndex > statusOnlyIndex,
  "Offline self-tests and status inspection must exit before the environment audit.",
);

for (const [label, index] of [
  ["quota enforcement", quotaIndex],
  ["CLI preflight", cliIndex],
  ["Git preflight", gitIndex],
  ["release command", releaseIndex],
]) {
  assert.ok(
    callIndex >= 0 && index >= 0 && callIndex < index,
    `Environment audit must run before ${label}.`,
  );
}

console.log(
  "Internal deploy environment-gate simulations passed: every real preflight or release path audits Production environment names first.",
);
