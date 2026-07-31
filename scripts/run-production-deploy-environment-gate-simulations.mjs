import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const packagePath = path.join(process.cwd(), "package.json");
const auditPath = path.join(
  process.cwd(),
  "scripts/audit-vercel-production-environment.mjs",
);

for (const requiredPath of [packagePath, auditPath]) {
  assert.ok(fs.existsSync(requiredPath), `Required deploy-gate source is missing: ${requiredPath}`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const scripts = packageJson.scripts || {};
const auditCommand = "node scripts/audit-vercel-production-environment.mjs";

assert.equal(
  scripts["audit:vercel-production-env"],
  auditCommand,
  "The production environment audit command must remain explicit and read only.",
);
assert.equal(
  scripts["audit:vercel-production-env:json"],
  `${auditCommand} --json`,
  "The production environment audit must retain JSON evidence output.",
);
assert.equal(
  scripts["audit:vercel-production-env:self-test"],
  `${auditCommand} --self-test`,
  "The production environment audit must retain a no-network self-test.",
);
assert.equal(
  scripts["preflight:production"],
  "npm run audit:vercel-production-env && node scripts/deploy-production.mjs --preflight-only",
  "Production preflight must audit Vercel Production environment names before deployment preflight.",
);
assert.equal(
  scripts["deploy:production"],
  "npm run audit:vercel-production-env && node scripts/deploy-production.mjs",
  "Production deployment must audit Vercel Production environment names before the upload-capable deploy script.",
);
assert.equal(
  scripts["launch:production"],
  "npm run verify:production && npm run deploy:production && npm run smoke:production",
  "The supported launch path must preserve verify, deploy and smoke ordering.",
);

for (const scriptName of ["preflight:production", "deploy:production"]) {
  const command = String(scripts[scriptName] || "");
  const auditIndex = command.indexOf("npm run audit:vercel-production-env");
  const deployIndex = command.indexOf("node scripts/deploy-production.mjs");
  assert.ok(
    auditIndex >= 0 && deployIndex >= 0 && auditIndex < deployIndex,
    `${scriptName} must run the environment audit before the deployment script.`,
  );
}

const auditSource = fs.readFileSync(auditPath, "utf8");
assert.match(
  auditSource,
  /runPinnedVercel\s*\(\s*\[\s*"env"\s*,\s*"ls"\s*,\s*"production"\s*,/m,
  "Vercel production audit is missing Production environment listing.",
);

for (const [label, fragment] of [
  ["no deployment evidence", "deploymentStarted: false"],
  ["no secret-value evidence", "valuesReadOrPrinted: false"],
  ["missing service-role key requirement", '"SUPABASE_SERVICE_ROLE_KEY"'],
  ["read-only guarantee", "It lists Vercel Production environment variable names only."],
]) {
  assert.ok(auditSource.includes(fragment), `Vercel production audit is missing ${label}.`);
}

console.log(
  "Production deploy environment-gate simulations passed: preflight and deploy commands audit Vercel Production variable names before any upload-capable path.",
);
