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

function assertFileIncludes(name, filePath, expectedParts) {
  const text = fs.readFileSync(filePath, "utf8");
  const missing = expectedParts.filter((part) => !text.includes(part));

  if (missing.length > 0) {
    throw new Error(
      `${name} in ${filePath} is missing required production guardrail text: ${missing.join(", ")}`,
    );
  }

  console.log(`PASS ${name} includes ${expectedParts.join(", ")}`);
}

function assertFileOrder(name, filePath, orderedParts) {
  const text = fs.readFileSync(filePath, "utf8");
  let cursor = -1;

  for (const part of orderedParts) {
    const index = text.indexOf(part, cursor + 1);

    if (index === -1) {
      throw new Error(
        `${name} in ${filePath} is missing ordered production guardrail text after ${cursor}: ${part}`,
      );
    }

    cursor = index;
  }

  console.log(`PASS ${name} order includes ${orderedParts.join(" -> ")}`);
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
assertFileIncludes("shipping simulation API smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping simulation api"',
  'path: "/api/admin/shipping/simulations"',
  'options: { method: "POST" }',
  '"scenario_count":13',
  '"expected_scenario_count":13',
  '"scenario_key_coverage_status":"passed"',
  '"missing_scenario_keys":[]',
  '"unexpected_scenario_keys":[]',
]);
assertFileIncludes("queued-feature smoke manifest", "scripts/smoke-production.mjs", [
  "const queuedFeatureCheckNames = [",
  "Queued feature smoke manifest references unknown check(s):",
  "Queued feature smoke manifest contains duplicate check(s):",
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
]);
assertFileIncludes("smoke unwanted alias label", "scripts/smoke-production.mjs", [
  "unwanted ${unwantedAlias.url.hostname} alias absent",
  "SMOKE_UNWANTED_ALIAS_URL",
  "truely-collectables-tt3b.vercel.app",
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

assertFileIncludes("deploy preflight env flag", "scripts/deploy-production.mjs", [
  "process.env.TCOS_PRODUCTION_PREFLIGHT_ONLY",
  "Production deploy preflight passed. No Vercel deployment was started.",
]);

assertFileIncludes("deploy live safety contract", "scripts/deploy-production.mjs", [
  "api-deployments-free-per-day",
  "Wait for the rolling 24-hour quota to reset",
  "Removing unwanted ${unwantedAlias} alias if present",
  '"alias", "rm", unwantedAlias',
  '"alias", "set", deploymentUrl, cleanDomain',
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "npm run smoke:production",
]);

assertFileIncludes("deploy helper production target defaults", "scripts/deploy-production.mjs", [
  '"truely-collectables.vercel.app"',
  '"truely-collectables-tt3b.vercel.app"',
  "VERCEL_CLEAN_DOMAIN",
  "VERCEL_UNWANTED_ALIAS",
]);

assertFileIncludes("deploy helper quota block defaults", "scripts/deploy-production.mjs", [
  "deployOutput.includes(\"api-deployments-free-per-day\")",
  "Vercel deployment quota is still capped",
  "Wait for the rolling 24-hour quota to reset",
  "rerun npm run launch:production",
]);

assertFileIncludes("deploy helper parse diagnostics", "scripts/deploy-production.mjs", [
  "clean production domain (${cleanDomain})",
  "unwanted alias (${unwantedAlias})",
  "If quota is capped, wait and retry",
]);

assertFileIncludes("deploy helper smoke handoff", "scripts/deploy-production.mjs", [
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  'console.log("Next verification command if you ran deploy without the one-shot launch:");',
  'console.log("npm run smoke:production");',
]);

assertFileOrder("deploy live safety sequence", "scripts/deploy-production.mjs", [
  "Removing unwanted ${unwantedAlias} alias if present",
  '"alias", "rm", unwantedAlias',
  "Pointing https://${cleanDomain} at ${deploymentUrl}",
  '"alias", "set", deploymentUrl, cleanDomain',
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "Next verification command if you ran deploy without the one-shot launch:",
  "npm run smoke:production",
]);

assertFileIncludes("deploy live safety centralized source", "src/lib/deploy-safety.ts", [
  "const DEPLOY_SAFETY_SMOKE_COMMAND",
  "const DEPLOY_SAFETY = {",
  "function deploySafetyContractMarkdown()",
  "function deploySafetySequenceMarkdown()",
  "sequence: [",
  "smokeCommand: DEPLOY_SAFETY_SMOKE_COMMAND",
]);

assertFileIncludes("deploy live safety site origin source", "src/lib/site-origin.ts", [
  'import { DEPLOY_SAFETY } from "./deploy-safety"',
  "DEPLOY_SAFETY.cleanProductionDomain",
  "NEXT_PUBLIC_SITE_URL",
  "SITE_URL",
]);

assertFileIncludes(
  "live payment webhook smoke shared origin",
  "src/app/api/admin/live-payment-launch/webhook-smoke/route.ts",
  [
    "configuredSiteOrigin",
    "const origin = configuredSiteOrigin()",
    "const endpointUrl = `${origin}/api/webhook`",
  ],
);

assertFileIncludes("deploy live safety launch readiness route source", "src/app/api/admin/launch-readiness/route.ts", [
  "DEPLOY_SAFETY",
  "deploySafetyContractMarkdown",
  "deploySafetySequenceMarkdown",
  "function deploySafetyMarkdownLines()",
  "...deploySafetyMarkdownLines()",
  "deploySafetyContractMarkdown()} intact.",
  "deploySafety: DEPLOY_SAFETY",
]);

assertFileIncludes(
  "deploy safety export production target defaults",
  "src/lib/deploy-safety.ts",
  [
    'cleanProductionDomain: "https://truely-collectables.vercel.app"',
    'unwantedAlias: "truely-collectables-tt3b.vercel.app"',
  ],
);

assertFileIncludes(
  "deploy safety export smoke handoff",
  "src/lib/deploy-safety.ts",
  [
    'const DEPLOY_SAFETY_SMOKE_COMMAND = "npm run smoke:production"',
    "smokeCommand: DEPLOY_SAFETY_SMOKE_COMMAND",
    "${DEPLOY_SAFETY_SMOKE_COMMAND} handoff",
    "DEPLOY_SAFETY.smokeCommand",
  ],
);

assertFileIncludes(
  "deploy safety export quota block defaults",
  "src/lib/deploy-safety.ts",
  [
    'quotaBlockCode: "api-deployments-free-per-day"',
    "quotaResetInstruction:",
    "Wait for the rolling 24-hour quota reset before retrying npm run launch:production.",
  ],
);

assertFileIncludes("deploy live safety handoff bundle", "src/app/api/admin/launch-readiness/route.ts", [
  "deploy live safety contract",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "DEPLOY_SAFETY.smokeCommand",
  "deploySafetyContractMarkdown()",
  "Protected deploy sequence:",
  "deploySafetySequenceMarkdown()",
]);

assertFileIncludes("deploy live safety launch readiness markdown", "src/app/api/admin/launch-readiness/route.ts", [
  "DEPLOY_SAFETY.section",
  "deploy live safety contract",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "deploySafetyContractMarkdown()",
  "Protected deploy sequence:",
  "deploySafetySequenceMarkdown()",
]);

assertFileIncludes("deploy live safety shared text source", "src/lib/deploy-safety.ts", [
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
  "Vercel quota messaging",
  "unwanted alias removal for truely-collectables-tt3b.vercel.app",
  "clean-domain aliasing",
  "deployed URL output",
  "clean URL output",
  "npm run smoke:production",
]);

assertFileIncludes("deploy live safety launch readiness json", "src/app/api/admin/launch-readiness/route.ts", [
  "deploySafety",
  "deploySafety: DEPLOY_SAFETY",
]);

assertFileIncludes("deploy live safety launch readiness json source", "src/lib/deploy-safety.ts", [
  "Production Deploy Safety",
  "quotaBlockCode",
  "api-deployments-free-per-day",
  "quotaResetInstruction",
  "rolling 24-hour quota reset",
  "cleanProductionDomain",
  "unwantedAlias",
  "deployed URL output",
  "clean URL output",
  "sequence: [",
  "remove unwanted truely-collectables-tt3b.vercel.app alias",
  "set clean production alias",
  "print DEPLOYED_PRODUCTION",
  "print CLEAN_PRODUCTION",
  "print smoke handoff command",
  "${DEPLOY_SAFETY_SMOKE_COMMAND} handoff",
]);

assertFileIncludes("deploy live safety production smoke page", "src/app/admin/production-smoke/page.tsx", [
  "Deploy live safety contract",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "${DEPLOY_SAFETY.unwantedAlias} alias cleanup",
  "DEPLOY_SAFETY.smokeCommand",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "unwanted alias removal for",
  "clean-domain aliasing",
  "Protected deploy sequence",
  "DEPLOY_SAFETY.sequence",
  "deployed URL output",
  "clean URL output",
]);

assertFileIncludes("deploy live safety launch readiness page", "src/app/admin/launch-readiness/page.tsx", [
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "DEPLOY_SAFETY.smokeCommand",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "deploy live safety",
  "contract keeps",
  "Vercel quota",
  "unwanted alias removal for",
  "clean-domain aliasing",
  "Protected deploy sequence",
  "DEPLOY_SAFETY.sequence",
  "deployed URL output",
  "clean URL output",
]);

assertFileIncludes("deploy live safety runbook", "docs/PRODUCTION_DEPLOY_RUNBOOK.md", [
  "live deploy safety contract",
  "/api/admin/launch-readiness",
  "brief.deploySafety",
  "brief.deploySafety` with the clean production domain, unwanted `truely-collectables-tt3b.vercel.app` alias",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Vercel quota messaging",
  "unwanted `truely-collectables-tt3b.vercel.app` alias",
  "clean-domain aliasing",
  "post-deploy smoke handoff",
  "protected live deploy sequence",
  "remove the unwanted `truely-collectables-tt3b.vercel.app` alias",
  "set the clean production alias",
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "api-deployments-free-per-day",
  "rolling 24-hour reset",
]);

assertFileIncludes("deploy live safety README", "README.md", [
  "deploy live safety contract",
  "/api/admin/launch-readiness",
  "brief.deploySafety",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Vercel quota messaging",
  "unwanted `truely-collectables-tt3b.vercel.app` alias",
  "deployed and clean URLs",
  "protected live deploy sequence",
  "removes the unwanted `truely-collectables-tt3b.vercel.app` alias",
  "sets the clean production alias",
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "npm run smoke:production",
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
]);

assertFileIncludes("deploy live safety operator manual", "docs/TCOS_OPERATOR_MANUAL.md", [
  "live deploy safety contract",
  "/admin/production-smoke",
  "deploy-live safety contract",
  "brief.deploySafety",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Vercel quota messaging",
  "unwanted `truely-collectables-tt3b.vercel.app` alias removal",
  "clean production aliasing",
  "deployed URL output",
  "clean URL output",
  "protected live deploy sequence",
  "removes the unwanted `truely-collectables-tt3b.vercel.app` alias",
  "sets the clean production alias",
  "DEPLOYED_PRODUCTION=",
  "CLEAN_PRODUCTION=https://",
  "npm run smoke:production",
]);

assertFileIncludes(
  "deploy live safety printable operator manual",
  "docs/TCOS_OPERATOR_MANUAL_PRINT.html",
  [
    "live deploy safety contract",
    "/admin/production-smoke",
    "deploy-live safety contract",
    "brief.deploySafety",
    "brief.deploySafety.sequence",
    "/api/admin/launch-readiness?format=markdown",
    "Production Deploy Safety",
    "Vercel quota messaging",
    "unwanted <code>truely-collectables-tt3b.vercel.app</code> alias removal",
    "clean production aliasing",
    "deployed URL output",
    "clean URL output",
    "protected live deploy sequence",
    "removes the unwanted <code>truely-collectables-tt3b.vercel.app</code> alias",
    "sets the clean production alias",
    "DEPLOYED_PRODUCTION=",
    "CLEAN_PRODUCTION=https://",
    "npm run smoke:production",
  ],
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
