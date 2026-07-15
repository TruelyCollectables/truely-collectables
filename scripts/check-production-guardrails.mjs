import { spawnSync } from "node:child_process";
import fs from "node:fs";

const node = process.execPath;
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts || {};

function redactSecrets(text) {
  return text
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-secret]")
    .replace(/\bpk_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-publishable]")
    .replace(/\bwhsec_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-webhook]")
    .replace(/\bre_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-resend-key]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "[redacted-auth-header]")
    .replace(
      /\b(access_token|refresh_token|api_key|apikey|client_secret|secret|token|password)=([^&\s"'<>]+)/gi,
      "$1=[redacted-secret]",
    )
    .replace(
      /"((?:access_)?token|refresh_token|api_key|apikey|client_secret|secret|password)"\s*:\s*"[^"]{6,}"/gi,
      '"$1":"[redacted-secret]"',
    )
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-jwt]");
}

function diagnosticOutput(text) {
  return redactSecrets(text)
    .replace(/\s+$/g, "")
    .slice(0, 4000);
}

function runGuardrailRedactionSelfTest() {
  const sample = [
    "sk_live_fakeSecret123456789",
    "rk_live_fakeRestricted123456789",
    "pk_live_fakePublishable123456789",
    "whsec_fakeWebhook123456789",
    "re_fakeResend123456789",
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
    "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
    "access_token=abc123456789",
    "client_secret=clientSecret123456789",
    "api_key=apiKey123456789",
    '"refresh_token":"refresh123456789"',
    '"password":"password123456789"',
    "eyJabcdefghijklmnopqrstuv.eyJabcdefghijklmnopqrstuv.signatureabcdefghijklmnopqrstuv",
  ].join(" ");
  const snippet = diagnosticOutput(sample);
  const leakedMarkers = [
    "sk_live_",
    "rk_live_",
    "pk_live_",
    "whsec_",
    "re_fake",
    "Bearer ",
    "Basic ",
    "abc123456789",
    "clientSecret123456789",
    "apiKey123456789",
    "refresh123456789",
    "password123456789",
    "eyJabcdefghijklmnopqrstuv",
  ].filter((marker) => snippet.includes(marker));

  if (leakedMarkers.length > 0) {
    throw new Error(
      `Production guardrail redaction self-test leaked marker(s): ${leakedMarkers.join(", ")}`,
    );
  }

  console.log("PASS production guardrail redaction self-test");
}

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

function assertFileExcludes(name, filePath, forbiddenParts) {
  const text = fs.readFileSync(filePath, "utf8");
  const found = forbiddenParts.filter((part) => text.includes(part));

  if (found.length > 0) {
    throw new Error(
      `${name} in ${filePath} contains forbidden production text: ${found.join(", ")}`,
    );
  }

  console.log(`PASS ${name} excludes ${forbiddenParts.join(", ")}`);
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
    throw new Error(`${name} failed unexpectedly.\n${diagnosticOutput(output)}`);
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
    throw new Error(`${name} unexpectedly passed.\n${diagnosticOutput(output)}`);
  }

  if (!output.includes(expectedText)) {
    throw new Error(
      `${name} failed, but did not print the expected guardrail message.\nExpected: ${expectedText}\nActual:\n${diagnosticOutput(output)}`,
    );
  }

  console.log(`PASS ${name}`);
}

runGuardrailRedactionSelfTest();

if (!packageJson.dependencies?.geist) {
  throw new Error(
    "package.json must keep the local geist dependency so builds do not fetch Google Fonts.",
  );
}
console.log("PASS local Geist font dependency");

if (!packageJson.devDependencies?.tsx) {
  throw new Error(
    "package.json must declare tsx directly because shipping verification imports it.",
  );
}
console.log("PASS direct tsx verification dependency");

if (packageJson.devDependencies?.vercel) {
  throw new Error(
    "Vercel CLI must remain command-pinned outside the application dependency graph so deployment-only transitive vulnerabilities do not enter package-lock.json.",
  );
}
console.log("PASS command-pinned Vercel CLI dependency boundary");
assertFileExcludes("Vercel CLI application lock boundary", "package-lock.json", [
  '"node_modules/vercel"',
]);
assertFileIncludes("command-pinned Vercel CLI README", "README.md", [
  "command-pins Vercel CLI `56.2.0`",
  "isolated `npm exec --package=vercel@56.2.0`",
  "without a machine-global `vercel` command",
  "temporary cache stays outside application `node_modules` and the lockfile",
  "Every Vercel call receives `--cwd` with the repository root",
  "`VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens",
  "flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped values fail before quota status, preflight, Git fetch, or Vercel CLI work",
  "Production deploy and smoke target overrides accept only valid DNS hostnames or root HTTP(S) URLs",
  "Smoke therefore cannot silently discard an unsafe suffix",
  "Smoke request timeout overrides must be integer milliseconds from `1000` through `120000`",
  "malformed, infinite, fractional, zero, negative, or too-large values fail before admin auth, Git fetch, or network requests",
  "Normal deploys also enforce the local quota cooldown before npm exec or Git fetch",
  "Unwanted-alias cleanup must succeed",
]);
assertFileIncludes(
  "command-pinned Vercel CLI runbook",
  "docs/PRODUCTION_DEPLOY_RUNBOOK.md",
  [
    "command-pins Vercel CLI `56.2.0`",
    "isolated `npm exec --package=vercel@56.2.0`",
    "outside the application lockfile and `node_modules`",
    "every Vercel call also receives `--cwd` with the TCOS repository root",
    "`VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens",
    "Flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped scope values fail before quota status, production preflight, Git fetch, or Vercel CLI work",
    "accepts `VERCEL_CLEAN_DOMAIN` and `VERCEL_UNWANTED_ALIAS` only as valid bare DNS hostnames or root HTTP(S) URLs",
    "smoke helper applies the same strict shape to `SMOKE_BASE_URL` plus `SMOKE_UNWANTED_ALIAS_URL` before any request",
    "Override with `SMOKE_REQUEST_TIMEOUT_MS` if production is slow but still healthy; it must be integer milliseconds from `1000` through `120000`",
    "Malformed, infinite, fractional, zero, negative, or too-large timeout values fail before admin authentication, Git fetch, or network requests",
    "local quota cooldown check runs before command-pinned npm exec or Git fetch",
    "Unwanted-alias cleanup must succeed",
  ],
);
assertFileIncludes("command-pinned Vercel CLI handoff", "CHAT_HANDOFF.md", [
  "command-pinned Vercel CLI `56.2.0`",
  "isolated `npm exec --package=vercel@56.2.0`",
  "outside application `node_modules` and the lockfile",
  "every Vercel call receives `--cwd` with the repository root",
  "validates `VERCEL_SCOPE` as a simple lowercase Vercel team slug before quota status, preflight, Git fetch, or Vercel CLI work",
  "rejects credentials, ports, paths, queries, fragments, IPs, single-label names, and malformed DNS labels",
  "rejects smoke targets containing credentials, ports, paths, queries, fragments, IPs, single-label names, or malformed DNS labels",
  "bounds `SMOKE_REQUEST_TIMEOUT_MS` to integer milliseconds from `1000` through `120000`",
  "fails malformed, infinite, fractional, zero, negative, or too-large values before admin auth, Git fetch, or network requests",
  "checks that cooldown before command-pinned npm exec or Git fetch on normal deploys",
  "unwanted-alias removal succeeds",
  "preserves the marker and clean-domain target",
]);

if (
  packageJson.dependencies?.next !== "16.2.10" ||
  packageJson.devDependencies?.["eslint-config-next"] !== "16.2.10"
) {
  throw new Error(
    "Next.js and eslint-config-next must stay aligned on patched release 16.2.10.",
  );
}
if (packageJson.overrides?.postcss !== "8.5.15") {
  throw new Error(
    "package.json must keep PostCSS 8.5.15 overridden until Next.js stops pinning the vulnerable 8.4.31 release.",
  );
}
console.log("PASS patched Next.js and PostCSS dependency contract");

assertScriptIncludes("build", ["next build --webpack"]);
assertFileIncludes("bounded Tailwind production scan", "src/app/globals.css", [
  '@import "tailwindcss" source(none);',
  '@source "../**/*.{js,ts,jsx,tsx,mdx}";',
]);
assertFileIncludes("bounded Tailwind build instructions", "docs/TCOS_OPERATOR_MANUAL.md", [
  "Tailwind source detection",
  "source(none)",
  '@source "../**/*.{js,ts,jsx,tsx,mdx}"',
  "FileProvider-backed workspace",
]);
assertFileIncludes(
  "printable bounded Tailwind build instructions",
  "docs/TCOS_OPERATOR_MANUAL_PRINT.html",
  [
    "Tailwind source detection",
    "source(none)",
    '@source &quot;../**/*.{js,ts,jsx,tsx,mdx}&quot;',
    "FileProvider-backed workspace",
  ],
);

assertFileIncludes("local application font source", "src/app/layout.tsx", [
  'from "geist/font/mono"',
  'from "geist/font/sans"',
  "GeistSans.variable",
  "GeistMono.variable",
]);
assertFileExcludes("application font network independence", "src/app/layout.tsx", [
  'from "next/font/google"',
]);
assertFileIncludes("local application font instructions", "docs/TCOS_OPERATOR_MANUAL.md", [
  "Deterministic Application Fonts",
  "installed `geist` package",
  "bundled locally through `next/font/local`",
  "do not fetch CSS or font files from Google Fonts",
]);
assertFileIncludes(
  "printable local application font instructions",
  "docs/TCOS_OPERATOR_MANUAL_PRINT.html",
  [
    "Deterministic Application Fonts",
    "installed <code>geist</code> package",
    "bundled locally through <code>next/font/local</code>",
    "do not fetch CSS or font files from Google Fonts",
  ],
);

assertFileIncludes("generated Next artifact ignores", ".gitignore", [
  "/.next/",
  "/.next-*/",
]);
assertFileIncludes("generated Next artifact lint ignores", "eslint.config.mjs", [
  ".next/**",
  ".next-*/**",
]);

