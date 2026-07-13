import { spawnSync } from "node:child_process";
import fs from "node:fs";

const node = process.execPath;
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts || {};

function assertScriptIncludes(scriptName, expectedParts) {
  const script = scripts[scriptName];

  if (!script) {
    throw new Error(`package.json is missing required script: ${scriptName}`);
  }

  const missing = expectedParts.filter((part) => !script.includes(part));

  if (missing.length > 0) {
    throw new Error(
      `${scriptName} is missing required command(s): ${missing.join(", ")}\nActual: ${script}`,
    );
  }

  console.log(`PASS ${scriptName} includes ${expectedParts.join(", ")}`);
}

function assertFileIncludes(filePath, expectedParts) {
  const text = fs.readFileSync(filePath, "utf8");
  const missing = expectedParts.filter((part) => !text.includes(part));

  if (missing.length > 0) {
    throw new Error(
      `${filePath} is missing required production guardrail text: ${missing.join(", ")}`,
    );
  }

  console.log(`PASS ${filePath} includes ${expectedParts.join(", ")}`);
}

function runExpectedSuccess(name, args, env = {}) {
  const result = spawnSync(node, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (result.status !== 0) {
    throw new Error(`${name} failed unexpectedly.\n${output}`);
  }

  console.log(`PASS ${name}`);
}

function runExpectedFailure(name, args, env, expectedText) {
  const result = spawnSync(node, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (result.status === 0) {
    throw new Error(`${name} unexpectedly passed.\n${output}`);
  }

  if (!output.includes(expectedText)) {
    throw new Error(
      `${name} failed, but did not print the expected guardrail message.\nExpected: ${expectedText}\nActual:\n${output}`,
    );
  }

  console.log(`PASS ${name}`);
}

runExpectedSuccess("deploy helper syntax check", [
  "--check",
  "scripts/deploy-production.mjs",
]);
runExpectedSuccess("smoke helper syntax check", [
  "--check",
  "scripts/smoke-production.mjs",
]);
runExpectedSuccess("shipping simulation runner syntax check", [
  "--import",
  "tsx",
  "--check",
  "scripts/run-shipping-simulations.ts",
]);
assertScriptIncludes("verify:shipping", [
  "simulate:lettertrack-evidence",
  "simulate:shipping",
]);
assertScriptIncludes("verify:production", [
  "verify:instacomp",
  "verify:shipping",
  "check:production-guardrails",
  "preflight:production",
]);
assertScriptIncludes("launch:production", [
  "verify:production",
  "deploy:production",
  "smoke:production",
]);
assertFileIncludes("scripts/smoke-production.mjs", [
  'name: "shipping simulation api"',
  'path: "/api/admin/shipping/simulations"',
  'options: { method: "POST" }',
  "const queuedFeatureCheckNames = [",
  "Queued feature smoke manifest references unknown check(s):",
  '"launch handoff bundle"',
  '"launch readiness page"',
  '"production smoke report page"',
  '"shipping simulation lab"',
  '"shipping simulation api"',
  '"shipping provider setup json"',
  '"shipping provider env template"',
  '"shipping provider vercel commands"',
  '"shipping provider operator checklist"',
  '"shipping exceptions export"',
  '"lettertrack standard envelope export"',
  "Queued launch feature failure(s):",
  '"scenario_count":13',
  '"expected_scenario_count":13',
  '"scenario_key_coverage_status":"passed"',
  '"missing_scenario_keys":[]',
  '"unexpected_scenario_keys":[]',
]);
runExpectedSuccess(
  "smoke diagnostic redaction self-test",
  ["scripts/smoke-production.mjs", "--self-test-redaction"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "https://truely-collectables.vercel.app",
  },
);

runExpectedFailure(
  "deploy refuses clean domain matching unwanted alias",
  ["scripts/deploy-production.mjs", "--preflight-only"],
  {
    VERCEL_CLEAN_DOMAIN: "https://truely-collectables-tt3b.vercel.app/",
    VERCEL_UNWANTED_ALIAS: "truely-collectables-tt3b.vercel.app",
  },
  "Refusing production deploy because VERCEL_CLEAN_DOMAIN matches the unwanted alias",
);

runExpectedFailure(
  "smoke refuses unwanted alias before admin auth",
  ["scripts/smoke-production.mjs"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "TRUELY-COLLECTABLES-TT3B.vercel.app/smoke-path",
    SMOKE_UNWANTED_ALIAS_URL: "https://truely-collectables-tt3b.vercel.app/",
  },
  "Refusing to smoke test the unwanted production alias",
);

console.log("Production guardrail checks passed.");
