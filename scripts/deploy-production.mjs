import { spawnSync } from "node:child_process";

const scope = process.env.VERCEL_SCOPE || "truelycollectables-projects";
const cleanDomain =
  normalizeVercelHost(
    process.env.VERCEL_CLEAN_DOMAIN || "truely-collectables.vercel.app",
    "VERCEL_CLEAN_DOMAIN",
  );
const unwantedAlias =
  normalizeVercelHost(
    process.env.VERCEL_UNWANTED_ALIAS || "truely-collectables-tt3b.vercel.app",
    "VERCEL_UNWANTED_ALIAS",
  );
const preflightOnly =
  process.argv.includes("--preflight-only") ||
  process.env.TCOS_PRODUCTION_PREFLIGHT_ONLY === "true";
const redactionSelfTest = process.argv.includes("--self-test-redaction");

function normalizeVercelHost(value, label) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`);
  }

  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  }
}

if (cleanDomain === unwantedAlias) {
  throw new Error(
    `Refusing production deploy because VERCEL_CLEAN_DOMAIN matches the unwanted alias: ${cleanDomain}`,
  );
}

function optionalRun(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) return "";

  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

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

function diagnosticSnippet(text) {
  return redactSecrets(text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function runRedactionSelfTest() {
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
  const snippet = diagnosticSnippet(sample);
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
      `Production deploy redaction self-test leaked marker(s): ${leakedMarkers.join(", ")}`,
    );
  }

  console.log("Production deploy redaction self-test passed.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    ...options,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  if (options.print !== false) {
    process.stdout.write(redactSecrets(output));
  }

  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit ${result.status}.\n${diagnosticSnippet(output)}`,
    );
  }

  return output;
}

function deployRelevantStatus(status) {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const path = line.slice(3).replaceAll("\\", "/");

      return path !== ".codex-run/" && !path.startsWith(".codex-run/");
    })
    .join("\n");
}

function parseDeploymentUrl(output) {
  const urls = output.match(/https:\/\/[^\s"'<>]+\.vercel\.app\b/g) || [];
  const blockedHosts = new Set([cleanDomain, unwantedAlias]);

  return urls.find((url) => {
    try {
      return !blockedHosts.has(new URL(url).host);
    } catch {
      return false;
    }
  });
}

function gitPreflight() {
  console.log("Refreshing origin/main before deploy...");
  run("git", ["fetch", "origin", "main"]);

  const status = optionalRun("git", ["status", "--short"]);
  const deployStatus = deployRelevantStatus(status);
  const localHead = optionalRun("git", ["rev-parse", "HEAD"]);
  const remoteHead = optionalRun("git", ["rev-parse", "origin/main"]);

  console.log("Git preflight:");
  console.log(`- local HEAD: ${localHead || "unknown"}`);
  console.log(`- origin/main: ${remoteHead || "unknown"}`);

  if (deployStatus) {
    console.log("- working tree has deploy-relevant local changes:");
    console.log(deployStatus);
    throw new Error(
      "Production deploy requires a clean committed worktree. Commit and push local changes before deploying.",
    );
  } else if (status) {
    console.log("- working tree is clean for deploy; ignored scratch changes:");
    console.log(status);
  } else {
    console.log("- working tree is clean");
  }

  if (!localHead || !remoteHead) {
    throw new Error(
      "Could not resolve local HEAD and origin/main after fetch. Check Git remote access before deploying.",
    );
  }

  if (localHead && remoteHead && localHead !== remoteHead) {
    throw new Error(
      "Local HEAD does not match origin/main. Run git push before deploying.",
    );
  }
}

if (redactionSelfTest) {
  runRedactionSelfTest();
  process.exit(0);
}

gitPreflight();

if (preflightOnly) {
  console.log("Production deploy preflight passed. No Vercel deployment was started.");
  process.exit(0);
}

console.log(`Deploying production with Vercel scope ${scope}...`);

const deployOutput = run("vercel", ["--prod", "--yes", "--scope", scope], {
  allowFailure: true,
});

if (deployOutput.includes("api-deployments-free-per-day")) {
  throw new Error(
    "Vercel deployment quota is still capped (api-deployments-free-per-day). Wait for the rolling 24-hour quota to reset, then rerun npm run launch:production.",
  );
}

const deploymentUrl = parseDeploymentUrl(deployOutput);

if (!deploymentUrl) {
  throw new Error(
    `Could not parse a Vercel deployment URL that is not the clean production domain (${cleanDomain}) or unwanted alias (${unwantedAlias}). If quota is capped, wait and retry.\n${diagnosticSnippet(deployOutput)}`,
  );
}

console.log(`Parsed deployment URL: ${deploymentUrl}`);
console.log(`Removing unwanted ${unwantedAlias} alias if present`);
run(
  "vercel",
  ["alias", "rm", unwantedAlias, "--yes", "--scope", scope],
  { allowFailure: true },
);

console.log(`Pointing https://${cleanDomain} at ${deploymentUrl}`);
run("vercel", ["alias", "set", deploymentUrl, cleanDomain, "--scope", scope]);

console.log("");
console.log(`DEPLOYED_PRODUCTION=${deploymentUrl}`);
console.log(`CLEAN_PRODUCTION=https://${cleanDomain}`);
console.log("");
console.log("Next verification command if you ran deploy without the one-shot launch:");
console.log("npm run smoke:production");