runExpectedSuccess("deploy helper syntax check", [
  "--check",
  "scripts/deploy-production.mjs",
]);
runExpectedSuccess("deploy helper target-host normalization self-test", [
  "scripts/deploy-production.mjs",
  "--self-test-target-hosts",
]);
runExpectedSuccess("deploy helper Vercel scope self-test", [
  "scripts/deploy-production.mjs",
  "--self-test-scope",
]);
runExpectedFailure(
  "deploy helper rejects malformed Vercel scope",
  ["scripts/deploy-production.mjs", "--quota-status"],
  {
    VERCEL_SCOPE: "--prod",
  },
  "VERCEL_SCOPE must be a Vercel team slug using only lowercase letters, numbers, and hyphens",
);
runExpectedFailure(
  "deploy helper rejects target URL paths",
  ["scripts/deploy-production.mjs", "--quota-status"],
  {
    VERCEL_CLEAN_DOMAIN: "https://truely-collectables.vercel.app/path",
  },
  "VERCEL_CLEAN_DOMAIN must be a root HTTP(S) URL without credentials, port, path, query, or fragment",
);
runExpectedFailure(
  "deploy helper rejects target URL credentials",
  ["scripts/deploy-production.mjs", "--quota-status"],
  {
    VERCEL_UNWANTED_ALIAS:
      "https://operator:self-test-secret@truely-collectables-tt3b.vercel.app/",
  },
  "VERCEL_UNWANTED_ALIAS must be a root HTTP(S) URL without credentials, port, path, query, or fragment",
);
runExpectedSuccess(
  "deploy helper quota cooldown self-test",
  ["scripts/deploy-production.mjs", "--self-test-quota-cooldown"],
  {
    TCOS_VERCEL_QUOTA_MARKER_PATH:
      "/tmp/tcos-vercel-quota-block-self-test.json",
  },
);
runExpectedSuccess(
  "deploy helper rejects zero quota cooldown",
  ["scripts/deploy-production.mjs", "--self-test-quota-cooldown"],
  {
    TCOS_VERCEL_QUOTA_MARKER_PATH:
      "/tmp/tcos-vercel-zero-quota-cooldown-self-test.json",
    TCOS_VERCEL_QUOTA_COOLDOWN_HOURS: "0",
  },
);
runExpectedSuccess(
  "deploy helper rejects malformed quota cooldown",
  ["scripts/deploy-production.mjs", "--self-test-quota-cooldown"],
  {
    TCOS_VERCEL_QUOTA_MARKER_PATH:
      "/tmp/tcos-vercel-malformed-quota-cooldown-self-test.json",
    TCOS_VERCEL_QUOTA_COOLDOWN_HOURS: "not-a-number",
  },
);
runExpectedSuccess(
  "deploy helper rejects failed deploy output with a URL",
  ["scripts/deploy-production.mjs", "--self-test-deploy-result"],
  {
    TCOS_VERCEL_QUOTA_MARKER_PATH:
      "/tmp/tcos-vercel-deploy-result-self-test.json",
  },
);
runExpectedFailure(
  "deploy helper protects production marker from deploy-result self-test",
  ["scripts/deploy-production.mjs", "--self-test-deploy-result"],
  {},
  "Refusing deploy-result self-test against the production marker path",
);
runExpectedSuccess(
  "deploy helper fails closed on unwanted-alias cleanup errors",
  ["scripts/deploy-production.mjs", "--self-test-alias-removal"],
  {
    TCOS_VERCEL_QUOTA_MARKER_PATH:
      "/tmp/tcos-vercel-alias-removal-self-test.json",
  },
);
runExpectedFailure(
  "deploy helper protects production marker from alias-removal self-test",
  ["scripts/deploy-production.mjs", "--self-test-alias-removal"],
  {},
  "Refusing alias-removal self-test against the production marker path",
);
runExpectedFailure(
  "deploy helper protects production quota marker from self-test",
  ["scripts/deploy-production.mjs", "--self-test-quota-cooldown"],
  {},
  "Refusing quota cooldown self-test against the production marker path",
);
runExpectedSuccess(
  "deploy helper read-only quota status",
  ["scripts/deploy-production.mjs", "--quota-status"],
  {
    TCOS_VERCEL_QUOTA_MARKER_PATH:
      "/tmp/tcos-vercel-quota-status-guardrail.json",
  },
);
assertFileIncludes(
  "deploy helper read-only quota status contract",
  "scripts/deploy-production.mjs",
  [
    "--quota-status",
    "TCOS_PRODUCTION_QUOTA_STATUS_ONLY",
    "Production deploy quota status:",
    "deployment retry allowed by local cooldown",
    "retry at or after:",
    "approximate remaining:",
    "Vercel upload started: no",
    "npm run status:production",
    'state: marker ? "invalid_marker" : "open"',
    "canRetry: !marker",
    "Local Vercel quota marker is invalid",
    "No Vercel upload was started",
    "do not deploy unless the quota reset is independently confirmed",
    "Quota cooldown self-test failed open for an invalid marker",
    'state: "invalid_configuration"',
    "canRetry: false",
    "TCOS_VERCEL_QUOTA_COOLDOWN_HOURS must be a positive number",
    "Quota cooldown self-test failed open for invalid configuration",
    "Production deploy quota cooldown invalid-configuration self-test passed",
    "--self-test-deploy-result",
    "Vercel production deploy failed with",
    "No alias command was started",
    "local quota marker was preserved",
    "A URL printed by a failed command is not accepted as a deployment",
    "Deploy-result self-test removed the quota marker on failure",
    "Production deploy result self-test passed",
    "--self-test-alias-removal",
    "Unwanted production alias cleanup failed with",
    "clean production alias was not changed",
    "Only Vercel CLI's explicit alias-not-found result is safe to continue past",
    "Alias-removal self-test removed the quota marker on failure",
    "Production unwanted-alias removal self-test passed",
    "--self-test-target-hosts",
    "Production target-host normalization self-test passed",
    "--self-test-scope",
    "Production Vercel scope self-test passed",
    "normalizeVercelScope",
    "VERCEL_SCOPE must be a Vercel team slug using only lowercase letters, numbers, and hyphens",
    "message.includes(\"scope-self-test-secret\")",
    "must be a valid DNS hostname or root HTTP(S) URL",
    "must be a root HTTP(S) URL without credentials, port, path, query, or fragment",
    "must be a bare DNS hostname or root HTTP(S) URL",
    "must resolve to a valid DNS hostname with at least two labels",
    "message.includes(\"user-secret\")",
  ],
);
assertFileIncludes("quota status runbook instructions", "docs/PRODUCTION_DEPLOY_RUNBOOK.md", [
  "npm run status:production",
  "without fetching Git, building, uploading, or starting a deployment",
  "exact blocked/retry timestamps",
  "Vercel upload started: no",
  "TCOS_PRODUCTION_QUOTA_STATUS_ONLY=true",
  "self-test refuses to run against `.codex-run/vercel-quota-block.json`",
  "malformed or unreadable marker fails closed",
  "zero, negative, or nonnumeric cooldown value also fails closed",
]);
assertFileIncludes("quota status README instructions", "README.md", [
  "npm run status:production",
  "read-only quota check",
  "exact blocked/retry timestamps",
  "Vercel upload started: no",
  "malformed or unreadable marker fails closed",
  "zero, negative, or nonnumeric cooldown value also fails closed",
  "Quota markers are success-cleared, not attempt-cleared",
  "Nonzero `vercel --prod` results are rejected before URL parsing",
]);
assertFileIncludes("quota status shared deploy contract", "src/lib/deploy-safety.ts", [
  'quotaStatusCommand: "npm run status:production"',
  "quotaStatusDescription:",
  "Read-only local cooldown check with exact blocked/retry timestamps and no Git fetch, build, Vercel upload, or deployment.",
  "read-only quota status via npm run status:production",
]);
assertFileIncludes(
  "quota status launch readiness exports",
  "src/app/api/admin/launch-readiness/route.ts",
  [
    "DEPLOY_SAFETY.quotaStatusCommand",
    "DEPLOY_SAFETY.quotaStatusDescription",
    "DEPLOY_SAFETY.quotaMarkerClearCondition",
    "DEPLOY_SAFETY.deployResultRequirement",
    "DEPLOY_SAFETY.vercelCliRequirement",
    "DEPLOY_SAFETY.scopeRequirement",
    "DEPLOY_SAFETY.unwantedAliasCleanupRequirement",
    "DEPLOY_SAFETY.targetHostRequirement",
    "DEPLOY_SAFETY.smokeTargetRequirement",
    "DEPLOY_SAFETY.quotaEarlyStopRequirement",
    "Check the local Vercel cooldown",
    "starts no upload or deployment",
  ],
);
assertFileIncludes(
  "quota status launch readiness page",
  "src/app/admin/launch-readiness/page.tsx",
  [
    "DEPLOY_SAFETY.quotaStatusCommand",
    "DEPLOY_SAFETY.quotaStatusDescription",
    "DEPLOY_SAFETY.quotaMarkerClearCondition",
    "DEPLOY_SAFETY.deployResultRequirement",
    "DEPLOY_SAFETY.vercelCliRequirement",
    "DEPLOY_SAFETY.scopeRequirement",
    "DEPLOY_SAFETY.unwantedAliasCleanupRequirement",
    "DEPLOY_SAFETY.targetHostRequirement",
    "DEPLOY_SAFETY.smokeTargetRequirement",
    "DEPLOY_SAFETY.quotaEarlyStopRequirement",
    "Before the retry time, use the read-only quota check",
  ],
);
assertFileIncludes(
  "quota status production smoke page",
  "src/app/admin/production-smoke/page.tsx",
  [
    "DEPLOY_SAFETY.quotaStatusCommand",
    "DEPLOY_SAFETY.quotaStatusDescription",
    "DEPLOY_SAFETY.quotaMarkerClearCondition",
    "DEPLOY_SAFETY.deployResultRequirement",
    "DEPLOY_SAFETY.vercelCliRequirement",
    "DEPLOY_SAFETY.scopeRequirement",
    "DEPLOY_SAFETY.unwantedAliasCleanupRequirement",
    "DEPLOY_SAFETY.targetHostRequirement",
    "DEPLOY_SAFETY.smokeTargetRequirement",
    "DEPLOY_SAFETY.quotaEarlyStopRequirement",
    "exact read-only local retry status",
  ],
);
assertFileIncludes("quota status production smoke coverage", "scripts/smoke-production.mjs", [
  '"quotaStatusCommand":"npm run status:production"',
  '"quotaStatusDescription"',
  "Read-only local cooldown check with exact blocked/retry timestamps",
  '"quotaMarkerClearCondition"',
  '"deployResultRequirement"',
  '"vercelCliRequirement"',
  '"scopeRequirement"',
  '"unwantedAliasCleanupRequirement"',
  '"targetHostRequirement"',
  '"smokeTargetRequirement"',
  '"quotaEarlyStopRequirement"',
  "Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds",
  "Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker",
  "Use command-pinned Vercel CLI 56.2.0 through isolated npm exec",
  "Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug",
  "Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result",
  "Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs",
  "Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs",
  "On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment",
  "npm run status:production",
]);
assertFileIncludes("quota status operator instructions", "docs/TCOS_OPERATOR_MANUAL.md", [
  "npm run status:production",
  "exact block and retry timestamps",
  "Vercel upload started: no",
  "TCOS_PRODUCTION_QUOTA_STATUS_ONLY=true",
  "malformed or unreadable marker fails closed",
  "zero, negative, or nonnumeric cooldown value also fails closed",
  "quota marker is success-cleared, not attempt-cleared",
  "requires `vercel --prod` to exit successfully before it parses the deployment URL",
  "command-pins Vercel CLI `56.2.0` through isolated `npm exec --package=vercel@56.2.0`",
  "`VERCEL_SCOPE` must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens",
  "Flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped scope values fail before quota status, preflight, Git fetch, or Vercel CLI work",
  "Unwanted-alias cleanup is also fail closed",
  "Production target overrides are strict",
  "Production smoke targets are equally strict",
  "normal deploy path checks this local cooldown before command-pinned npm exec, Git fetch, build, Vercel upload, or deployment",
  "self-test must never use the production marker path",
  "launch-readiness JSON and Markdown",
  "Production smoke verifies those surfaces retain `npm run status:production`",
]);
assertFileIncludes(
  "printable quota status operator instructions",
  "docs/TCOS_OPERATOR_MANUAL_PRINT.html",
  [
    "npm run status:production",
    "exact block and retry timestamps",
    "Vercel upload started: no",
    "TCOS_PRODUCTION_QUOTA_STATUS_ONLY=true",
    "malformed or unreadable marker fails closed",
    "zero, negative, or nonnumeric cooldown value also fails closed",
    "quota marker is success-cleared, not attempt-cleared",
    "requires <code>vercel --prod</code> to exit successfully before it parses the deployment URL",
    "command-pins Vercel CLI <code>56.2.0</code> through isolated <code>npm exec --package=vercel@56.2.0</code>",
    "<code>VERCEL_SCOPE</code> must be a simple Vercel team slug using only lowercase letters, numbers, and hyphens",
    "Flag-like, URL-like, whitespace, dotted, slashed, at-sign, uppercase, or secret-shaped scope values fail before quota status, preflight, Git fetch, or Vercel CLI work",
    "Unwanted-alias cleanup is also fail closed",
    "Production target overrides are strict",
    "Production smoke targets are equally strict",
    "normal deploy path checks this local cooldown before command-pinned npm exec, Git fetch, build, Vercel upload, or deployment",
    "self-test must never use the production marker path",
    "launch-readiness JSON and Markdown",
    "Production smoke verifies those surfaces retain <code>npm run status:production</code>",
  ],
);
runExpectedSuccess("smoke helper syntax check", [
  "--check",
  "scripts/smoke-production.mjs",
]);
runExpectedSuccess(
  "smoke helper target-origin normalization self-test",
  ["scripts/smoke-production.mjs", "--self-test-target-origins"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "https://truely-collectables.vercel.app",
  },
);
runExpectedSuccess(
  "smoke helper timeout config self-test",
  ["scripts/smoke-production.mjs", "--self-test-timeout-config"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
  },
);
runExpectedFailure(
  "smoke helper rejects malformed timeout",
  ["scripts/smoke-production.mjs"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_REQUEST_TIMEOUT_MS: "Infinity",
  },
  "SMOKE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000",
);
runExpectedFailure(
  "smoke helper rejects target URL paths",
  ["scripts/smoke-production.mjs"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "https://launch.example.com/not-the-root",
  },
  "SMOKE_BASE_URL must be a root HTTP(S) URL without credentials, port, path, query, or fragment",
);
runExpectedFailure(
  "smoke helper rejects target URL credentials",
  ["scripts/smoke-production.mjs"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL:
      "https://operator:guardrail-smoke-secret@launch.example.com/",
  },
  "SMOKE_BASE_URL must be a root HTTP(S) URL without credentials, port, path, query, or fragment",
);
runExpectedSuccess("shipping simulation runner syntax check", [
  "--import",
  "tsx",
  "--check",
  "scripts/run-shipping-simulations.ts",
]);
runExpectedSuccess("shipping purchase audit simulation runner syntax check", [
  "--import",
  "tsx",
  "--check",
  "scripts/run-shipping-purchase-audit-simulations.ts",
]);
runExpectedSuccess("live money status runner syntax check", [
  "--import",
  "tsx",
  "--check",
  "scripts/status-live-money.ts",
]);
assertScriptIncludes("verify:shipping", [
  "simulate:lettertrack-evidence",
  "simulate:shipping-purchase-audit",
  "simulate:shipping",
]);
assertScriptIncludes("status:production", [
  "node scripts/deploy-production.mjs --quota-status",
]);
assertScriptIncludes("status:live-money", [
  "node --import tsx scripts/status-live-money.ts --allow-blocked",
]);
assertScriptIncludes("status:live-money:json", [
  "node --import tsx scripts/status-live-money.ts --allow-blocked --json",
]);
assertScriptIncludes("preflight:live-money", [
  "node --import tsx scripts/status-live-money.ts",
]);
assertScriptIncludes("preflight:live-money:json", [
  "node --import tsx scripts/status-live-money.ts --json",
]);
assertScriptIncludes("verify:production", [
  "status:live-money",
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
assertFileIncludes("launch dashboard smoke contract", "scripts/smoke-production.mjs", [
  'name: "admin dashboard"',
  'path: "/admin"',
  "Shipping Setup",
  "Shipping Provider Unlock Action Plan",
  "Live money runway",
  "approval blockers",
  "launch locks",
  "Next live-money action",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Standard Envelope evidence validator",
  "Purchase-audit key drift",
  "unexpected",
]);
assertFileIncludes("live money go/no-go CLI source", "scripts/status-live-money.ts", [
  "Live money go/no-go status:",
  "READY_FOR_RUNTIME_SWITCH",
  "READY_FOR_DATABASE_APPROVAL",
  "tcos.liveMoneyGoNoGo.v1",
  "--json",
  "--allow-blocked",
  "approval blockers",
  "runtime switch",
  "No Checkout Sessions, Customers, PaymentIntents, refunds, disputes, payouts, labels, postage purchases, Coverage policies, launch approvals, or revocations were created.",
]);
assertFileIncludes("live money go/no-go README instructions", "README.md", [
  "npm run status:live-money",
  "npm --silent run status:live-money:json",
  "npm run preflight:live-money",
  "npm --silent run preflight:live-money:json",
  "verify:production",
  "READY_FOR_RUNTIME_SWITCH",
  "Read-only guarantee",
]);
assertFileIncludes("admin dashboard shipping evidence validator source", "src/app/admin/page.tsx", [
  "ProviderSetupActionPlanStep",
  "shippingProviderSetup.actionPlan",
  "Shipping Provider Unlock Action Plan",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "launchGateDrill.shipping.standardEnvelopeEvidenceContractReady",
  "purchaseAttemptAuditMissingScenarioKeys",
  "purchaseAttemptAuditUnexpectedScenarioKeys",
  "shippingProviderSetup.standardEnvelopeEvidenceContractReady",
  "Standard Envelope evidence validator",
  "Purchase-audit key drift",
]);
assertFileIncludes("launch readiness smoke contract", "scripts/smoke-production.mjs", [
  'name: "launch readiness page"',
  'path: "/admin/launch-readiness"',
  "Launch Readiness",
  "Live money runway",
  "What remains before full live money",
  "Payment approval blockers before database approval",
  "Intentional live-money launch locks",
  "Open Live Payment Gate",
  "Production Deploy Queue",
  "Shipping Provider Unlock Action Plan",
  "sellerMarketplaceReceiptHandoffSmoke",
  "sellerMarketplaceReceiptHandoffControlsText",
  "sellerMarketplaceReceiptHandoffCoverageLine",
  "sellerMarketplaceReceiptHandoffBundleText",
  "function includesAll",
  "function hasJsonField",
  "function hasSellerMarketplaceReceiptHandoffSmokeText",
  "function hasSellerMarketplaceReceiptHandoffJson",
  "function hasSellerMarketplaceReceiptHandoffMarkdown",
  "hasSellerMarketplaceReceiptHandoffSmokeText(result.text)",
  "Seller Marketplace Receipt Handoff",
  "Seller marketplace receipt handoff proof text",
  "Copy Safe Receipt",
  "Download Safe Receipt",
  "Copy Trail",
  "Download Trail",
  "Clear Trail",
  "not an audit ledger",
  "/seller/marketplaces",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Export operator checklist",
  "npm run verify:production",
  "git fetch origin main",
  'optionalRun("git", ["rev-parse", "origin/main"])',
  "origin/main full SHA:",
  "function launchReadinessDeploymentMatchesOriginMain",
  "function launchReadinessDeploymentDiagnostic",
  "Deployment source mismatch:",
  "gitCommitSha production=",
  "origin/main=",
  "diagnostic:",
  "deployment.gitCommitSha === remoteFullHead",
  "deployment.gitCommitShortSha === remoteHead",
  "deployment.gitCommitRef === \"main\"",
  "deployment.cleanProductionDomain === baseUrl",
  "npm run check:production-guardrails",
  "npm run preflight:production",
  "twenty-scenario shipping simulation suite",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "Standard Envelope evidence validator is ready",
  "/api/admin/shipping/simulations",
  "twenty expected shipping scenarios",
  "five expected purchase-audit scenarios",
  "no missing/unexpected simulation keys",
  'name: "launch readiness json"',
  'path: "/api/admin/launch-readiness"',
  'result.contentType.includes("application/json")',
  '"brief"',
  '"deploySafety"',
  '"deployment"',
  '"gitCommitSha"',
  '"gitCommitRef"',
  '"vercelUrl"',
  '"cleanProductionDomain"',
  "Compare this Git commit SHA with origin/main",
  '"sellerMarketplaceReceiptHandoff"',
  "hasSellerMarketplaceReceiptHandoffJson(result.text)",
  '"standardEnvelopeEvidenceContractReady":true',
  '"purchaseAttemptAuditRunStatus":"passed"',
  '"purchaseAttemptAuditExpectedScenarioCount":5',
  '"purchaseAttemptAuditKeyCoverageStatus":"passed"',
  '"purchaseAttemptAuditMissingScenarioKeys":[]',
  '"purchaseAttemptAuditUnexpectedScenarioKeys":[]',
  "launchReadinessDeploymentMatchesOriginMain(result)",
  "diagnostic: launchReadinessDeploymentDiagnostic",
  "requiredText: remoteFullHead ? [remoteFullHead] : []",
  '"quotaBlockCode":"api-deployments-free-per-day"',
  '"quotaCooldownMarkerPath":".codex-run/vercel-quota-block.json"',
  '"quotaRetryOverrideEnv":"TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true"',
  '"quotaRetryOverrideFlag":"--force-quota-retry"',
  '"quotaUploadWarning"',
  "Vercel can still upload files before returning the quota error",
  ".codex-run/vercel-quota-block.json",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  '"sequence"',
  "npm run smoke:production handoff",
  'name: "launch readiness markdown"',
  'path: "/api/admin/launch-readiness?format=markdown"',
  'hasAttachmentFilename(result, "tcos-launch-readiness-brief.md")',
  "# TCOS Launch Readiness Brief",
  "hasSellerMarketplaceReceiptHandoffMarkdown(result.text)",
  "Standard Envelope evidence validator: ready",
  "Provider purchase-attempt audit suite: passed; 5/5 scenarios; key coverage passed",
  "Missing purchase audit keys: none",
  "Unexpected purchase audit keys: none",
  "## Deployment Source",
  "Git commit SHA:",
  "Smoke comparison:",
  "## Production Deploy Safety",
  "Protected deploy sequence:",
]);
assertFileIncludes("launch gate drill smoke contract", "scripts/smoke-production.mjs", [
  'name: "launch gate drill page"',
  'path: "/admin/launch-gate-drill"',
  "Launch Gate Drill",
  "No-money runtime smoke",
  "Download Drill Report",
  "Live money runway",
  "Payment approval blockers and launch locks",
  "Next live-money actions",
  "Standard Envelope evidence validator is ready",
  "Provider Purchase-Attempt Audit Suite",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  '"purchaseAttemptAuditRunStatus":"passed"',
  '"approvalBlockingCount"',
  '"launchLockCount"',
  '"operatorSummary"',
  '"nextActions"',
  '"purchaseAttemptAuditExpectedScenarioCount":5',
  '"purchaseAttemptAuditMissingScenarioKeys":[]',
  '"purchaseAttemptAuditUnexpectedScenarioKeys":[]',
  '"providerSetupActionPlan"',
  "Provider purchase-attempt audit suite: passed; 5/5 scenarios; key coverage passed",
  "Missing purchase audit keys: none",
  "Unexpected purchase audit keys: none",
  "## Shipping Provider Unlock Action Plan",
  "Not allowed during this drill",
  'name: "launch gate drill json"',
  'path: "/api/admin/launch-gate-drill"',
  'result.contentType.includes("application/json")',
  '"standardEnvelopeEvidenceContractReady":true',
  '"sideEffectPolicy"',
  '"forbiddenOperations"',
  'name: "launch gate drill markdown"',
  'path: "/api/admin/launch-gate-drill?format=markdown"',
  'result.contentType.includes("text/markdown")',
  'hasAttachmentFilename(result, "tcos-launch-gate-drill-report.md")',
  "# TCOS Launch Gate Drill Report",
  "## Live Money Runway",
  "Approval blockers:",
  "Launch locks:",
  "### Next Live-Money Actions",
  "Standard Envelope evidence validator: ready",
  "## Side-effect Guardrails",
  "### Forbidden Operations",
]);
assertFileIncludes("launch gate drill shipping evidence source", "src/lib/launch-gate-drill.ts", [
  "standardEnvelopeEvidenceContractReady: boolean",
  'purchaseAttemptAuditRunStatus: "passed" | "failed"',
  "purchaseAttemptAuditExpectedScenarioCount",
  "purchaseAttemptAuditKeyCoverageStatus",
  "purchaseAttemptAuditMissingScenarioKeys",
  "purchaseAttemptAuditUnexpectedScenarioKeys",
  "providerSetupActionPlan: ProviderSetupActionPlanStep[]",
  "buildShippingProviderSetupPacket",
  "shippingProviderSetup.actionPlan",
  "missing_scenario_keys",
  "unexpected_scenario_keys",
  "shippingReport.standardEnvelopeEvidenceContractReady",
  "shippingReport.purchaseAttemptAuditSimulation",
  "Standard Envelope evidence validator is",
]);
assertFileIncludes("launch gate drill shipping unlock plan page source", "src/app/admin/launch-gate-drill/page.tsx", [
  "ProviderSetupActionPlanStep",
  "report.shipping.providerSetupActionPlan",
  "Shipping Provider Unlock Action Plan",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "/admin/live-shipping-launch",
]);
assertFileIncludes("launch gate drill shipping unlock plan markdown source", "src/app/api/admin/launch-gate-drill/route.ts", [
  "providerUnlockActionPlanMarkdown",
  "## Shipping Provider Unlock Action Plan",
  "report.shipping.providerSetupActionPlan",
  "The drill is no-money and no-postage",
]);
assertFileIncludes("production smoke page contract", "scripts/smoke-production.mjs", [
  'name: "production smoke report page"',
  'path: "/admin/production-smoke"',
  "requiredText:",
  "Production Smoke Report",
  "Smoke coverage",
  "Admin login and dashboard render with Shipping Provider Unlock Action Plan",
  "Under-$20 Seller Protection launch handoff",
  "Launch Gate Drill page, JSON report, Markdown operator report, live-money runway, Shipping Provider Unlock Action Plan, and Standard Envelope evidence validator",
  "Launch readiness and handoff exports show missing/unexpected purchase-audit key drift",
  "Seller Protection Handoff Bundle",
  "Seller Protection Reconciliation",
  "Shipping Claims Cockpit",
  "Standard Envelope evidence validator",
  "Live Shipping Launch Gate with Shipping Provider Unlock Action Plan and Purchase-Audit Key Drift card",
  "Shipping Simulation Lab with twenty policy/adapter scenarios plus five provider purchase-audit scenarios",
  "Shipping purchase-attempt audit simulations for live-gate, missing-setup, dry-run, and packet-output text",
  "Shipping simulation API POST with scenario count, manifest, and drift-field checks",
  "Shipping provider setup JSON and export packets with Standard Envelope evidence readiness",
  "Seller marketplace packet intake guardrail for cross-list prep only, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation",
  "Seller marketplace page renders Marketplace Packet Intake guidance, ready-row handoff, needs-work handoff, and prep-only export wording",
  "sellerMarketplaceReceiptHandoffCoverageLine",
  "Seller inventory, order, and payout workspaces render login gates before exposing seller-owned data",
  "Queued launch feature failure(s)",
  "Unwanted truely-collectables-tt3b.vercel.app alias absence",
  "Deploy live safety contract",
  "Production go/no-go ladder",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "Ship only after smoke passes clean production",
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
  "Vercel can still upload files before returning the quota error",
  ".codex-run/vercel-quota-block.json",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  "Protected deploy sequence",
  "Post-smoke manual verification checklist",
  "Proof to capture:",
  "If blocked:",
  "Git tip and clean domain",
  "Launch gate drill evidence",
  "Live money runway proof",
  "Live money JSON evidence",
  "npm --silent run status:live-money:json",
  "npm --silent run preflight:live-money:json",
  "tcos.liveMoneyGoNoGo.v1",
  "READY_FOR_RUNTIME_SWITCH",
  "approval-blocker count",
  "launch-lock count",
  "next live-money actions",
  "Live shipping lock posture",
  "Seller protection money trail",
  "Shipping operations exports",
  "Seller marketplace packet intake",
  "Seller marketplace receipt handoff",
  "deployed URL output",
  "clean URL output",
  "npm run launch:production",
]);
assertFileIncludes("seller marketplace packet intake smoke contract", "scripts/smoke-production.mjs", [
  'name: "seller marketplace packet intake"',
  'path: "/seller/marketplaces"',
  "requiredText:",
  "Seller Connections",
  "Marketplace Packet Intake",
  "Seller Inventory exports are prep files, not live publishing.",
  "Cross-list prep only",
  "No external publishing",
  "No postage purchase",
  "No Coverage policy creation",
  "No payout release",
  "No order fulfillment",
  "No automatic under-$20 protection activation",
  "Open Ready Inventory",
  "Open Needs-Work Inventory",
  "Seller marketplace packet intake guidance",
  "Seller marketplace receipt handoff",
  "Copy Safe Receipt",
  "Download Safe Receipt",
  "Copy Trail",
  "Download Trail",
  "Clear Trail",
  "prep-only JSON/CSV handoffs",
]);
assertFileIncludes("seller workspace auth gate smoke contract", "scripts/smoke-production.mjs", [
  'name: "seller inventory auth gate"',
  'path: "/seller/inventory"',
  "Seller Inventory",
  "review seller-owned drafts, active inventory, and activation blockers",
  'name: "seller orders auth gate"',
  'path: "/seller/orders"',
  "Seller Order Activity",
  "review seller-owned orders, payout holds, and cash-out blockers",
  'name: "seller payouts auth gate"',
  'path: "/seller/payouts"',
  "Seller Payouts",
  "review payout verification, cash-out readiness, and seller hold context",
  "Log in through your TCOS account first",
]);
assertFileIncludes(
  "seller marketplace receipt handoff shared source",
  "src/lib/seller-marketplace-receipt-handoff.ts",
  [
    "SELLER_MARKETPLACE_RECEIPT_HANDOFF_TITLE",
    "SELLER_MARKETPLACE_RECEIPT_HANDOFF_ROUTE",
    "SELLER_MARKETPLACE_RECEIPT_HANDOFF_PROOF_TEXT",
    "SELLER_MARKETPLACE_RECEIPT_HANDOFF_CONTROLS",
    "SELLER_MARKETPLACE_RECEIPT_HANDOFF_OPERATIONS",
    "SELLER_MARKETPLACE_RECEIPT_HANDOFF_SAFE_USE_BOUNDARY",
    "buildSellerMarketplaceReceiptHandoffContract",
    "sellerMarketplaceReceiptHandoffControlsSentence",
    "sellerMarketplaceReceiptHandoffMarkdownLines",
    "controlsSentence: sellerMarketplaceReceiptHandoffControlsSentence",
    "Seller Marketplace Receipt Handoff",
    "/seller/marketplaces",
    "Seller marketplace receipt handoff proof text",
    "Copy Safe Receipt",
    "Download Safe Receipt",
    "Copy Trail",
    "Download Trail",
    "Clear Trail",
    "not an audit ledger, payment record, fulfillment proof, or provider reconciliation source of truth",
  ],
);
assertFileIncludes(
  "seller protection launch contract shared source",
  "src/lib/seller-protection-launch-contract.ts",
  [
    "SELLER_PROTECTION_SMOKE_COVERAGE_LINE",
    "buildSellerProtectionLaunchContract",
    "sellerProtectionLaunchMarkdownLines",
    "TCOS Under-$20 Seller Protection",
    "Optional TCOS internal Standard Envelope seller protection; it is not third-party insurance.",
    "2% of the protected sale withheld from the seller payout row",
    "$20.00 protected item amount cap",
    "Protected item sale amount only; shipping is excluded and is not reimbursed.",
    "LetterTrack/USPS IMb evidence must not show delivered",
    "seller_protection_reimbursement",
    "financial_adjustment_ledger_entries",
    "20260712174000_add_seller_protection_financial_adjustments.sql",
    "/admin/launch-readiness#database-readiness",
    "/admin/financial-reconciliation",
    "/admin/shipping",
  ],
);
assertFileIncludes("launch handoff smoke contract", "scripts/smoke-production.mjs", [
  'name: "launch handoff bundle"',
  'path: "/api/admin/launch-readiness?format=handoff-bundle"',
  "requiredText:",
  'hasAttachmentFilename(result, "tcos-launch-handoff-bundle.md")',
  "# TCOS Launch Hand-off Bundle",
  "## Git Tip Verification",
  "git fetch origin main",
  "git rev-parse --short HEAD",
  "git rev-parse --short origin/main",
  "git log -5 --oneline",
  "## Production Deploy Commands",
  "npm run verify:production",
  "npm run launch:production",
  "npm run deploy:production",
  "npm run smoke:production",
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
  "Vercel can still upload files before returning the quota error",
  ".codex-run/vercel-quota-block.json",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  "## Production Go/No-Go Ladder",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "Ship only after smoke passes clean production",
  "## Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "production smoke POSTs `/api/admin/shipping/simulations`",
  "five expected purchase-audit scenarios",
  "no missing or unexpected scenario keys",
  "no missing/unexpected purchase-audit keys",
  "sellerMarketplaceReceiptHandoffBundleText",
  "...sellerMarketplaceReceiptHandoffBundleText",
  "includesAll(result.text, sellerMarketplaceReceiptHandoffBundleText)",
]);
assertFileIncludes("live launch gate smoke contract", "scripts/smoke-production.mjs", [
  'name: "live payment gate"',
  'path: "/admin/live-payment-launch"',
  "Live Payment Launch Gate",
  "Stripe Mode",
  "Approval version",
  "Approval Blockers",
  "Launch Locks",
  "Operator next actions",
  "What remains before live money",
  "Approve Live Payments",
  "Payment Lab",
  'name: "live shipping gate"',
  'path: "/admin/live-shipping-launch"',
  "const pageText = visibleText(result.text)",
  "Live Shipping Launch Gate",
  "Provider secrets and live-adapter evidence",
  "Provider verdict",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Operator Checklist",
  "Standard Envelope Evidence + Under-$20 Protection Contract",
  "LetterTrack / USPS IMb is delivery evidence, not insurance",
  "Runtime gate validator: ready",
  "Provider Purchase-Attempt Audit Suite",
  "Purchase-Audit Key Drift",
  "Missing Purchase Audit Keys",
  "Unexpected Purchase Audit Keys",
  "Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking",
  "Immutable Shipping Approval History",
  "Shipping Lab",
  'name: "live shipping gate json"',
  'path: "/api/admin/live-shipping-launch"',
  '"standardEnvelopeEvidenceContract"',
  '"standardEnvelopeEvidenceContractReady":true',
  '"purchaseAttemptAuditSimulation"',
  '"expected_scenario_count":5',
  '"scenario_key_coverage_status":"passed"',
  '"missing_scenario_keys":[]',
  '"unexpected_scenario_keys":[]',
  '"evidenceProvider":"LetterTrack / USPS IMb"',
  '"trackableRequirement"',
  '"under20ProtectionModel"',
  '"sellerOptInRule"',
  '"reserveRate":"2%"',
  '"itemReimbursementCap":"$20.00"',
  '"reimbursesShipping":"no"',
  '"notInsuranceNotice"',
  '"standard_envelope_evidence_contract"',
  '"Standard Envelope Evidence Contract"',
]);
assertFileIncludes("live shipping evidence contract report source", "src/lib/live-shipping-launch.ts", [
  "isStandardEnvelopeEvidenceContractReady",
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "StandardEnvelopeEvidenceContract",
  "standardEnvelopeEvidenceContract: StandardEnvelopeEvidenceContract",
  "standardEnvelopeEvidenceContractReady: boolean",
  "purchaseAttemptAuditSimulation",
  "Provider Purchase-Attempt Audit Suite",
  "provider_purchase_attempt_audit_simulations",
  "expected_scenario_count",
  "missing_scenario_keys",
  "unexpected_scenario_keys",
  "scenario_key_coverage_status",
  "standardEnvelopeEvidenceContractReady =",
  "standard_envelope_evidence_contract",
  "Standard Envelope Evidence Contract",
  "not third-party insurance",
  "Live shipping is blocked because the Standard Envelope evidence/protection contract is incomplete or unsafe.",
  "standardEnvelopeEvidenceContract,",
  "standardEnvelopeEvidenceContractReady,",
]);
assertFileIncludes("live shipping evidence contract page source", "src/app/admin/live-shipping-launch/page.tsx", [
  "ProviderSetupActionPlanStep",
  "providerSetupPacket.actionPlan",
  "Shipping Provider Unlock Action Plan",
  "ProviderUnlockActionPlan",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "evidenceContract",
  "evidenceContractReady",
  "Standard Envelope Evidence + Under-$20 Protection Contract",
  "is delivery evidence, not insurance",
  "Runtime gate validator:",
  "Seller opt-in",
  "Reserve / cap",
  "Reimburses shipping:",
  "Not insurance:",
]);
assertFileIncludes("shipping simulation API smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping simulation api"',
  'path: "/api/admin/shipping/simulations"',
  'options: { method: "POST" }',
  '"scenario_count":20',
  '"expected_scenario_count":20',
  '"scenario_key_coverage_status":"passed"',
  '"missing_scenario_keys":[]',
  '"unexpected_scenario_keys":[]',
  '"seller_protection_allocation_contract"',
  '"itemOnlyReimbursementRule"',
  '"shippingExclusionRule"',
  '"nonOptedInSellerLiabilityRule"',
  '"provider_setup_standard_envelope_evidence_contract"',
  '"under_20_seller_protection_caps_mixed_rows"',
  '"under_20_seller_protection_seller_order_visibility"',
  '"under_20_seller_protection_reimbursement_allocation"',
  '"under_20_seller_protection_item_only_allocation_vs_seller_liability"',
  '"under_20_seller_protection_buyer_refund_gate"',
  '"lettertrack_csv_seller_protection_contract"',
  '"purchase_audit"',
  '"expected_scenario_count":5',
  '"live_gate_blocker_evidence_ready"',
  '"provider_setup_blocker_evidence_blocked"',
  '"dry_run_purchase_attempt_audit_sentence"',
  '"packet_purchase_attempt_audit_lines"',
]);
assertFileIncludes("shipping simulation API purchase audit source", "src/app/api/admin/shipping/simulations/route.ts", [
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "purchase_audit",
]);
assertFileIncludes("shipping simulation evidence contract validator", "src/lib/shipping-simulations.ts", [
  "isStandardEnvelopeEvidenceContractReady",
  "unsafeStandardEnvelopeEvidenceContract",
  "approved third-party insurance",
  "runtime_gate_contract_ready",
  "unsafe_contract_rejected",
  "shared live gate validator rejects unsafe contract drift",
]);
assertFileIncludes("admin shipping controls smoke contract", "scripts/smoke-production.mjs", [
  'name: "admin shipping lettertrack controls"',
  'path: "/admin/shipping"',
  "requiredText:",
  "missingRequiredText",
  "missingText",
  "Export LetterTrack CSV",
  "LetterTrack IMb Recording",
  "LetterTrack Delivery Evidence",
  "Seller Protection Refund Proof Missing",
  "Seller Protection Payout Blocked",
  "Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
]);
assertFileIncludes(
  "admin shipping seller protection static guardrail",
  "src/app/admin/shipping/page.tsx",
  [
    "Under-$20 Seller Protection Guardrails",
    "Seller Protection Refund Proof Missing",
    "Seller Protection Payout",
    "Approved under-$20 Standard",
    "LetterTrack/USPS",
    "seller-protection reimbursement",
  ],
);
assertFileIncludes("shipping simulation lab smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping simulation lab"',
  'path: "/admin/shipping/simulations"',
  "requiredText:",
  "Scenario Coverage",
  "Scenario Keys",
  "Scenario coverage guardrail",
  "Seller-protection money trail",
  "Under-$20 Seller Protection Allocation Contract",
  "Item-only reimbursement",
  "Shipping exclusion",
  "No opt-in liability",
  "20",
  "Mixed under-$20 claim rows cap reimbursement at $20",
  "Seller order views can show under-$20 protection status, 2% reserve, protected item cap, unprotected row liability, and shipping excluded from reimbursement",
  "Seller-protection Mark Paid allocation creates credits only for eligible payable seller rows",
  "records operator-readable skip reasons for unprotected/forged/missing-seller/zero-covered/cap-reached rows",
  "Opted-in under-$20 Standard Envelope reimbursement allocates item sale amount only and records excluded shipping",
  "Under-$20 seller-protection Mark Paid requires a current or previously saved internal note confirming buyer refund evidence",
  "Under-$20 seller-protection payout blocks delivered LetterTrack evidence, allows not-delivered review evidence, and accepts a current or previously saved explicit override note",
  "LetterTrack CSV rows carry the under-$20 seller-protection contract",
  "Provider setup exports state that LetterTrack / USPS IMb supplies trackable delivery evidence",
  "Purchase Attempt Audit Coverage",
  "Missing Purchase Audit Keys",
  "Unexpected Purchase Audit Keys",
  "live_gate_blocker_evidence_ready",
  "provider_setup_blocker_evidence_blocked",
  "packet_purchase_attempt_audit_lines",
  "DRY RUN STANDARD ENVELOPE PURCHASE",
]);
assertFileIncludes("shipping simulation lab purchase audit source", "src/app/admin/shipping/simulations/page.tsx", [
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "seller_protection_allocation_contract",
  "Purchase Attempt Audit Coverage",
  "Missing Purchase Audit Keys",
  "Unexpected Purchase Audit Keys",
  "purchaseAudit.missing_scenario_keys",
  "purchaseAudit.unexpected_scenario_keys",
  "Expected purchase audit scenario key manifest",
  "purchaseAudit.scenarios.map",
]);
assertFileIncludes("shipping provider setup smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping provider setup json"',
  'path: "/api/admin/shipping/provider-setup"',
  '"credentialGroups"',
  '"actionPlan"',
  '"Choose provider accounts"',
  '"Stage Vercel environment names"',
  '"Keep shipping runtime locked"',
  '"standardEnvelopeEvidenceContract"',
  '"standardEnvelopeEvidenceContractReady":true',
  '"evidenceProvider":"LetterTrack / USPS IMb"',
  '"trackableRequirement"',
  '"notInsuranceNotice"',
  '"exports"',
  '"csv"',
  '"envTemplate"',
  '"vercelCommands"',
  '"operatorChecklist"',
  "hasShippingProviderSetupHeaders(result)",
  '!result.text.includes("sk_live_")',
  '!result.text.includes("whsec_")',
  'name: "shipping provider setup csv"',
  'path: "/api/admin/shipping/provider-setup?format=csv"',
  'hasAttachmentFilename(result, "tcos-shipping-provider-setup-")',
  "decisionStatus,decisionSummary,decisionNextAction",
  "setupActionPlan",
  "Choose provider accounts",
  "standardEnvelopeEvidenceProvider",
  "under20ProtectionNotInsurance",
  "standardEnvelopeEvidenceContractReady",
  "LetterTrack / USPS IMb",
  "not third-party insurance",
  "liveRequirementBlockers",
  "missingCredentialKeys",
  "hasShippingProviderSetupHeaders(result)",
  'name: "shipping provider env template"',
  'path: "/api/admin/shipping/provider-setup?format=env-template"',
  'result.contentType.includes("text/plain")',
  "Shipping provider unlock action plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Standard Envelope evidence/protection contract",
  "Runtime gate validator: ready",
  "Evidence provider: LetterTrack / USPS IMb",
  "TCOS Under-$20 Seller Protection is an optional internal seller program",
  "Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking",
  "TCOS_SHIPPING_PURCHASE_MODE=dry_run",
  "TCOS_LIVE_SHIPPING_ENABLED=false",
  "hasShippingProviderSetupHeaders(result)",
  'hasAttachmentFilename(result, "tcos-shipping-provider-env-template-")',
  'name: "shipping provider vercel commands"',
  'path: "/api/admin/shipping/provider-setup?format=vercel-commands"',
  "Shipping provider unlock action plan",
  "Stage Vercel environment names",
  "# Production environment",
  "TCOS_LIVE_SHIPPING_ENABLED",
  "hasShippingProviderSetupHeaders(result)",
  'hasAttachmentFilename(result, "tcos-shipping-provider-vercel-env-")',
  'name: "shipping provider operator checklist"',
  'path: "/api/admin/shipping/provider-setup?format=operator-checklist"',
  'result.contentType.includes("text/markdown")',
  "## Shipping Provider Unlock Action Plan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "## Standard Envelope Evidence + Under-$20 Protection Contract",
  "Runtime gate validator: ready",
  "Evidence provider: LetterTrack / USPS IMb",
  "TCOS Under-$20 Seller Protection is an optional internal seller program",
  "Not insurance: LetterTrack / USPS IMb is delivery-evidence tracking",
  "Keep TCOS_SHIPPING_PURCHASE_MODE=dry_run",
  "Keep TCOS_LIVE_SHIPPING_ENABLED=false",
  "hasShippingProviderSetupHeaders(result)",
  'hasAttachmentFilename(result, "tcos-shipping-provider-operator-checklist-")',
]);

