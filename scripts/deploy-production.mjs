import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
const quotaStatusOnly =
  process.argv.includes("--quota-status") ||
  process.env.TCOS_PRODUCTION_QUOTA_STATUS_ONLY === "true";
const redactionSelfTest = process.argv.includes("--self-test-redaction");
const quotaCooldownSelfTest = process.argv.includes("--self-test-quota-cooldown");
const quotaRetryOverride =
  process.argv.includes("--force-quota-retry") ||
  process.env.TCOS_VERCEL_QUOTA_RETRY_OVERRIDE === "true";
const quotaCooldownHours = Number(
  process.env.TCOS_VERCEL_QUOTA_COOLDOWN_HOURS || "24",
);
const defaultQuotaBlockMarkerPath = path.resolve(
  process.cwd(),
  ".codex-run/vercel-quota-block.json",
);
const quotaBlockMarkerPath = path.resolve(
  process.cwd(),
  process.env.TCOS_VERCEL_QUOTA_MARKER_PATH ||
    ".codex-run/vercel-quota-block.json",
);

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

function readQuotaBlockMarker() {
  try {
    return JSON.parse(fs.readFileSync(quotaBlockMarkerPath, "utf8"));
  } catch {
    return fs.existsSync(quotaBlockMarkerPath)
      ? { invalidMarker: true }
      : null;
  }
}

function removeQuotaBlockMarker() {
  try {
    fs.rmSync(quotaBlockMarkerPath, { force: true });
  } catch {
    // Best-effort scratch cleanup only.
  }
}

function recordQuotaBlock() {
  fs.mkdirSync(path.dirname(quotaBlockMarkerPath), { recursive: true });
  fs.writeFileSync(
    quotaBlockMarkerPath,
    `${JSON.stringify(
      {
        blockedAt: new Date().toISOString(),
        scope,
        cleanDomain,
        reason: "api-deployments-free-per-day",
        next: "Wait for the rolling 24-hour quota reset before retrying npm run launch:production.",
      },
      null,
      2,
    )}\n`,
  );
}