assertFileIncludes("shipping provider setup response header source", "src/app/api/admin/shipping/provider-setup/route.ts", [
  "providerSetupResponseHeaders",
  "X-TCOS-Shipping-Provider-Decision",
  "X-TCOS-Shipping-Provider-Missing-Groups",
  "X-TCOS-Shipping-Provider-Live-Blockers",
  "X-TCOS-Shipping-Provider-Contract-Ready",
  "X-TCOS-Shipping-Provider-Summary",
]);

assertFileIncludes("shipping provider setup smoke header helper", "scripts/smoke-production.mjs", [
  "function hasShippingProviderSetupHeaders(result)",
  'result.response?.headers.get("x-tcos-shipping-provider-decision") !==',
  'result.response?.headers.get("x-tcos-shipping-provider-missing-groups") !==',
  'result.response?.headers.get("x-tcos-shipping-provider-live-blockers") !==',
  'result.response?.headers.get("x-tcos-shipping-provider-contract-ready") ===',
  'result.response?.headers.get("x-tcos-shipping-provider-summary") !==',
]);

assertFileIncludes("production smoke attachment filename helper", "scripts/smoke-production.mjs", [
  "function hasAttachmentFilename(result, filenameText)",
  'result.response?.headers.get("content-disposition")',
  'contentDisposition.toLowerCase().includes("attachment")',
  "contentDisposition.includes(filenameText)",
]);

assertFileIncludes("shipping provider standard envelope evidence contract source", "src/lib/shipping-provider-setup.ts", [
  "StandardEnvelopeEvidenceContract",
  "ProviderSetupActionPlanStep",
  "providerSetupActionPlan",
  "Choose provider accounts",
  "Stage Vercel environment names",
  "Keep shipping runtime locked",
  "Prove live adapter evidence",
  "STANDARD_ENVELOPE_EVIDENCE_CONTRACT",
  "isStandardEnvelopeEvidenceContractReady",
  "LetterTrack / USPS IMb",
  "Provides trackable USPS IMb delivery evidence",
  "TCOS only needs provider evidence that can show delivered",
  "TCOS Under-$20 Seller Protection is an optional internal seller program",
  "Seller must opt in per shipment",
  'reserveRate: "2%"',
  'itemReimbursementCap: "$20.00"',
  'reimbursementBasis: "item_sale_amount_excluding_shipping"',
  'reimbursesShipping: "no"',
  "not third-party insurance",
  "standardEnvelopeEvidenceContractReady",
  "const standardEnvelopeEvidenceContract = STANDARD_ENVELOPE_EVIDENCE_CONTRACT",
  "standardEnvelopeEvidenceContract,",
  "standardEnvelopeEvidenceContractReady:",
]);