function formatCooldownRemaining(remainingMs) {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function getQuotaCooldownStatus(nowMs = Date.now()) {
  if (quotaRetryOverride) {
    return {
      state: "override",
      canRetry: true,
      reason: "intentional retry override",
      blockedAt: null,
      retryAt: null,
      remaining: null,
    };
  }

  if (!Number.isFinite(quotaCooldownHours) || quotaCooldownHours <= 0) {
    return {
      state: "invalid_configuration",
      canRetry: false,
      reason: "TCOS_VERCEL_QUOTA_COOLDOWN_HOURS must be a positive number",
      blockedAt: null,
      retryAt: null,
      remaining: null,
    };
  }

  const marker = readQuotaBlockMarker();
  const blockedAt =
    marker && typeof marker.blockedAt === "string"
      ? Date.parse(marker.blockedAt)
      : NaN;

  if (!Number.isFinite(blockedAt)) {
    return {
      state: marker ? "invalid_marker" : "open",
      canRetry: !marker,
      reason: marker ? "quota marker has no valid blockedAt timestamp" : "no quota marker",
      blockedAt: null,
      retryAt: null,
      remaining: null,
    };
  }

  const cooldownMs = quotaCooldownHours * 60 * 60 * 1000;
  const retryAt = blockedAt + cooldownMs;
  const remainingMs = retryAt - nowMs;

  return {
    state: remainingMs > 0 ? "blocked" : "expired",
    canRetry: remainingMs <= 0,
    reason: marker.reason || "quota",
    blockedAt: new Date(blockedAt).toISOString(),
    retryAt: new Date(retryAt).toISOString(),
    remaining: remainingMs > 0 ? formatCooldownRemaining(remainingMs) : null,
  };
}

function printQuotaCooldownStatus() {
  const status = getQuotaCooldownStatus();

  console.log("Production deploy quota status:");
  console.log(`- state: ${status.state}`);
  console.log(`- deployment retry allowed by local cooldown: ${status.canRetry ? "yes" : "no"}`);
  console.log(`- reason: ${status.reason}`);
  if (status.blockedAt) console.log(`- blocked at: ${status.blockedAt}`);
  if (status.retryAt) console.log(`- retry at or after: ${status.retryAt}`);
  if (status.remaining) console.log(`- approximate remaining: ${status.remaining}`);
  console.log(`- marker: ${quotaBlockMarkerPath}`);
  console.log("- Vercel upload started: no");
  console.log(
    status.state === "invalid_configuration"
      ? "- next: set TCOS_VERCEL_QUOTA_COOLDOWN_HOURS to a positive number; do not deploy unless the quota reset is independently confirmed"
      : status.state === "invalid_marker"
        ? "- next: inspect or restore the quota marker; do not deploy unless the quota reset is independently confirmed"
        : status.canRetry
          ? "- next: run npm run launch:production after normal verification"
          : "- next: keep building locally and rerun npm run status:production after the retry time",
  );
}

function assertNoRecentQuotaBlock() {
  const status = getQuotaCooldownStatus();

  if (status.state === "override") {
    console.log(
      "Bypassing local Vercel quota cooldown because TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true or --force-quota-retry was provided.",
    );
    return;
  }

  if (status.state === "invalid_configuration") {
    throw new Error(
      `Invalid TCOS_VERCEL_QUOTA_COOLDOWN_HOURS value. The cooldown must be a positive number. No Vercel upload was started. Correct the value, or use TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true / --force-quota-retry only after independently confirming the quota reset.`,
    );
  }

  if (status.state === "expired") {
    console.log("Local Vercel quota cooldown marker has expired; retrying deploy.");
    return;
  }

  if (status.state === "invalid_marker") {
    throw new Error(
      `Local Vercel quota marker is invalid at ${quotaBlockMarkerPath}. No Vercel upload was started. Inspect or restore the marker, or use TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true / --force-quota-retry only after independently confirming the quota reset.`,
    );
  }

  if (status.canRetry) return;

  throw new Error(
    `Recent Vercel deployment quota block recorded at ${status.blockedAt} (${status.reason}). No Vercel upload was started. Retry at or after ${status.retryAt} (about ${status.remaining}), or set TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true / pass --force-quota-retry if you intentionally want to retry sooner.`,
  );
}

function runQuotaCooldownSelfTest() {
  if (quotaBlockMarkerPath === defaultQuotaBlockMarkerPath) {
    throw new Error(
      "Refusing quota cooldown self-test against the production marker path. Set TCOS_VERCEL_QUOTA_MARKER_PATH to an explicit temporary test file.",
    );
  }

  if (!Number.isFinite(quotaCooldownHours) || quotaCooldownHours <= 0) {
    const invalidConfigurationStatus = getQuotaCooldownStatus();
    if (
      invalidConfigurationStatus.state !== "invalid_configuration" ||
      invalidConfigurationStatus.canRetry
    ) {
      throw new Error(
        `Quota cooldown self-test failed open for invalid configuration: ${JSON.stringify(invalidConfigurationStatus)}`,
      );
    }

    try {
      assertNoRecentQuotaBlock();
      throw new Error(
        "Quota cooldown self-test did not block invalid configuration.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (
        !message.includes("Invalid TCOS_VERCEL_QUOTA_COOLDOWN_HOURS value") ||
        !message.includes("No Vercel upload was started")
      ) {
        throw error;
      }
    }

    console.log(
      "Production deploy quota cooldown invalid-configuration self-test passed.",
    );
    return;
  }

  removeQuotaBlockMarker();
  fs.mkdirSync(path.dirname(quotaBlockMarkerPath), { recursive: true });
  fs.writeFileSync(quotaBlockMarkerPath, "{invalid-json\n");

  const invalidStatus = getQuotaCooldownStatus();
  if (invalidStatus.state !== "invalid_marker" || invalidStatus.canRetry) {
    throw new Error(
      `Quota cooldown self-test failed open for an invalid marker: ${JSON.stringify(invalidStatus)}`,
    );
  }

  try {
    assertNoRecentQuotaBlock();
    throw new Error("Quota cooldown self-test did not block an invalid marker.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("Local Vercel quota marker is invalid") ||
      !message.includes("No Vercel upload was started")
    ) {
      throw error;
    }
  }

  fs.writeFileSync(
    quotaBlockMarkerPath,
    `${JSON.stringify({
      blockedAt: new Date().toISOString(),
      reason: "api-deployments-free-per-day",
    })}\n`,
  );

  const activeStatus = getQuotaCooldownStatus();
  if (
    activeStatus.state !== "blocked" ||
    activeStatus.canRetry ||
    !activeStatus.retryAt ||
    !activeStatus.remaining
  ) {
    throw new Error(
      `Quota cooldown self-test returned invalid active status: ${JSON.stringify(activeStatus)}`,
    );
  }

  try {
    assertNoRecentQuotaBlock();
    throw new Error("Quota cooldown self-test did not block a recent marker.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      !message.includes("No Vercel upload was started") ||
      !message.includes("TCOS_VERCEL_QUOTA_RETRY_OVERRIDE=true")
    ) {
      throw error;
    }
  }

  fs.writeFileSync(
    quotaBlockMarkerPath,
    `${JSON.stringify({
      blockedAt: new Date(Date.now() - (quotaCooldownHours + 1) * 60 * 60 * 1000).toISOString(),
      reason: "api-deployments-free-per-day",
    })}\n`,
  );
  const expiredStatus = getQuotaCooldownStatus();
  if (expiredStatus.state !== "expired" || !expiredStatus.canRetry) {
    throw new Error(
      `Quota cooldown self-test returned invalid expired status: ${JSON.stringify(expiredStatus)}`,
    );
  }
  assertNoRecentQuotaBlock();
  removeQuotaBlockMarker();
  console.log("Production deploy quota cooldown self-test passed.");
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

if (quotaCooldownSelfTest) {
  runQuotaCooldownSelfTest();
  process.exit(0);
}

if (quotaStatusOnly) {
  printQuotaCooldownStatus();
  process.exit(0);
}

gitPreflight();

if (preflightOnly) {
  console.log("Production deploy preflight passed. No Vercel deployment was started.");
  process.exit(0);
}

assertNoRecentQuotaBlock();

console.log(`Deploying production with Vercel scope ${scope}...`);

const deployOutput = run("vercel", ["--prod", "--yes", "--scope", scope], {
  allowFailure: true,
});

if (deployOutput.includes("api-deployments-free-per-day")) {
  recordQuotaBlock();
  throw new Error(
    "Vercel deployment quota is still capped (api-deployments-free-per-day). A local cooldown marker was written so the next deploy attempt can stop before uploading. Wait for the rolling 24-hour quota to reset, then rerun npm run launch:production.",
  );
}

const deploymentUrl = parseDeploymentUrl(deployOutput);

removeQuotaBlockMarker();

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