assertFileIncludes("shipping provider standard envelope evidence export route", "src/app/api/admin/shipping/provider-setup/route.ts", [
  "standardEnvelopeEvidenceContract",
  "actionPlan",
  "Shipping provider unlock action plan",
  "Shipping Provider Unlock Action Plan",
  "setupActionPlan",
  "standardEnvelopeEvidenceContractReady",
  "standardEnvelopeEvidenceProvider",
  "standardEnvelopeTrackableRequirement",
  "under20ProtectionModel",
  "under20ProtectionNotInsurance",
  "Standard Envelope evidence/protection contract",
  "Runtime gate validator:",
  "Operator Handoff",
  "Not insurance:",
]);
assertFileIncludes("shipping export smoke contract", "scripts/smoke-production.mjs", [
  'name: "shipping exceptions export"',
  'path: "/api/admin/shipping/exceptions"',
  'result.contentType.includes("text/csv")',
  'hasAttachmentFilename(result, "tcos-shipping-exceptions-")',
  "priority_rank,exception_key,severity",
  "exception_type",
  "action_needed",
  "claim_id",
  "dry_run_warning",
  'result.response?.headers.get("x-tcos-shipping-exceptions-rows") !==',
  'result.response?.headers.get("x-tcos-shipping-exceptions-critical") !==',
  'result.response?.headers.get("x-tcos-shipping-exceptions-warning") !==',
  'result.response?.headers.get("x-tcos-shipping-exceptions-watch") !==',
  'result.response?.headers.get("x-tcos-shipping-exceptions-summary") !==',
  'name: "lettertrack standard envelope export"',
  'path: "/api/admin/shipping/lettertrack-export"',
  'hasAttachmentFilename(result, "tcos-lettertrack-standard-envelope-")',
  "orderNumber,labelId,recipientName",
  "sellerProtectionReserveRate",
  "sellerProtectionReimbursesShipping",
  "deliveryEvidenceRequirement",
  'result.response?.headers.get("x-tcos-lettertrack-rows") !== null',
  'result.response?.headers.get("x-tcos-lettertrack-skipped") !== null',
  'result.response?.headers.get("x-tcos-lettertrack-skipped-reasons") !==',
  '!result.text.includes("sk_live_")',
  '!result.text.includes("whsec_")',
]);
assertFileIncludes("lettertrack skipped reason source", "src/lib/lettertrack-export.ts", [
  "letterTrackSkippedReasonSummary",
  "Order row was not found for this Standard Envelope label.",
  "Recipient name, address line 1, city, state, and postal code are required before LetterTrack export.",
]);
assertFileIncludes("lettertrack skipped reason route source", "src/app/api/admin/shipping/lettertrack-export/route.ts", [
  "letterTrackSkippedReasonSummary",
  "X-TCOS-LetterTrack-Skipped-Reasons",
]);
assertFileIncludes("shipping blocked purchase evidence audit source", "src/app/api/admin/orders/[id]/shipping-labels/route.ts", [
  "buildShippingProviderSetupPacket",
  "standardEnvelopeEvidenceContractReady",
  "standard_envelope_evidence_contract_ready",
  "standard_envelope_evidence_provider",
  "latest_purchase_attempt",
  "provider_purchase_blocked",
]);
assertFileIncludes("shipping exceptions evidence audit export source", "src/app/api/admin/shipping/exceptions/route.ts", [
  "shippingPurchaseAttemptAuditSentence",
  "raw_payload",
  "shippingExceptionSummary",
  "X-TCOS-Shipping-Exceptions-Rows",
  "X-TCOS-Shipping-Exceptions-Summary",
]);
assertFileIncludes("shipping purchase attempt audit helper source", "src/lib/shipping-purchase-attempt-audit.ts", [
  "buildShippingPurchaseAttemptAudit",
  "shippingPurchaseAttemptAuditSentence",
  "shippingPurchaseAttemptAuditLines",
  "standard_envelope_evidence_contract_ready",
  "Standard Envelope evidence validator:",
  "attempted_by_identity",
]);
assertFileIncludes("shipping purchase attempt audit simulation source", "src/lib/shipping-purchase-attempt-audit-simulations.ts", [
  "live_gate_blocker_evidence_ready",
  "provider_setup_blocker_evidence_blocked",
  "dry_run_purchase_attempt_audit_sentence",
  "empty_purchase_attempt_audit_lines",
  "packet_purchase_attempt_audit_lines",
  "runShippingPurchaseAttemptAuditSimulationSuite",
]);
assertFileIncludes("shipping purchase attempt audit simulation runner", "scripts/run-shipping-purchase-audit-simulations.ts", [
  "runShippingPurchaseAttemptAuditSimulationSuite",
  "Shipping purchase audit simulations:",
  "shipping_purchase_audit_expected_scenario_count",
  "shipping_purchase_audit_expected_scenario_keys",
  "missing_scenario_keys",
  "unexpected_scenario_keys",
]);
assertFileIncludes("instacomp shared draft title contract", "src/lib/instacomp-draft-title.ts", [
  "buildInstaCompDraftTitle",
  "serialRunDisplayLabel",
  "ai?.isRookie ? \"Rookie\"",
  "serialRun",
]);
assertFileIncludes("instacomp server draft title contract", "src/app/api/instacomp/draft-listings/route.ts", [
  "buildInstaCompDraftTitle",
  "function titleFromAi",
  "return buildInstaCompDraftTitle(ai, fallback);",
]);
assertFileIncludes("instacomp scanner draft title callers", "src/app/admin/instacomp/InstaCompScanner.tsx", [
  "buildInstaCompDraftTitle",
  "return buildInstaCompDraftTitle(result.ai, fallback);",
]);
assertFileIncludes("instacomp test scanner draft title callers", "src/app/instacomp-test/InstaCompScanner.tsx", [
  "buildInstaCompDraftTitle",
  "return buildInstaCompDraftTitle(result.ai, fallback);",
]);
assertFileIncludes("instacomp accuracy draft title simulations", "scripts/run-instacomp-accuracy-simulations.mjs", [
  "buildInstaCompDraftTitle",
  "draft title uses print run instead of exact serial",
  "draft title preserves true one-of-one",
  "invalid serial is omitted from draft title",
]);
assertFileIncludes("shipping label packet purchase attempt audit source", "src/app/api/admin/shipping-labels/[id]/packet/route.ts", [
  "Provider Purchase Attempt Audit",
  "shippingPurchaseAttemptAuditLines",
  "latest_purchase_attempt",
  "provider_purchase_blocked",
]);
assertFileIncludes("admin shipping blocked attempt evidence audit source", "src/app/admin/shipping/page.tsx", [
  "buildShippingPurchaseAttemptAudit",
  "purchaseAttemptAudit.evidenceSummary",
  "purchaseAttemptAudit.standardEnvelopeEvidenceContractReady",
]);
assertFileIncludes("admin order label purchase attempt evidence audit source", "src/app/admin/orders/[id]/page.tsx", [
  "buildShippingPurchaseAttemptAudit",
  "Latest provider purchase attempt",
  "purchaseAttemptAudit.evidenceSummary",
  "purchaseAttemptAudit.standardEnvelopeEvidenceContractReady",
]);
assertFileIncludes("operator manual purchase audit simulation contract", "docs/TCOS_OPERATOR_MANUAL.md", [
  "Runs shipping eligibility, dry-run adapter, and provider purchase-attempt audit simulations",
  "five-scenario provider purchase-attempt audit pass evidence",
  "provider purchase-attempt audit suite status/count/key coverage",
  "missing/unexpected purchase-audit key lists",
  "Provider Purchase-Attempt Audit Suite check",
  "before `approvalReady` can become true",
  "Require all twenty policy/adapter assertions plus the five provider purchase-attempt audit assertions",
  "first-class Under-$20 Seller Protection Allocation Contract panel",
  "seller_protection_allocation_contract",
  "item-only reimbursement, shipping exclusion, and non-opted-in seller liability",
]);
assertFileIncludes(
  "seller protection reimbursement packet contract",
  "src/app/api/admin/shipping-claims/[id]/packet/route.ts",
  [
    "Seller-Protection Reimbursement Allocation",
    "latest_seller_protection_reimbursement",
    "reimbursementPlan",
    "Inserted Credits",
    "Plan Requested Amount",
    "Allocation Count",
    "Skipped Rows",
    "skippedRows",
    "row.reason",
    "under20SellerProtectionSkippedRowReasonLabel",
    "shippingExcludedAmount",
    "Mark Paid creates or reuses TCOS internal seller-protection reimbursement credits",
  ],
);
assertFileIncludes(
  "seller protection reimbursement admin card contract",
  "src/app/admin/shipping/ShippingClaimActions.tsx",
  [
    "Seller-protection reimbursement allocation",
    "latest_seller_protection_reimbursement",
    "latest_seller_protection_buyer_refund_evidence",
    "Buyer refund proof readiness",
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "Checked from the typed note and current claim metadata before Mark Paid",
    "reimbursementPlan",
    "Inserted credits",
    "Requested plan",
    "Allocation rows",
    "Skipped rows",
    "skippedRows",
    "row.reason",
    "under20SellerProtectionSkippedRowReasonLabel",
    "shipping excluded",
    "Saved after Mark Paid created or reused TCOS internal seller-protection",
  ],
);
assertFileIncludes(
  "seller protection buyer refund gate route contract",
  "src/app/api/admin/shipping-claims/[id]/route.ts",
  [
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "latest_seller_protection_buyer_refund_evidence",
    "sellerProtectionBuyerRefundEvidence",
  ],
);
assertFileIncludes(
  "seller protection refund proof priority board contract",
  "src/app/admin/shipping/page.tsx",
  [
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "approvedSellerProtectionRefundProofBlockers",
    "seller_protection_refund_proof_missing",
    "Seller Protection Refund Proof Missing",
    "buyer/customer refund evidence or a refund reference documented before Mark Paid",
  ],
);
assertFileIncludes(
  "seller protection refund proof exceptions contract",
  "src/app/api/admin/shipping/exceptions/route.ts",
  [
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "seller_protection_refund_proof_missing",
    "Document buyer/customer refund evidence or a refund reference before Mark Paid",
    "refundGate.reason",
  ],
);
assertFileIncludes(
  "lettertrack saved override helper contract",
  "src/lib/lettertrack-delivery-evidence.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "latest_lettertrack_delivery_evidence_review",
    "latest_admin_status_change",
    "combinedOverrideNote",
    "overrideNote: combinedOverrideNote",
  ],
);
assertFileIncludes(
  "lettertrack saved override runtime callers",
  "src/app/api/admin/shipping-claims/[id]/route.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: params.claim.metadata",
    "overrideNote: params.overrideNote",
  ],
);
assertFileIncludes(
  "lettertrack saved override admin callers",
  "src/app/admin/shipping/page.tsx",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
    "current/saved explicit override note before Mark Paid",
  ],
);
assertFileIncludes(
  "lettertrack saved override exception export callers",
  "src/app/api/admin/shipping/exceptions/route.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
    "current/saved explicit override note before Mark Paid",
  ],
);
assertFileIncludes(
  "lettertrack saved override order detail callers",
  "src/app/admin/orders/[id]/page.tsx",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
  ],
);
assertFileIncludes(
  "lettertrack saved override packet caller",
  "src/app/api/admin/shipping-claims/[id]/packet/route.ts",
  [
    "evaluateLetterTrackSellerProtectionPaymentMetadataGate",
    "metadata: claim.metadata",
  ],
);
assertFileIncludes(
  "seller protection buyer refund helper contract",
  "src/lib/under20-seller-protection-claims.ts",
  [
    "evaluateUnder20SellerProtectionBuyerRefundGate",
    "evaluateUnder20SellerProtectionBuyerRefundMetadataGate",
    "under20SellerProtectionSkippedRowReasonLabel",
    "isEligibleUnder20SellerProtection",
    "latest_admin_status_change",
    "Before Mark Paid",
    "buyer/customer refund evidence",
    "Buyer refund evidence was confirmed",
  ],
);
assertFileIncludes(
  "seller protection seller order visibility helper contract",
  "src/lib/under20-seller-protection-claims.ts",
  [
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "protectedRowCount",
    "unprotectedRowCount",
    "This order has opted-in TCOS Under-$20 Seller Protection",
    "shipping and unprotected rows stay seller responsibility",
  ],
);
assertFileIncludes(
  "seller protection seller orders api visibility contract",
  "src/app/api/account/seller/orders/route.ts",
  [
    "function sellerOrdersHeaders",
    "X-TCOS-Seller-Orders",
    "X-TCOS-Seller-Orders-Active-Cases",
    "X-TCOS-Seller-Orders-Held",
    "X-TCOS-Seller-Orders-Open-Cash-Out",
    "X-TCOS-Seller-Orders-Dry-Run-Shipping-Blocked",
    "dryRunShippingBlockedCount",
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "gross_item_amount,shipping_allocated_amount",
    "metadata",
    "sellerProtection: sellerProtectionSummary",
    "trackingNumber: safeTrackingNumber",
    "carrier: safeCarrier",
  ],
);
assertFileIncludes(
  "seller protection seller order detail api visibility contract",
  "src/app/api/account/seller/orders/[id]/route.ts",
  [
    "function sellerOrderDetailHeaders",
    "X-TCOS-Seller-Order-Detail",
    "X-TCOS-Seller-Order-Items",
    "X-TCOS-Seller-Order-Active-Cases",
    "X-TCOS-Seller-Order-Held-Payout-Rows",
    "X-TCOS-Seller-Order-Cash-Out-Requests",
    "X-TCOS-Seller-Order-Dry-Run-Shipping-Blocked",
    "heldPayoutRowCount",
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "gross_item_amount,shipping_allocated_amount",
    "metadata",
    "sellerProtection: sellerProtectionSummary",
    "trackingNumber: safeTrackingNumber",
    "carrier: safeCarrier",
  ],
);
assertFileIncludes(
  "seller order response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/orders",
    "/api/account/seller/orders/[id]",
    "X-TCOS-Seller-Orders",
    "X-TCOS-Seller-Orders-Active-Cases",
    "X-TCOS-Seller-Orders-Held",
    "X-TCOS-Seller-Orders-Open-Cash-Out",
    "X-TCOS-Seller-Orders-Dry-Run-Shipping-Blocked",
    "X-TCOS-Seller-Order-Detail",
    "X-TCOS-Seller-Order-Items",
    "X-TCOS-Seller-Order-Active-Cases",
    "X-TCOS-Seller-Order-Held-Payout-Rows",
    "X-TCOS-Seller-Order-Cash-Out-Requests",
    "X-TCOS-Seller-Order-Dry-Run-Shipping-Blocked",
    "without exposing tracking values, customer names, payout request IDs, payout ledger IDs, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller protection seller order UI visibility contract",
  "src/app/seller/orders/page.tsx",
  [
    "Under-$20 Seller Protection",
    "2% reserve / $20 max",
    "Shipping Excluded",
    "SellerProtectionCard",
  ],
);
assertFileIncludes(
  "seller inventory marketplace export seller protection contract",
  "src/app/seller/inventory/page.tsx",
  [
    "marketplaceExportSellerProtectionWarning",
    "not insurance",
    "delivery evidence does not show delivered",
    "shipping is excluded",
    "Confirm any TCOS Under-$20 Seller Protection opt-in before fulfillment",
    "standardEnvelopeDeliveryEvidenceRequirement",
    "delivered evidence blocks TCOS under-$20 seller-protection reimbursement",
    "under20SellerProtectionProvider",
    "under20SellerProtectionRate",
    "under20SellerProtectionMaxCoverage",
    "under20SellerProtectionCoverageBasis",
    "under20SellerProtectionClaimRule",
    "under20SellerProtectionRefundRule",
    "under20SellerProtectionReimbursesShipping",
    "under20SellerProtectionLegalLabel",
    "under20SellerProtectionWarning",
    "sellerProtectionWarning",
    "Not insurance: LetterTrack/USPS IMb is delivery evidence",
  ],
);
assertFileIncludes(
  "seller inventory marketplace export filename contract",
  "src/app/seller/inventory/page.tsx",
  [
    'function marketplaceExportFileName(extension: "csv" | "json")',
    '"tcos-marketplace-ready"',
    '`${selectedMarketplaceReadyItems.length}-rows`',
    "`status-${statusFilter}`",
    "`readiness-${readinessFilter}`",
    "`source-${sourceFilter}`",
    "search-${exportSlug(search)}",
    "exportTimestamp()",
    "downloadSelectedMarketplacePacket",
    'marketplaceExportFileName("json")',
    '"application/json;charset=utf-8"',
    "downloadSelectedMarketplaceCsv",
    'marketplaceExportFileName("csv")',
    '"text/csv;charset=utf-8"',
  ],
);
assertFileIncludes(
  "seller inventory marketplace export context contract",
  "src/app/seller/inventory/page.tsx",
  [
    "function marketplaceExportContext(): MarketplaceExportContext",
    "selectedCount: selectedInventoryItemIds.length",
    "selectedReadyCount: selectedMarketplaceReadyItems.length",
    "visibleCount: selectedVisibleCount",
    "statusFilter",
    "readinessFilter",
    "sourceFilter",
    "search: search.trim()",
    "marketplaceExportPacket(",
    "marketplaceExportContext()",
    "exportContext",
  ],
);
assertFileIncludes(
  "collector export download contract",
  "src/app/api/account/collector/exports/route.ts",
  [
    'type ExportFormat = "csv" | "catalog_json"',
    "function downloadResponse",
    '"Content-Disposition": `attachment; filename="${params.fileName}"`',
    '"Cache-Control": "no-store"',
    "X-TCOS-Collector-Export-Format",
    "X-TCOS-Collector-Export-Items",
    "X-TCOS-Collector-Export-Wish-List",
    "X-TCOS-Collector-Exported-At",
    "tcos-collection-catalog-",
    "tcos-collection-",
    "account_collection_export_jobs",
    "wish_list_count: wishListItems.length",
    "generated_inline: true",
    'contentType: "application/json; charset=utf-8"',
    'contentType: "text/csv; charset=utf-8"',
    "media_manifest",
    "collectionCsv(collectionItems)",
  ],
);
assertFileIncludes(
  "account orders response contract",
  "src/app/api/account/orders/route.ts",
  [
    "function accountOrdersHeaders",
    "X-TCOS-Account-Orders",
    "X-TCOS-Account-Orders-Dry-Run-Shipping-Blocked",
    "X-TCOS-Account-Orders-Seller-Item",
    "dry_run_shipping_blocked",
    "dryRunShippingBlockedCount",
    "sellerItemOrderCount",
    "isDryRunShippingReference(order.tracking_number)",
    "tracking_number: dryRunShipping ? null",
    "carrier: dryRunShipping ? null",
  ],
);
assertFileIncludes(
  "dashboard preferences response contract",
  "src/app/api/account/dashboard/preferences/route.ts",
  [
    "function dashboardPreferenceListHeaders",
    "function dashboardPreferenceMutationHeaders",
    "X-TCOS-Dashboard-Sports-Favorites",
    "X-TCOS-Dashboard-Market-Watchlist",
    "X-TCOS-Dashboard-Preference-Kind",
    "X-TCOS-Dashboard-Preference-Mutation",
    "X-TCOS-Dashboard-Preference-Id",
    "sportsFavoriteCount: sportsFavorites.length",
    "marketWatchlistCount: marketWatchlist.length",
    'action: "created"',
    'action: "archived"',
    "account_sports_favorites",
    "account_market_watchlist_items",
  ],
);
assertFileIncludes(
  "account auth response header helper",
  "src/lib/account-auth.ts",
  [
    "function accountAuthResponseHeaders",
    "X-TCOS-Account-Auth-Action",
    "X-TCOS-Account-Auth-Status",
    "X-TCOS-Account-Auth-Card-Verification",
    "X-TCOS-Account-Auth-Session",
    "X-TCOS-Account-Auth-Membership",
  ],
);
assertFileIncludes(
  "account login response contract",
  "src/app/api/account/login/route.ts",
  [
    "accountAuthResponseHeaders",
    'action: "login"',
    'status: "missing_credentials"',
    'status: "blocked"',
    'status: "invalid_credentials"',
    'status: "payment_verification_required"',
    'status: "inactive"',
    'status: "authenticated"',
    'cardVerification: "required"',
    'cardVerification: profile?.card_verified ? "verified" : "active"',
    'session: "issued"',
    'membership: "buyer"',
  ],
);
assertFileIncludes(
  "account signup response contract",
  "src/app/api/account/signup/route.ts",
  [
    "accountAuthResponseHeaders",
    'action: "signup"',
    'status: "missing_credentials"',
    'status: "weak_password"',
    'status: "terms_required"',
    'status: "blocked"',
    'status: "payment_runtime_unavailable"',
    'status: "signup_failed"',
    '"created_pending_card_verification"',
    '"created_active"',
    "stripeSessionId",
    "cardVerificationUrl",
    '!cardVerificationRequired && data.session ? "issued" : "not_issued"',
    'membership: "buyer"',
  ],
);
assertFileIncludes(
  "account auth operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/login",
    "/api/account/signup",
    "X-TCOS-Account-Auth-Action",
    "X-TCOS-Account-Auth-Status",
    "X-TCOS-Account-Auth-Card-Verification",
    "X-TCOS-Account-Auth-Session",
    "X-TCOS-Account-Auth-Membership",
    "without exposing emails, account IDs, auth sessions, Stripe session IDs, or card data",
  ],
);
assertFileIncludes(
  "account dashboard operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/orders",
    "X-TCOS-Account-Orders",
    "X-TCOS-Account-Orders-Dry-Run-Shipping-Blocked",
    "X-TCOS-Account-Orders-Seller-Item",
    "without exposing hidden dry-run tracking/carrier values",
    "/api/account/dashboard/preferences",
    "X-TCOS-Dashboard-Sports-Favorites",
    "X-TCOS-Dashboard-Market-Watchlist",
    "X-TCOS-Dashboard-Preference-Kind",
    "X-TCOS-Dashboard-Preference-Mutation",
    "X-TCOS-Dashboard-Preference-Id",
  ],
);
assertFileIncludes(
  "collector items response contract",
  "src/app/api/account/collector/items/route.ts",
  [
    "function collectorItemsHeaders",
    "function collectorMutationHeaders",
    "X-TCOS-Collector-Items",
    "X-TCOS-Collector-Wish-List",
    "X-TCOS-Collector-Item-Kind",
    "X-TCOS-Collector-Mutation",
    "X-TCOS-Collector-Item-Id",
    "collectionItemCount: collectionItems.length",
    "wishListItemCount: wishListItems.length",
    'action: "created"',
    'action: "archived"',
    'action: "canceled"',
    "account_collection_items",
    "account_wish_list_items",
  ],
);
assertFileIncludes(
  "collector items operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/items",
    "collection_item",
    "wish_list_item",
    "X-TCOS-Collector-Items",
    "X-TCOS-Collector-Wish-List",
    "X-TCOS-Collector-Item-Kind",
    "X-TCOS-Collector-Mutation",
    "X-TCOS-Collector-Item-Id",
  ],
);
assertFileIncludes(
  "collector profile response contract",
  "src/app/api/account/collector/profile/route.ts",
  [
    "function collectorProfileHeaders",
    "X-TCOS-Collector-Profile-Present",
    "X-TCOS-Collector-Profile-Visibility",
    "X-TCOS-Collector-Profile-Messages",
    "X-TCOS-Collector-Profile-Mutation",
    'mutation: "loaded"',
    'mutation: "upserted"',
    "account_collector_profiles",
    "allow_messages",
  ],
);
assertFileIncludes(
  "collector profile operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/profile",
    "X-TCOS-Collector-Profile-Present",
    "X-TCOS-Collector-Profile-Visibility",
    "X-TCOS-Collector-Profile-Messages",
    "X-TCOS-Collector-Profile-Mutation",
    "without exposing account IDs in response headers",
  ],
);
assertFileIncludes(
  "collector social response contract",
  "src/app/api/account/collector/social/route.ts",
  [
    "function collectorSocialListHeaders",
    "function collectorSocialMutationHeaders",
    "X-TCOS-Collector-Social-Collectors",
    "X-TCOS-Collector-Social-Following",
    "X-TCOS-Collector-Social-Friends",
    "X-TCOS-Collector-Social-Incoming-Friend-Requests",
    "X-TCOS-Collector-Social-Outgoing-Friend-Requests",
    "X-TCOS-Collector-Social-Feed",
    "X-TCOS-Collector-Social-Action",
    "X-TCOS-Collector-Social-Status",
    "X-TCOS-Collector-Social-Connection-Type",
    "X-TCOS-Collector-Social-Resource-Id",
    "collectorCount: collectors.length",
    "followingCount: following.length",
    "friendCount: friends.length",
    "incomingFriendRequestCount: incomingFriendRequests.length",
    "outgoingFriendRequestCount: outgoingFriendRequests.length",
    "feedCount: feedItems.length",
    'action: "remove_connection"',
    'connectionType: "brag"',
    "account_social_connections",
    "account_brag_posts",
  ],
);
assertFileIncludes(
  "collector social operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/social",
    "X-TCOS-Collector-Social-Collectors",
    "X-TCOS-Collector-Social-Following",
    "X-TCOS-Collector-Social-Friends",
    "X-TCOS-Collector-Social-Incoming-Friend-Requests",
    "X-TCOS-Collector-Social-Outgoing-Friend-Requests",
    "X-TCOS-Collector-Social-Feed",
    "X-TCOS-Collector-Social-Action",
    "X-TCOS-Collector-Social-Status",
    "X-TCOS-Collector-Social-Connection-Type",
    "X-TCOS-Collector-Social-Resource-Id",
    "without exposing target collector account IDs",
  ],
);
assertFileIncludes(
  "brag share redirect response contract",
  "src/app/brag/[slug]/route.ts",
  [
    "function bragRedirectResponse",
    "X-TCOS-Brag-Share-Slug",
    "X-TCOS-Brag-Share-Source",
    "X-TCOS-Brag-Click-Tracking",
    "X-TCOS-Brag-Redirect-Destination",
    'trackingStatus: "invalid_slug"',
    'let trackingStatus: "tracked" | "not_found" | "failed" = "not_found"',
    'trackingStatus = "tracked"',
    'trackingStatus = "failed"',
    "account_brag_post_clicks",
    "account_brag_posts",
  ],
);
assertFileIncludes(
  "brag weekly report response contract",
  "src/app/api/admin/brag-weekly-report/route.ts",
  [
    "function bragWeeklyReportHeaders",
    "X-TCOS-Brag-Weekly-Report-Id",
    "X-TCOS-Brag-Weekly-Posts",
    "X-TCOS-Brag-Weekly-Clicks",
    "X-TCOS-Brag-Weekly-Emailed",
    "X-TCOS-Brag-Weekly-Email-Status",
    "postCount: reportJson.postCount",
    "clickCount: reportJson.clickCount",
    "emailStatus",
    "account_brag_weekly_reports",
    "account_brag_post_clicks",
  ],
);
assertFileIncludes(
  "brag share operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "X-TCOS-Brag-Share-Slug",
    "X-TCOS-Brag-Share-Source",
    "X-TCOS-Brag-Click-Tracking",
    "X-TCOS-Brag-Redirect-Destination",
    "without exposing collector account IDs",
    "/api/admin/brag-weekly-report",
    "X-TCOS-Brag-Weekly-Report-Id",
    "X-TCOS-Brag-Weekly-Posts",
    "X-TCOS-Brag-Weekly-Clicks",
    "X-TCOS-Brag-Weekly-Emailed",
    "X-TCOS-Brag-Weekly-Email-Status",
  ],
);
assertFileIncludes(
  "collector export operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/exports?format=csv",
    "/api/account/collector/exports?format=catalog_json",
    "account_collection_export_jobs",
    "X-TCOS-Collector-Export-Format",
    "X-TCOS-Collector-Export-Items",
    "X-TCOS-Collector-Export-Wish-List",
    "X-TCOS-Collector-Exported-At",
  ],
);
assertFileIncludes(
  "collector import response contract",
  "src/app/api/account/collector/imports/route.ts",
  [
    "function collectorImportHeaders",
    "X-TCOS-Collector-Import-Source",
    "X-TCOS-Collector-Import-Rows",
    "X-TCOS-Collector-Import-Imported",
    "X-TCOS-Collector-Import-Skipped",
    "X-TCOS-Collector-Import-Errors",
    "X-TCOS-Collector-Import-Job",
    "sourceMarketplace",
    "rowCount: rows.length",
    "importedCount: importedItems.length",
    "skippedCount: skipped.length",
    "errorCount: errors.length",
    "importJobId",
    "account_collection_import_jobs",
    "row_count: params.rowCount",
    "imported_count: params.importedCount",
    "skipped_count: params.skippedCount",
    "error_count: params.errorCount",
  ],
);
assertFileIncludes(
  "collector import operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/imports",
    "account_collection_import_jobs",
    "X-TCOS-Collector-Import-Source",
    "X-TCOS-Collector-Import-Rows",
    "X-TCOS-Collector-Import-Imported",
    "X-TCOS-Collector-Import-Skipped",
    "X-TCOS-Collector-Import-Errors",
    "X-TCOS-Collector-Import-Job",
  ],
);
assertFileIncludes(
  "collector messages response contract",
  "src/app/api/account/collector/messages/route.ts",
  [
    "function collectorConversationHeaders",
    "function collectorMessageHeaders",
    "X-TCOS-Collector-Conversations",
    "X-TCOS-Collector-Conversation-Id",
    "X-TCOS-Collector-Message-Id",
    "X-TCOS-Collector-Message-Action",
    "conversationCount: conversations.length",
    'messageAction: "new_conversation" | "existing_conversation"',
    "account_conversations",
    "account_conversation_messages",
  ],
);
assertFileIncludes(
  "collector messages operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/messages",
    "X-TCOS-Collector-Conversations",
    "X-TCOS-Collector-Conversation-Id",
    "X-TCOS-Collector-Message-Id",
    "X-TCOS-Collector-Message-Action",
    "new conversation sends from replies",
  ],
);
assertFileIncludes(
  "collector binding offer response contract",
  "src/app/api/account/collector/binding-offers/route.ts",
  [
    "function collectorBindingOfferHeaders",
    "X-TCOS-Collector-Binding-Offer-Id",
    "X-TCOS-Collector-Binding-Offer-Conversation",
    "X-TCOS-Collector-Binding-Offer-Conversation-Action",
    "X-TCOS-Collector-Binding-Offer-Status",
    "X-TCOS-Collector-Binding-Offer-Payment-Required",
    'conversationAction: "new_conversation" | "existing_conversation"',
    'status: "payment_required"',
    "paymentRequired: true",
    "account_binding_offers",
    "stripe.checkout.sessions.create",
  ],
);
assertFileIncludes(
  "collector binding offer operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/collector/binding-offers",
    "X-TCOS-Collector-Binding-Offer-Id",
    "X-TCOS-Collector-Binding-Offer-Conversation",
    "X-TCOS-Collector-Binding-Offer-Conversation-Action",
    "X-TCOS-Collector-Binding-Offer-Status",
    "X-TCOS-Collector-Binding-Offer-Payment-Required",
    "without exposing Stripe secrets or account IDs",
  ],
);
assertFileIncludes(
  "seller marketplace packet intake contract",
  "src/app/seller/marketplaces/SellerConnectionsPanel.tsx",
  [
    "Marketplace Packet Intake",
    "Seller Inventory packet handoff",
    "cross-list prep only",
    "no external publishing",
    "No postage purchase",
    "no Coverage policy creation",
    "no seller payout release",
    "no order fulfillment",
    "Not insurance",
    "does not activate TCOS Under-$20 Seller Protection",
    "/seller/inventory?status=draft&readiness=ready",
    "/seller/inventory?status=draft&readiness=needs_work",
  ],
);
assertFileIncludes(
  "seller marketplace receipt handoff build queue contract",
  "src/app/seller/marketplaces/page.tsx",
  [
    "buildSellerMarketplaceReceiptHandoffContract",
    "sellerMarketplaceReceiptHandoff",
    "sellerMarketplaceReceiptHandoff.controlsSentence",
    "sellerMarketplaceReceiptHandoff.operations.join",
    "Seller marketplace receipt handoff",
    "safe marketplace API receipt handoffs",
  ],
);
assertFileIncludes(
  "seller marketplace connection response metadata contract",
  "src/app/api/account/seller/marketplace-connections/route.ts",
  [
    "function sellerMarketplaceConnectionHeaders",
    "function sellerMarketplaceConnectionMutationHeaders",
    "X-TCOS-Seller-Marketplace-Connections",
    "X-TCOS-Seller-Marketplace-Connected",
    "X-TCOS-Seller-Marketplace-Requested",
    "X-TCOS-Seller-Marketplace-Sync-Errors",
    "X-TCOS-Seller-Marketplace-Providers",
    "X-TCOS-Seller-Marketplace-Connection-Mutation",
    "X-TCOS-Seller-Marketplace-Connection-Provider",
    "X-TCOS-Seller-Marketplace-Connection-Status",
    "X-TCOS-Seller-Marketplace-Sync-Status",
    "providerList || \"none\"",
    "connections.map(publicSellerMarketplaceConnection)",
  ],
);
assertFileIncludes(
  "seller marketplace connection response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections",
    "X-TCOS-Seller-Marketplace-Connections",
    "X-TCOS-Seller-Marketplace-Connected",
    "X-TCOS-Seller-Marketplace-Requested",
    "X-TCOS-Seller-Marketplace-Sync-Errors",
    "X-TCOS-Seller-Marketplace-Providers",
    "X-TCOS-Seller-Marketplace-Connection-Mutation",
    "X-TCOS-Seller-Marketplace-Connection-Provider",
    "X-TCOS-Seller-Marketplace-Connection-Status",
    "X-TCOS-Seller-Marketplace-Sync-Status",
    "without exposing connection IDs, provider account IDs, provider account labels, OAuth scopes, token timestamps, sync error text, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace ebay auth response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/auth/route.ts",
  [
    "function sellerMarketplaceEbayAuthHeaders",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Provider",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Store-Sync",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Connection-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Sync-Status",
    "status: \"requested\"",
    "status: \"misconfigured\"",
    "status: \"blocked\"",
    "status: \"failed\"",
    "const { error: connectionError }",
  ],
);
assertFileIncludes(
  "seller marketplace ebay disconnect response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/disconnect/route.ts",
  [
    "function sellerMarketplaceEbayDisconnectHeaders",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Result",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Already",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Connection-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Sync-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Credentials-Deleted",
    "result: \"already_disconnected\"",
    "result: \"disconnected\"",
    "result: \"failed\"",
    "localCredentialsDeleted: true",
  ],
);
assertFileIncludes(
  "seller marketplace ebay auth and disconnect response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections/ebay/auth",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Provider",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Store-Sync",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Connection-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Sync-Status",
    "without exposing authorization URLs, signed OAuth state, eBay client IDs, OAuth scopes, connection IDs, provider account IDs, provider account labels, token data, or seller account IDs in headers",
    "/api/account/seller/marketplace-connections/ebay/disconnect",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Result",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Already",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Connection-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Sync-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Credentials-Deleted",
    "without exposing connection IDs, provider account IDs, provider account labels, OAuth scopes, token IDs, token timestamps, stored token keys, provider metadata, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace ebay status response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/status/route.ts",
  [
    "function sellerMarketplaceEbayStatusHeaders",
    "X-TCOS-Seller-Marketplace-Ebay-Status-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Verified",
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Warning",
    "refreshStatus: \"refreshed\"",
    "refreshStatus: \"failed\"",
    "identityVerified: Boolean(status.identity)",
    "identityWarning: Boolean(status.identityWarning)",
  ],
);
assertFileIncludes(
  "seller marketplace sync-control response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/sync-control/route.ts",
  [
    "function sellerMarketplaceSyncControlHeaders",
    "X-TCOS-Seller-Marketplace-Sync-Control-Mutation",
    "X-TCOS-Seller-Marketplace-Sync-Control-Action",
    "X-TCOS-Seller-Marketplace-Sync-Control-Result",
    "X-TCOS-Seller-Marketplace-Sync-Control-Unchanged",
    "X-TCOS-Seller-Marketplace-Sync-Control-Connection-Status",
    "X-TCOS-Seller-Marketplace-Sync-Control-Sync-Status",
    "result: \"changed\"",
    "result: \"unchanged\"",
    "result: \"blocked\"",
    "result: \"missing\"",
    "result: \"invalid\"",
    "requestedAction",
  ],
);
assertFileIncludes(
  "seller marketplace ebay status and sync-control response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections/ebay/status",
    "X-TCOS-Seller-Marketplace-Ebay-Status-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Status",
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Verified",
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Warning",
    "without exposing access tokens, refresh tokens, provider account IDs, provider account labels, OAuth scopes, token timestamps, identity usernames, identity user IDs, raw eBay error text, or seller account IDs in headers",
    "/api/account/seller/marketplace-connections/ebay/sync-control",
    "X-TCOS-Seller-Marketplace-Sync-Control-Mutation",
    "X-TCOS-Seller-Marketplace-Sync-Control-Action",
    "X-TCOS-Seller-Marketplace-Sync-Control-Result",
    "X-TCOS-Seller-Marketplace-Sync-Control-Unchanged",
    "X-TCOS-Seller-Marketplace-Sync-Control-Connection-Status",
    "X-TCOS-Seller-Marketplace-Sync-Control-Sync-Status",
    "without exposing connection IDs, provider account IDs, provider account labels, token IDs, token timestamps, store settings details, sync error text, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace import-preview response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/import-preview/route.ts",
  [
    "function sellerMarketplaceImportPreviewHeaders",
    "function summarizeImportPreviewItems",
    "X-TCOS-Seller-Marketplace-Import-Preview-Status",
    "X-TCOS-Seller-Marketplace-Import-Preview-Requested-Limit",
    "X-TCOS-Seller-Marketplace-Import-Preview-Sampled",
    "X-TCOS-Seller-Marketplace-Import-Preview-Total-Available",
    "X-TCOS-Seller-Marketplace-Import-Preview-Has-More",
    "X-TCOS-Seller-Marketplace-Import-Preview-Write-Blocked",
    "X-TCOS-Seller-Marketplace-Import-Preview-Ready",
    "X-TCOS-Seller-Marketplace-Import-Preview-Needs-Review",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-SKU",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Listing-ID",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Price",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Image",
    "summarizeImportPreviewItems(preview.sampleItems)",
    "status: preview.writeBlocked ? \"blocked\" : \"loaded\"",
    "status: message.includes(\"disabled\") ? \"blocked\" : \"failed\"",
  ],
);
assertFileIncludes(
  "seller marketplace import-preview response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections/ebay/import-preview",
    "X-TCOS-Seller-Marketplace-Import-Preview-Status",
    "X-TCOS-Seller-Marketplace-Import-Preview-Requested-Limit",
    "X-TCOS-Seller-Marketplace-Import-Preview-Sampled",
    "X-TCOS-Seller-Marketplace-Import-Preview-Total-Available",
    "X-TCOS-Seller-Marketplace-Import-Preview-Has-More",
    "X-TCOS-Seller-Marketplace-Import-Preview-Write-Blocked",
    "X-TCOS-Seller-Marketplace-Import-Preview-Ready",
    "X-TCOS-Seller-Marketplace-Import-Preview-Needs-Review",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-SKU",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Listing-ID",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Price",
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Image",
    "without exposing preview listing IDs, SKUs, titles, image URLs, prices, provider account IDs, connection IDs, token data, raw eBay error text, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace reconciliation response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/reconcile/route.ts",
  [
    "function sellerMarketplaceReconciliationHeaders",
    "X-TCOS-Seller-Marketplace-Reconcile-Mutation",
    "X-TCOS-Seller-Marketplace-Reconcile-Status",
    "X-TCOS-Seller-Marketplace-Reconcile-Linked",
    "X-TCOS-Seller-Marketplace-Reconcile-Recent-Runs",
    "X-TCOS-Seller-Marketplace-Reconcile-Scanned",
    "X-TCOS-Seller-Marketplace-Reconcile-Matched",
    "X-TCOS-Seller-Marketplace-Reconcile-Quantity-Reduced",
    "X-TCOS-Seller-Marketplace-Reconcile-Sold",
    "X-TCOS-Seller-Marketplace-Reconcile-Review",
    "X-TCOS-Seller-Marketplace-Reconcile-Failed",
    "X-TCOS-Seller-Marketplace-Reconcile-Has-More",
    "X-TCOS-Seller-Marketplace-Reconcile-Reset-Cursor",
    "latestRun?.scannedCount",
    "status: result.status === \"completed\" ? \"completed\" : \"processing\"",
    "status: status === 409 ? \"blocked\" : \"failed\"",
  ],
);
assertFileIncludes(
  "seller marketplace order import response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/orders/route.ts",
  [
    "function sellerMarketplaceOrderImportHeaders",
    "function unavailableOrderImportResponse",
    "X-TCOS-Seller-Marketplace-Order-Import-Mutation",
    "X-TCOS-Seller-Marketplace-Order-Import-Status",
    "X-TCOS-Seller-Marketplace-Order-Import-Orders",
    "X-TCOS-Seller-Marketplace-Order-Import-Paid",
    "X-TCOS-Seller-Marketplace-Order-Import-Refunded",
    "X-TCOS-Seller-Marketplace-Order-Import-Recent",
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Orders",
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Items",
    "X-TCOS-Seller-Marketplace-Order-Import-Inventory-Reduced",
    "X-TCOS-Seller-Marketplace-Order-Import-Sold",
    "X-TCOS-Seller-Marketplace-Order-Import-Unmatched",
    "X-TCOS-Seller-Marketplace-Order-Import-Review",
    "X-TCOS-Seller-Marketplace-Order-Import-Failed-Items",
    "X-TCOS-Seller-Marketplace-Order-Import-Has-More",
    "X-TCOS-Seller-Marketplace-Order-Import-Reset-Cursor",
    "recentOrderCount: status.recentOrders.length",
    "importedOrderCount: result.importedOrderCount",
    "status: status === 409 ? \"blocked\" : \"failed\"",
  ],
);
assertFileIncludes(
  "seller marketplace reconciliation and order import response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections/ebay/reconcile",
    "X-TCOS-Seller-Marketplace-Reconcile-Mutation",
    "X-TCOS-Seller-Marketplace-Reconcile-Status",
    "X-TCOS-Seller-Marketplace-Reconcile-Linked",
    "X-TCOS-Seller-Marketplace-Reconcile-Recent-Runs",
    "X-TCOS-Seller-Marketplace-Reconcile-Scanned",
    "X-TCOS-Seller-Marketplace-Reconcile-Matched",
    "X-TCOS-Seller-Marketplace-Reconcile-Quantity-Reduced",
    "X-TCOS-Seller-Marketplace-Reconcile-Sold",
    "X-TCOS-Seller-Marketplace-Reconcile-Review",
    "X-TCOS-Seller-Marketplace-Reconcile-Failed",
    "X-TCOS-Seller-Marketplace-Reconcile-Has-More",
    "X-TCOS-Seller-Marketplace-Reconcile-Reset-Cursor",
    "without exposing run IDs, connection IDs, provider account IDs, listing IDs, SKUs, titles, inventory item IDs, cursor offsets, token data, raw eBay error text, or seller account IDs in headers",
    "/api/account/seller/marketplace-connections/ebay/orders",
    "X-TCOS-Seller-Marketplace-Order-Import-Mutation",
    "X-TCOS-Seller-Marketplace-Order-Import-Status",
    "X-TCOS-Seller-Marketplace-Order-Import-Orders",
    "X-TCOS-Seller-Marketplace-Order-Import-Paid",
    "X-TCOS-Seller-Marketplace-Order-Import-Refunded",
    "X-TCOS-Seller-Marketplace-Order-Import-Recent",
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Orders",
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Items",
    "X-TCOS-Seller-Marketplace-Order-Import-Inventory-Reduced",
    "X-TCOS-Seller-Marketplace-Order-Import-Sold",
    "X-TCOS-Seller-Marketplace-Order-Import-Unmatched",
    "X-TCOS-Seller-Marketplace-Order-Import-Review",
    "X-TCOS-Seller-Marketplace-Order-Import-Failed-Items",
    "X-TCOS-Seller-Marketplace-Order-Import-Has-More",
    "X-TCOS-Seller-Marketplace-Order-Import-Reset-Cursor",
    "without exposing order IDs, provider order IDs, event keys, listing IDs, SKUs, buyer data, order totals, cursor windows, connection IDs, token data, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace staged-items response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/staged-items/route.ts",
  [
    "function summarizeStagedItems",
    "function sellerMarketplaceStagedHeaders",
    "function sellerMarketplaceStagedMutationHeaders",
    "X-TCOS-Seller-Marketplace-Staged-Rows",
    "X-TCOS-Seller-Marketplace-Staged-Ready",
    "X-TCOS-Seller-Marketplace-Staged-Draft-Cleanup",
    "X-TCOS-Seller-Marketplace-Staged-Needs-Review",
    "X-TCOS-Seller-Marketplace-Staged-Mapped",
    "X-TCOS-Seller-Marketplace-Staged-Skipped",
    "X-TCOS-Seller-Marketplace-Staged-Blocked",
    "X-TCOS-Seller-Marketplace-Staged-Promoted",
    "X-TCOS-Seller-Marketplace-Import-Jobs",
    "X-TCOS-Seller-Marketplace-Staged-Mutation",
    "X-TCOS-Seller-Marketplace-Staged-Count",
    "X-TCOS-Seller-Marketplace-Staged-Updated",
    "X-TCOS-Seller-Marketplace-Staged-Target-Status",
    "X-TCOS-Seller-Marketplace-Staged-Has-More",
    "summarizeStagedItems(enrichedStagedItems)",
    "action: \"stage_batch\"",
    "action: \"update\"",
  ],
);
assertFileIncludes(
  "seller marketplace staged-items response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    "X-TCOS-Seller-Marketplace-Staged-Rows",
    "X-TCOS-Seller-Marketplace-Staged-Ready",
    "X-TCOS-Seller-Marketplace-Staged-Draft-Cleanup",
    "X-TCOS-Seller-Marketplace-Staged-Needs-Review",
    "X-TCOS-Seller-Marketplace-Staged-Mapped",
    "X-TCOS-Seller-Marketplace-Staged-Skipped",
    "X-TCOS-Seller-Marketplace-Staged-Blocked",
    "X-TCOS-Seller-Marketplace-Staged-Promoted",
    "X-TCOS-Seller-Marketplace-Import-Jobs",
    "X-TCOS-Seller-Marketplace-Staged-Mutation",
    "X-TCOS-Seller-Marketplace-Staged-Count",
    "X-TCOS-Seller-Marketplace-Staged-Updated",
    "X-TCOS-Seller-Marketplace-Staged-Target-Status",
    "X-TCOS-Seller-Marketplace-Staged-Has-More",
    "without exposing staged row IDs, source listing IDs, SKUs, titles, image URLs, duplicate product IDs, import job IDs, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace staged-items promote response metadata contract",
  "src/app/api/account/seller/marketplace-connections/ebay/staged-items/promote/route.ts",
  [
    "function sellerMarketplacePromoteHeaders",
    "X-TCOS-Seller-Marketplace-Promote-Mutation",
    "X-TCOS-Seller-Marketplace-Promote-Mode",
    "X-TCOS-Seller-Marketplace-Promote-Requested",
    "X-TCOS-Seller-Marketplace-Promote-Succeeded",
    "X-TCOS-Seller-Marketplace-Promote-Failed",
    "X-TCOS-Seller-Marketplace-Promote-Partial",
    "X-TCOS-Seller-Marketplace-Promote-Status",
    "requestedPromotionCount",
    "promotionMode",
    "mode: \"single\"",
    "mode: \"batch\"",
    "promotedCount: promotedItems.length",
    "errorCount: errors.length",
  ],
);
assertFileIncludes(
  "seller marketplace staged-items promote response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/marketplace-connections/ebay/staged-items/promote",
    "X-TCOS-Seller-Marketplace-Promote-Mutation",
    "X-TCOS-Seller-Marketplace-Promote-Mode",
    "X-TCOS-Seller-Marketplace-Promote-Requested",
    "X-TCOS-Seller-Marketplace-Promote-Succeeded",
    "X-TCOS-Seller-Marketplace-Promote-Failed",
    "X-TCOS-Seller-Marketplace-Promote-Partial",
    "X-TCOS-Seller-Marketplace-Promote-Status",
    "without exposing staged row IDs, source listing IDs, SKUs, titles, draft product IDs, inventory item IDs, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller marketplace UI operation receipt contract",
  "src/app/seller/marketplaces/SellerConnectionsPanel.tsx",
  [
    "type SellerMarketplaceOperationReceipt",
    "type SellerMarketplaceOperationReceiptHistoryEntry",
    "class SellerMarketplaceOperationError",
    "function operationReceiptFromError",
    "rememberOperationErrorReceipt",
    "formatSellerMarketplaceOperationReceipt",
    "formatSellerMarketplaceOperationReceiptHistory",
    "SELLER_MARKETPLACE_RECEIPT_HISTORY_STORAGE_KEY",
    "SELLER_MARKETPLACE_RECEIPT_DOWNLOAD_MIME_TYPE",
    "saveSellerMarketplaceOperationReceiptHistoryToSession",
    "sellerMarketplaceReceiptFileName",
    "downloadSellerMarketplaceReceiptFile",
    "copyMarketplaceOperationReceipt",
    "copyMarketplaceOperationReceiptTrail",
    "downloadMarketplaceOperationReceipt",
    "downloadMarketplaceOperationReceiptTrail",
    "Copy Safe Receipt",
    "Download Safe Receipt",
    "Copy Trail",
    "Download Trail",
    "Clear Trail",
    "Session-saved in this browser tab for operator handoff.",
    "Safe marketplace API receipt downloaded.",
    "Safe marketplace API receipt trail downloaded.",
    "Safe marketplace API receipt trail copied.",
    "Safe marketplace API receipt copied.",
    "function SellerMarketplaceOperationReceiptCard",
    "function SellerMarketplaceOperationReceiptHistory",
    "marketplaceOperationReceiptHistory",
    "Recent Marketplace API Receipts",
    "Latest Marketplace API Receipt",
    "setLatestMarketplaceOperationReceipt",
    "sellerMarketplaceEbayAuthReceipt",
    "sellerMarketplaceEbayStatusReceipt",
    "sellerMarketplaceSyncControlReceipt",
    "sellerMarketplaceEbayDisconnectReceipt",
    "sellerMarketplaceImportPreviewReceipt",
    "sellerMarketplaceReconciliationReceipt",
    "sellerMarketplaceOrderImportReceipt",
    "sellerMarketplaceStagedReceipt",
    "sellerMarketplacePromotionReceipt",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Status-Mutation",
    "X-TCOS-Seller-Marketplace-Sync-Control-Mutation",
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Mutation",
    "X-TCOS-Seller-Marketplace-Import-Preview-Status",
    "X-TCOS-Seller-Marketplace-Reconcile-Mutation",
    "X-TCOS-Seller-Marketplace-Order-Import-Mutation",
    "X-TCOS-Seller-Marketplace-Staged-Mutation",
    "X-TCOS-Seller-Marketplace-Staged-Rows",
    "X-TCOS-Seller-Marketplace-Promote-Mutation",
    "X-TCOS-Seller-Marketplace-Promote-Status",
  ],
);
assertFileIncludes(
  "seller marketplace UI operation receipt operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "Latest Marketplace API Receipt",
    "Recent Marketplace API Receipts",
    "Copy Safe Receipt",
    "Download Safe Receipt",
    "Copy Trail",
    "Download Trail",
    "Clear Trail",
    "sessionStorage",
    "limited to five safe receipt summaries",
    "operator handoff aid, not an audit ledger",
    "without exposing OAuth tokens, seller account IDs, row IDs, listing IDs, SKUs, titles, order IDs, buyer data, or raw provider errors",
    "auth, status, sync-control, disconnect, preview, staging, reconciliation, outside-order import, and staged-promotion actions",
  ],
);
assertFileIncludes(
  "seller inventory API seller protection export contract",
  "src/app/api/account/seller/inventory/route.ts",
  [
    "function sellerInventoryHeaders",
    "X-TCOS-Seller-Inventory-Items",
    "X-TCOS-Seller-Inventory-Drafts",
    "X-TCOS-Seller-Inventory-Draft-Ready",
    "X-TCOS-Seller-Inventory-Draft-Needs-Work",
    "X-TCOS-Seller-Inventory-Active",
    "X-TCOS-Seller-Inventory-Archived",
    "X-TCOS-Seller-Inventory-InstaComp-Drafts",
    "X-TCOS-Seller-Inventory-InstaComp-Ready",
    "X-TCOS-Seller-Inventory-Standard-Envelope",
    "X-TCOS-Seller-Inventory-Protection-Opt-In",
    "standardEnvelopeCount",
    "sellerProtectionOptInCount",
    "sellerProtectionProvider",
    "sellerProtectionRate",
    "sellerProtectionMaxCoverage",
    "sellerProtectionCoverageBasis",
    "sellerProtectionRefundRule",
    "sellerProtectionReimbursesShipping",
    "sellerProtectionLegalLabel",
    "sellerProtection.provider",
    "sellerProtection.rate",
    "sellerProtection.maxCoverage",
    "sellerProtection.coverageBasis",
    "sellerProtection.sellerRefundRule",
    "sellerProtection.reimbursesShipping",
    "sellerProtection.legalLabel",
  ],
);
assertFileIncludes(
  "seller inventory response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/inventory",
    "X-TCOS-Seller-Inventory-Items",
    "X-TCOS-Seller-Inventory-Drafts",
    "X-TCOS-Seller-Inventory-Draft-Ready",
    "X-TCOS-Seller-Inventory-Draft-Needs-Work",
    "X-TCOS-Seller-Inventory-Active",
    "X-TCOS-Seller-Inventory-Archived",
    "X-TCOS-Seller-Inventory-InstaComp-Drafts",
    "X-TCOS-Seller-Inventory-InstaComp-Ready",
    "X-TCOS-Seller-Inventory-Standard-Envelope",
    "X-TCOS-Seller-Inventory-Protection-Opt-In",
    "without exposing inventory item IDs, SKUs, titles, image URLs, marketplace IDs, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller protection seller order detail UI visibility contract",
  "src/app/seller/orders/[id]/page.tsx",
  [
    "Under-$20 Seller Protection",
    "2% reserve / $20 max / shipping excluded",
    "sellerProtectionTone",
    "SellerProtectionCard",
  ],
);
assertFileIncludes(
  "seller protection seller payout api visibility contract",
  "src/app/api/account/seller/payout-requests/route.ts",
  [
    "function sellerPayoutRequestHeaders",
    "function sellerPayoutRequestMutationHeaders",
    "X-TCOS-Seller-Payout-Requests",
    "X-TCOS-Seller-Payout-Open-Requests",
    "X-TCOS-Seller-Payout-Blocked-Requests",
    "X-TCOS-Seller-Payout-Eligible-Rows",
    "X-TCOS-Seller-Payout-Pending-Fulfillment",
    "X-TCOS-Seller-Payout-Dispute-Holds",
    "X-TCOS-Seller-Payout-Review-Guard",
    "X-TCOS-Seller-Payout-Protection-Status",
    "X-TCOS-Seller-Payout-Protection-Rows",
    "X-TCOS-Seller-Payout-Request-Mutation",
    "X-TCOS-Seller-Payout-Request-Status",
    "X-TCOS-Seller-Payout-Request-Allocated-Rows",
    "buildUnder20SellerProtectionSellerVisibilitySummary",
    "gross_item_amount,shipping_allocated_amount",
    "metadata",
    "sellerProtection: balance.sellerProtection",
    "sellerProtection: buildUnder20SellerProtectionSellerVisibilitySummary",
  ],
);
assertFileIncludes(
  "seller payout response metadata operator manual contract",
  "docs/TCOS_OPERATOR_MANUAL.md",
  [
    "/api/account/seller/payout-requests",
    "X-TCOS-Seller-Payout-Requests",
    "X-TCOS-Seller-Payout-Open-Requests",
    "X-TCOS-Seller-Payout-Blocked-Requests",
    "X-TCOS-Seller-Payout-Eligible-Rows",
    "X-TCOS-Seller-Payout-Pending-Fulfillment",
    "X-TCOS-Seller-Payout-Dispute-Holds",
    "X-TCOS-Seller-Payout-Review-Guard",
    "X-TCOS-Seller-Payout-Protection-Status",
    "X-TCOS-Seller-Payout-Protection-Rows",
    "X-TCOS-Seller-Payout-Request-Mutation",
    "X-TCOS-Seller-Payout-Request-Status",
    "X-TCOS-Seller-Payout-Request-Allocated-Rows",
    "without exposing payout request IDs, payout references, seller notes, admin notes, ledger IDs, or seller account IDs in headers",
  ],
);
assertFileIncludes(
  "seller protection seller payout UI visibility contract",
  "src/app/seller/payouts/page.tsx",
  [
    "Under-$20 Protection Reserve",
    "Request Protection Snapshot",
    "2% reserve / $20 max / shipping excluded",
    "SellerProtectionCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection account cash-out UI visibility contract",
  "src/app/account/page.tsx",
  [
    "Under-$20 Protection Reserve",
    "Request Protection Snapshot",
    "2% reserve / $20 max / shipping excluded",
    "SellerProtectionCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection command center UI visibility contract",
  "src/app/seller/page.tsx",
  [
    "Protection Reserve",
    "Under-$20 Protection Reserve",
    "2% reserve / $20 max / shipping excluded",
    "SellerProtectionCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection admin payout UI visibility contract",
  "src/app/admin/seller-payouts/page.tsx",
  [
    "Admin Under-$20 Protection Reserve",
    "Protection Reserve",
    "Under-$20 Protection",
    "2% reserve / $20 max / shipping excluded",
    "under20ProtectionFromMetadata",
    "SellerProtectionMiniCard",
    "sellerProtectionTone",
  ],
);
assertFileIncludes(
  "seller protection financial reconciliation visibility contract",
  "src/app/admin/financial-reconciliation/page.tsx",
  [
    "Seller-Protection Reimbursement Adjustments",
    "TCOS Internal Money Context",
    "Latest Run Reimbursed",
    "Latest Run Excluded",
    "tcos_seller_protection_reimbursements",
    "seller_protection_reimbursement",
    "Shipping Excluded",
    "Review Payouts",
    "financial_adjustment_ledger_entries",
  ],
);
assertFileIncludes(
  "seller protection reconciliation summary contract",
  "src/lib/stripe-reconciliation.ts",
  [
    "financial_adjustment_ledger_entries",
    "seller_protection_reimbursement",
    "tcos_seller_protection_reimbursements",
    "tcos_seller_protection_shipping_excluded",
    "tcos_seller_protection_adjustment_count",
    "tcos_seller_protection_allocation_count",
  ],
);
assertFileIncludes(
  "seller protection launch readiness database contract",
  "src/app/admin/launch-readiness/page.tsx",
  [
    "Seller Protection Financial Adjustments",
    "20260712174000_add_seller_protection_financial_adjustments.sql",
    "seller_protection_reimbursement",
    "reimbursement-plan metadata",
    "financial_adjustment_ledger_entries",
  ],
);
assertFileIncludes(
  "seller protection launch readiness brief contract",
  "src/app/api/admin/launch-readiness/route.ts",
  [
    "buildSellerProtectionLaunchContract",
    "sellerProtectionLaunchMarkdownLines",
    "...sellerProtectionLaunchMarkdownLines(brief.sellerProtection)",
    "sellerProtection: buildSellerProtectionLaunchContract(origin)",
  ],
);
assertFileIncludes(
  "seller marketplace receipt handoff launch readiness brief contract",
  "src/app/api/admin/launch-readiness/route.ts",
  [
    "buildSellerMarketplaceReceiptHandoffContract",
    "sellerMarketplaceReceiptHandoffMarkdownLines",
    "...sellerMarketplaceReceiptHandoffMarkdownLines(",
    "brief.sellerMarketplaceReceiptHandoff",
    "sellerMarketplaceReceiptHandoff:",
    "buildSellerMarketplaceReceiptHandoffContract(origin)",
  ],
);
assertFileIncludes(
  "seller protection buyer refund packet contract",
  "src/app/api/admin/shipping-claims/[id]/packet/route.ts",
  [
    "Seller-Protection Buyer Refund Evidence Gate",
    "latest_seller_protection_buyer_refund_evidence",
    "Refund Proof Accepted",
    "Review Note",
  ],
);
assertFileIncludes("queued-feature smoke manifest", "scripts/smoke-production.mjs", [
  "const queuedFeatureCheckNames = [",
  "Queued feature smoke manifest references unknown check(s):",
  "Queued feature smoke manifest contains duplicate check(s):",
  "function smokeFailureDetail",
  "path=${result.path}",
  "status=${result.status}",
  "missingText=${result.missingText || \"none\"}",
  "diagnostic=${result.diagnostic || \"none\"}",
  "snippet=${result.snippet || \"empty response\"}",
  ".map(smokeFailureDetail)",
  '"admin dashboard"',
  '"launch handoff bundle"',
  '"launch readiness page"',
  '"launch readiness json"',
  '"launch readiness markdown"',
  '"launch gate drill page"',
  '"launch gate drill json"',
  '"launch gate drill markdown"',
  '"production smoke report page"',
  '"seller marketplace packet intake"',
  '"seller inventory auth gate"',
  '"seller orders auth gate"',
  '"seller payouts auth gate"',
  '"live payment gate"',
  '"live shipping gate"',
  '"live shipping gate json"',
  '"admin shipping lettertrack controls"',
  '"shipping simulation lab"',
  '"shipping simulation api"',
  '"shipping provider setup json"',
  '"shipping provider setup csv"',
  '"shipping provider env template"',
  '"shipping provider vercel commands"',
  '"shipping provider operator checklist"',
  '"shipping exceptions export"',
  '"lettertrack standard envelope export"',
  "Queued launch feature failure(s):",
]);
assertFileIncludes("smoke unwanted alias label", "scripts/smoke-production.mjs", [
  "unwanted ${new URL(unwantedAliasUrl).hostname} alias absent",
  "SMOKE_UNWANTED_ALIAS_URL",
  "truely-collectables-tt3b.vercel.app",
]);
assertFileIncludes(
  "smoke strict target-origin contract",
  "scripts/smoke-production.mjs",
  [
    'import { isIP } from "node:net"',
    "--self-test-target-origins",
    "Production smoke target-origin self-test passed.",
    "must be a valid DNS hostname or root HTTP(S) URL",
    "must be a root HTTP(S) URL without credentials, port, path, query, or fragment",
    "must be a bare DNS hostname or root HTTP(S) URL",
    "must resolve to a valid DNS hostname with at least two labels",
    "hasExplicitPort",
    '"https://launch.example.com:443/"',
    '"http://launch.example.com:80/"',
    'message.includes("smoke-secret")',
    "--self-test-timeout-config",
    "Production smoke timeout config self-test passed.",
    "SMOKE_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000.",
    "Number.isSafeInteger",
    "maxTimeoutMs = 120_000",
  ],
);
runExpectedSuccess(
  "smoke diagnostic redaction self-test",
  ["scripts/smoke-production.mjs", "--self-test-redaction"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "https://truely-collectables.vercel.app",
  },
);
runExpectedSuccess("deploy diagnostic redaction self-test", [
  "scripts/deploy-production.mjs",
  "--self-test-redaction",
]);
assertFileIncludes("production guardrail diagnostic redaction coverage", "scripts/check-production-guardrails.mjs", [
  "function redactSecrets(text)",
  "function diagnosticOutput(text)",
  "function runGuardrailRedactionSelfTest()",
  "Production guardrail redaction self-test leaked marker(s)",
  "PASS production guardrail redaction self-test",
  "rk_live_fakeRestricted123456789",
  "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
  "client_secret=clientSecret123456789",
  "api_key=apiKey123456789",
  '"password":"password123456789"',
  "diagnosticOutput(output)",
]);
assertFileIncludes("smoke diagnostic redaction coverage", "scripts/smoke-production.mjs", [
  "rk_live_fakeRestricted123456789",
  "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
  "client_secret=clientSecret123456789",
  "api_key=apiKey123456789",
  '"password":"password123456789"',
  "rk_live_",
  "Basic ",
  "clientSecret123456789",
  "apiKey123456789",
  "password123456789",
]);
assertFileIncludes("deploy diagnostic redaction coverage", "scripts/deploy-production.mjs", [
  "function redactSecrets(text)",
  "function diagnosticSnippet(text)",
  "Production deploy redaction self-test passed.",
  "rk_live_fakeRestricted123456789",
  "Basic QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Ng==",
  "client_secret=clientSecret123456789",
  "api_key=apiKey123456789",
  '"password":"password123456789"',
  "redactSecrets(output)",
  "diagnosticSnippet(output)",
  "diagnosticSnippet(deployOutput)",
]);

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
  "vercelCliPreflight();",
  "Vercel CLI preflight: command-pinned ${vercelCliVersion} via isolated npm exec",
  '"--prefix"',
  "vercelCliCacheDir",
  '"--cwd"',
  "process.cwd()",
  "Check npm registry access before production preflight. No Vercel upload was started.",
  "Production deploy preflight passed. No Vercel deployment was started.",
]);

assertFileOrder("normal deploy early quota stop", "scripts/deploy-production.mjs", [
  "if (!preflightOnly)",
  "assertNoRecentQuotaBlock();",
  "vercelCliPreflight();",
  "gitPreflight();",
  "if (preflightOnly)",
  "Production deploy preflight passed. No Vercel deployment was started.",
  "Deploying production with Vercel scope ${scope}",
]);

assertFileIncludes("deploy git preflight diagnostics", "scripts/deploy-production.mjs", [
  "Refreshing origin/main before deploy",
  "working tree has deploy-relevant local changes",
  "Production deploy requires a clean committed worktree",
  "Could not resolve local HEAD and origin/main after fetch",
  "Local HEAD does not match origin/main",
  "Run git push before deploying",
]);

assertFileIncludes("deploy live safety contract", "scripts/deploy-production.mjs", [
  "api-deployments-free-per-day",
  "Wait for the rolling 24-hour quota to reset",
  ".codex-run/vercel-quota-block.json",
  "No Vercel upload was started",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  "Removing unwanted ${unwantedAlias} alias if present",
  '"alias", "rm", unwantedAlias',
  "assertUnwantedAliasRemovalResult(aliasRemovalResult)",
  "Only Vercel CLI's explicit alias-not-found result is safe to continue past",
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
  "normalizeVercelHost",
  "valid DNS hostname or root HTTP(S) URL",
  "root HTTP(S) URL without credentials, port, path, query, or fragment",
  "valid DNS hostname with at least two labels",
  "isIP(hostname) !== 0",
  "hasExplicitPort",
  '"https://launch.example.com:443/"',
  '"http://launch.example.com:80/"',
]);

assertFileIncludes("deploy helper quota block defaults", "scripts/deploy-production.mjs", [
  "deployOutput.includes(\"api-deployments-free-per-day\")",
  "recordQuotaBlock();",
  "Vercel deployment quota is still capped",
  "A local cooldown marker was written",
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
  "const deployResult = run",
  "const deployOutput = deployResult.output",
  "deployOutput.includes(\"api-deployments-free-per-day\")",
  "assertSuccessfulDeployResult(deployResult)",
  "const deploymentUrl = parseDeploymentUrl(deployOutput)",
  "if (!deploymentUrl)",
  "Removing unwanted ${unwantedAlias} alias if present",
  '"alias", "rm", unwantedAlias',
  "const aliasRemovalState = assertUnwantedAliasRemovalResult(aliasRemovalResult)",
  "Confirmed unwanted alias ${unwantedAlias} was removed.",
  "Confirmed unwanted alias ${unwantedAlias} was already absent.",
  "Pointing https://${cleanDomain} at ${deploymentUrl}",
  '"alias", "set", deploymentUrl, cleanDomain',
  "Production deployment URL and clean alias succeeded; clearing local quota marker.",
  "removeQuotaBlockMarker();",
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
  "function deploySafetyDecisionLadderMarkdown()",
  "sequence: [",
  "decisionLadder: [",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "quotaCooldownMarkerPath",
  ".codex-run/vercel-quota-block.json",
  "quotaRetryOverrideEnv",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "quotaRetryOverrideFlag",
  "--force-quota-retry",
  "quotaUploadWarning",
  "vercelCliRequirement",
  "scopeRequirement",
  "unwantedAliasCleanupRequirement",
  "targetHostRequirement",
  "smokeTargetRequirement",
  "quotaEarlyStopRequirement",
  "local Vercel quota cooldown marker",
  "Ship only after smoke passes clean production",
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
  "deploySafetyDecisionLadderMarkdown",
  "deploySafetySequenceMarkdown",
  "function buildDeploymentSource",
  "function deploymentSourceMarkdownLines",
  "VERCEL_GIT_COMMIT_SHA",
  "VERCEL_GIT_COMMIT_REF",
  "VERCEL_GIT_REPO_OWNER",
  "VERCEL_GIT_REPO_SLUG",
  "VERCEL_URL",
  "Compare this Git commit SHA with origin/main",
  "function deploySafetyMarkdownLines()",
  "...deploySafetyMarkdownLines()",
  "...deploymentSourceMarkdownLines(brief.deployment)",
  "deploySafetyContractMarkdown()} intact.",
  "DEPLOY_SAFETY.scopeRequirement",
  "## Production Go/No-Go Ladder",
  "deploySafetyDecisionLadderMarkdown()",
  "deployment: buildDeploymentSource(origin)",
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
    'quotaCooldownMarkerPath: ".codex-run/vercel-quota-block.json"',
    'quotaRetryOverrideEnv: "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true"',
    'quotaRetryOverrideFlag: "--force-quota-retry"',
    "quotaUploadWarning:",
    "Vercel can still upload files before returning the quota error",
    "quotaMarkerClearCondition:",
    "Clear the local quota marker only after Vercel returns a parsed deployment URL and the clean production alias succeeds.",
    "success-only quota marker clearing",
    "clear local quota marker after clean alias succeeds",
    "deployResultRequirement:",
    "Require vercel --prod to exit successfully before parsing its deployment URL, running alias commands, or clearing the quota marker.",
    "successful Vercel deploy exit before URL and alias handling",
    "vercelCliRequirement:",
    "Use command-pinned Vercel CLI 56.2.0 through isolated npm exec and fail production preflight before upload when the exact CLI cannot run.",
    "unwantedAliasCleanupRequirement:",
    "Require unwanted-alias removal to succeed or return Vercel CLI's explicit alias-not-found result before clean-domain aliasing or quota-marker clearing.",
  "command-pinned Vercel CLI preflight",
  "strict Vercel scope validation",
  "fail-closed unwanted-alias cleanup",
  "scopeRequirement:",
  "Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug before quota status, preflight, Git fetch, or Vercel CLI work.",
  "targetHostRequirement:",
    "Accept production target overrides only as valid DNS hostnames or root HTTP(S) URLs without credentials, ports, paths, queries, fragments, IP addresses, or single-label names.",
    "smokeTargetRequirement:",
    "Accept production smoke targets only as valid DNS hostnames or root HTTP(S) URLs without credentials, ports, paths, queries, fragments, IP addresses, or single-label names.",
    "quotaEarlyStopRequirement:",
    "On normal deploys, enforce the local quota cooldown before npm exec, Git fetch, build, upload, or deployment; preflight-only remains quota-independent.",
    "strict production target-host validation",
    "strict production smoke-target validation",
    "pre-CLI normal-deploy quota stop",
  ],
);

assertFileIncludes("deploy live safety handoff bundle", "src/app/api/admin/launch-readiness/route.ts", [
  "deploy live safety contract",
  "Deployment Source",
  "Git commit SHA:",
  "Smoke comparison:",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.quotaUploadWarning",
  "DEPLOY_SAFETY.quotaCooldownMarkerPath",
  "DEPLOY_SAFETY.quotaRetryOverrideEnv",
  "DEPLOY_SAFETY.quotaRetryOverrideFlag",
  "DEPLOY_SAFETY.scopeRequirement",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "DEPLOY_SAFETY.smokeCommand",
  "standardEnvelopeEvidenceContractReady",
  "providerSetupActionPlan",
  "Shipping Provider Unlock Action Plan",
  "sellerMarketplaceReceiptHandoffMarkdownLines",
  "brief.sellerMarketplaceReceiptHandoff",
  "Standard Envelope evidence validator:",
  "InstaComp regressions",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "twenty-scenario shipping simulation suite",
  "deploySafetyContractMarkdown()",
  "Protected deploy sequence:",
  "deploySafetySequenceMarkdown()",
]);

assertFileIncludes("deploy live safety launch readiness markdown", "src/app/api/admin/launch-readiness/route.ts", [
  "DEPLOY_SAFETY.section",
  "deploy live safety contract",
  "Deployment Source",
  "Git commit SHA:",
  "Smoke comparison:",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.quotaUploadWarning",
  "DEPLOY_SAFETY.quotaCooldownMarkerPath",
  "DEPLOY_SAFETY.quotaRetryOverrideEnv",
  "DEPLOY_SAFETY.quotaRetryOverrideFlag",
  "DEPLOY_SAFETY.scopeRequirement",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "standardEnvelopeEvidenceContractReady",
  "Standard Envelope evidence validator:",
  "InstaComp regressions",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "twenty-scenario shipping simulation suite",
  "deploySafetyContractMarkdown()",
  "Protected deploy sequence:",
  "deploySafetySequenceMarkdown()",
]);

assertFileIncludes("deploy live safety shared text source", "src/lib/deploy-safety.ts", [
  "api-deployments-free-per-day",
  "rolling 24-hour quota reset",
  ".codex-run/vercel-quota-block.json",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  "Vercel can still upload files before returning the quota error",
  "Vercel quota messaging",
  "local Vercel quota cooldown marker",
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
  "quotaCooldownMarkerPath",
  ".codex-run/vercel-quota-block.json",
  "quotaRetryOverrideEnv",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "quotaRetryOverrideFlag",
  "--force-quota-retry",
  "quotaUploadWarning",
  "scopeRequirement",
  "Accept VERCEL_SCOPE only as a simple lowercase Vercel team slug",
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
  "Production go/no-go ladder",
  "DEPLOY_SAFETY.decisionLadder",
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "${DEPLOY_SAFETY.unwantedAlias} alias cleanup",
  "DEPLOY_SAFETY.smokeCommand",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.quotaUploadWarning",
  "DEPLOY_SAFETY.quotaCooldownMarkerPath",
  "DEPLOY_SAFETY.quotaRetryOverrideEnv",
  "DEPLOY_SAFETY.quotaRetryOverrideFlag",
  "DEPLOY_SAFETY.scopeRequirement",
  "unwanted alias removal for",
  "clean-domain aliasing",
  "Protected deploy sequence",
  "manualVerificationChecks",
  "Post-smoke manual verification checklist",
  "Proof to capture:",
  "If blocked:",
  "Git tip and clean domain",
  "Launch gate drill evidence",
  "Live money runway proof",
  "Live money JSON evidence",
  "npm --silent run status:live-money:json",
  "npm --silent run preflight:live-money:json",
  "tcos.liveMoneyGoNoGo.v1",
  "READY_FOR_RUNTIME_SWITCH",
  "approval-blocker count",
  "launch-lock count",
  "next live-money actions",
  "Live shipping lock posture",
  "Seller protection money trail",
  "Shipping operations exports",
  "Seller marketplace receipt handoff",
  "DEPLOY_SAFETY.sequence",
  "buildSellerMarketplaceReceiptHandoffContract",
  "sellerMarketplaceReceiptHandoff",
  "sellerMarketplaceReceiptHandoffControlsText",
  "sellerMarketplaceReceiptHandoff.controlsSentence",
  "sellerMarketplaceReceiptHandoff.proofText",
  "sellerMarketplaceReceiptHandoff.safeUseBoundary",
  "sellerMarketplaceReceiptHandoff.operations.join",
  "/api/admin/shipping/provider-setup",
  "/api/admin/shipping/provider-setup?format=csv",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
  "deployed URL output",
  "clean URL output",
]);

assertFileIncludes("deploy live safety launch readiness page", "src/app/admin/launch-readiness/page.tsx", [
  "DEPLOY_SAFETY.quotaBlockCode",
  "DEPLOY_SAFETY.cleanProductionDomain",
  "DEPLOY_SAFETY.unwantedAlias",
  "DEPLOY_SAFETY.smokeCommand",
  "DEPLOY_SAFETY.quotaResetInstruction",
  "DEPLOY_SAFETY.quotaUploadWarning",
  "DEPLOY_SAFETY.quotaCooldownMarkerPath",
  "DEPLOY_SAFETY.quotaRetryOverrideEnv",
  "DEPLOY_SAFETY.quotaRetryOverrideFlag",
  "DEPLOY_SAFETY.scopeRequirement",
  "deploy live safety",
  "contract keeps",
  "Vercel quota",
  "Standard Envelope evidence validator is",
  "InstaComp regressions",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "twenty-scenario shipping simulation suite",
  "unwanted alias removal for",
  "clean-domain aliasing",
  "Protected deploy sequence",
  "DEPLOY_SAFETY.sequence",
  "deployed URL output",
  "clean URL output",
  "ProviderSetupActionPlanStep",
  "Shipping Provider Unlock Action Plan",
  "actionPlan.map",
  "/api/admin/shipping/provider-setup?format=env-template",
  "/api/admin/shipping/provider-setup?format=vercel-commands",
  "/api/admin/shipping/provider-setup?format=operator-checklist",
]);

assertFileIncludes("deploy live safety runbook", "docs/PRODUCTION_DEPLOY_RUNBOOK.md", [
  "live deploy safety contract",
  "/api/admin/launch-readiness",
  "brief.deploySafety",
  "brief.deploySafety` with the clean production domain, unwanted `truely-collectables-tt3b.vercel.app` alias",
  "brief.deploySafety.sequence",
  "brief.sellerMarketplaceReceiptHandoff",
  "Seller Connections proof route",
  "required receipt controls",
  "safe-use boundary",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Production go/no-go ladder",
  "Verify the pushed stack",
  "Launch only when quota is open",
  "Halt on Vercel quota",
  "Ship only after smoke passes",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "twenty-scenario shipping simulation suite",
  "five expected purchase-audit scenarios",
  "shipping simulation API POST including purchase-audit coverage",
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
  "local quota cooldown marker path",
  "simple Vercel team slug",
  "intentional retry override env/flag",
  "local cooldown marker",
  "retry override",
  "Do not rapid-fire retries while capped",
  "Vercel can still accept the upload stream before returning the quota error",
  "smoke/deploy/guardrail diagnostic redaction self-tests",
  "Queued launch feature failure(s):",
  "failed check name, path, HTTP status, missing required text, diagnostic, and redacted snippet",
  "admin dashboard, launch readiness page/JSON/Markdown, Launch Gate Drill page/JSON/Markdown",
  "live payment gate, live shipping gate, admin shipping LetterTrack controls",
]);

assertFileIncludes("deploy live safety README", "README.md", [
  "deploy live safety contract",
  "/api/admin/launch-readiness",
  "brief.deploySafety",
  "brief.deploySafety.sequence",
  "brief.sellerMarketplaceReceiptHandoff",
  "Seller Connections proof route",
  "required receipt controls",
  "safe-use boundary",
  "/api/admin/launch-readiness?format=markdown",
  "/api/admin/launch-readiness?format=handoff-bundle",
  "Production Deploy Safety",
  "Seller Marketplace Receipt Handoff",
  "production go/no-go ladder",
  "verify the pushed stack",
  "launch only when quota is open",
  "halt if Vercel reports `api-deployments-free-per-day`",
  "let `.codex-run/vercel-quota-block.json` stop later attempts before upload",
  "ship only after smoke passes the clean production domain",
  "local quota cooldown marker path",
  "simple Vercel team slug",
  "intentional retry override env/flag",
  "LetterTrack evidence checks",
  "shipping purchase-attempt audit simulations",
  "twenty-scenario shipping simulation suite",
  "visible missing/unexpected purchase-audit key drift checks",
  "guardrails for no external publishing, no postage purchase, no Coverage policy creation, no payout release, no order fulfillment, and no automatic under-$20 protection activation",
  "That command is deploy-safe and focused: it runs only the InstaComp queue and accuracy simulations",
  "Use `npm run verify:production` for the full lint, shipping, build, guardrail, and GitHub preflight stack.",
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
  "repeated retries can still upload files before Vercel returns the quota error",
  ".codex-run/vercel-quota-block.json",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  "Production smoke and deploy/guardrail diagnostics redact secret-shaped Stripe",
  "auth-header, token, API-key, password, and JWT values",
]);

assertFileIncludes("operator manual PDF generator portability guardrail", "scripts/build-manual-pdf.mjs", [
  "pathToFileURL",
  "TCOS_MANUAL_BROWSER_PATH",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "TCOS_MANUAL_PDF_BROWSER_TIMEOUT_MS",
  "timeout: browserTimeoutMs",
  "pdfWasRefreshed",
  "Manual PDF written:",
]);

assertFileIncludes("operator manual PDF generator instructions", "docs/TCOS_OPERATOR_MANUAL.md", [
  "The manual PDF generator looks for local Chrome, Edge, Chromium, and Brave binaries on macOS, Linux, and Windows.",
  "TCOS_MANUAL_BROWSER_PATH",
  "TCOS_MANUAL_PDF_BROWSER_TIMEOUT_MS",
  "the generator treats a freshly written PDF as success and exits cleanly",
  "the generator verifies the PDF timestamp and size before accepting that timeout as success",
]);

assertFileIncludes("chat handoff current launch stack", "CHAT_HANDOFF.md", [
  "/Users/davidbakanas/Documents/GitHub/truely-collectables",
  "Treat those commands as the source of truth for the current Git tip.",
  "This handoff may be followed by handoff-only commits that do not change the deploy sequence.",
  "44a49a4 Harden operator manual PDF generation",
  "38a752d Refresh launch handoff state",
  "cc36a5b Harden marketplace packet intake guardrails",
  "2400ce8 Guard README launch contract wording",
  "api-deployments-free-per-day",
  "npm run verify:production",
  "npm run launch:production",
  "no payout release",
  "no order fulfillment",
  "no automatic under-$20 protection activation",
  "TCOS_MANUAL_BROWSER_PATH",
  "TCOS_MANUAL_PDF_BROWSER_TIMEOUT_MS",
  "That recurring stale-PDF issue is fixed and guarded.",
]);

assertFileIncludes("deploy live safety operator manual", "docs/TCOS_OPERATOR_MANUAL.md", [
  "live deploy safety contract",
  "/admin/production-smoke",
  "deploy-live safety contract",
  "brief.deploySafety",
  "brief.deploySafety.sequence",
  "/api/admin/launch-readiness?format=markdown",
  "Production Deploy Safety",
  "Production Go/No-Go Ladder",
  "verify the pushed stack",
  "launch only when quota is open",
  "halt if Vercel reports",
  "avoid rapid-fire deploy retries because Vercel can still upload files before returning the quota error",
  "let the deploy helper's `.codex-run/vercel-quota-block.json` cooldown marker stop later attempts before upload",
  "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
  "--force-quota-retry",
  "ship only after smoke passes the clean production domain",
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
  "smoke/deploy/guardrail diagnostic redaction self-tests",
  "the seller marketplace packet intake route, and the seller inventory/order/payout auth gates",
  "launch readiness, Launch Gate Drill, production smoke, live payment/shipping gates",
  "admin dashboard, launch readiness page/JSON/Markdown, Launch Gate Drill page/JSON/Markdown",
  "live payment gate, live shipping gate, admin shipping LetterTrack controls",
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
    "Production Go/No-Go Ladder",
    "verify the pushed stack",
    "launch only when quota is open",
    "halt if Vercel reports",
    "avoid rapid-fire deploy retries because Vercel can still upload files before returning the quota error",
    "let the deploy helper's <code>.codex-run/vercel-quota-block.json</code> cooldown marker stop later attempts before upload",
    "TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true",
    "--force-quota-retry",
    "ship only after smoke passes the clean production domain",
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
    "the seller marketplace packet intake route, and the seller inventory/order/payout auth gates",
  ],
);

runExpectedFailure(
  "smoke refuses unwanted alias before admin auth",
  ["scripts/smoke-production.mjs"],
  {
    ADMIN_PASSWORD: "",
    SMOKE_ADMIN_PASSWORD: "",
    SMOKE_BASE_URL: "TRUELY-COLLECTABLES-TT3B.vercel.app",
    SMOKE_UNWANTED_ALIAS_URL: "https://truely-collectables-tt3b.vercel.app/",
  },
  "Refusing to smoke test the unwanted production alias",
);

console.log("Production guardrail checks passed.");
