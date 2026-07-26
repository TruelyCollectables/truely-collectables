import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const requiredProductionKeys = Object.freeze([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "IP_INTELLIGENCE_REQUIRED",
  "IP_INTELLIGENCE_API_URL",
  "STRIPE_LIVE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED",
  "TCOS_LIVE_PAYMENTS_ENABLED",
]);
const vercelCliVersion = "56.2.0";
const vercelCliPackage = `vercel@${vercelCliVersion}`;
const vercelCliCacheDir = path.join(
  os.tmpdir(),
  `tcos-vercel-cli-${vercelCliVersion}`,
);
const selfTest = process.argv.includes("--self-test");
const jsonOutput = process.argv.includes("--json");

function normalizeVercelScope(value) {
  const trimmed = String(value).trim();

  if (
    !trimmed ||
    trimmed.startsWith("-") ||
    trimmed.length > 100 ||
    /[\s/\\:?#@.]/.test(trimmed) ||
    /(?:token|password|secret|key)=/i.test(trimmed) ||
    /\b(?:sk|rk)_(?:live|test)_/i.test(trimmed) ||
    /\b(?:Bearer|Basic)\s+/i.test(trimmed) ||
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(trimmed)
  ) {
    throw new Error(
      "VERCEL_SCOPE must be a simple lowercase Vercel team slug using only letters, numbers, and hyphens.",
    );
  }

  return trimmed;
}

function redactSecrets(text) {
  return String(text)
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-secret]")
    .replace(/\bpk_(?:live|test)_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-publishable]")
    .replace(/\bwhsec_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-stripe-webhook]")
    .replace(/\bre_[A-Za-z0-9_=-]{8,}\b/g, "[redacted-resend-key]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "[redacted-auth-header]")
    .replace(
      /\b(access_token|refresh_token|api_key|apikey|client_secret|secret|token|password)=([^&\s"'<>]+)/gi,
      "$1=[redacted-secret]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted-jwt]");
}

function diagnosticSnippet(text) {
  return redactSecrets(text).replace(/\s+/g, " ").trim().slice(0, 2000);
}

function hasExactName(output, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, "m").test(output);
}

function auditEnvironmentListing(output, requiredKeys = requiredProductionKeys) {
  const configured = requiredKeys.filter((key) => hasExactName(output, key));
  const missing = requiredKeys.filter((key) => !configured.includes(key));

  return {
    configured,
    missing,
    ready: missing.length === 0,
  };
}

function buildPayload(audit, scope) {
  return {
    schema: "tcos.vercelProductionEnvironmentAudit.v1",
    generatedAt: new Date().toISOString(),
    scope,
    environment: "production",
    requiredCount: requiredProductionKeys.length,
    configuredCount: audit.configured.length,
    missingCount: audit.missing.length,
    configured: audit.configured,
    missing: audit.missing,
    ready: audit.ready,
    deploymentStarted: false,
    valuesReadOrPrinted: false,
    next: audit.ready
      ? "Production environment names are staged. Continue normal launch verification; do not deploy until the final launch window."
      : `Add the missing Production environment variable name${audit.missing.length === 1 ? "" : "s"} in Vercel before production deployment.`,
    readOnlyGuarantee:
      "This audit lists Vercel Production environment variable names only. It does not pull, print, write, update, or remove values; start a build or deployment; change aliases; open Checkout; buy postage; approve launch; or change runtime switches.",
  };
}

function runSelfTest() {
  const completeFixture = requiredProductionKeys
    .map((key) => `${key} Encrypted Production 1d ago`)
    .join("\n");
  const completeAudit = auditEnvironmentListing(completeFixture);
  if (!completeAudit.ready || completeAudit.missing.length !== 0) {
    throw new Error(
      `Vercel production environment audit self-test rejected the complete fixture: ${JSON.stringify(completeAudit)}`,
    );
  }

  const missingServiceRoleFixture = completeFixture.replace(
    "SUPABASE_SERVICE_ROLE_KEY Encrypted Production 1d ago",
    "NOT_SUPABASE_SERVICE_ROLE_KEY_SUFFIX Encrypted Production 1d ago",
  );
  const missingServiceRoleAudit = auditEnvironmentListing(
    missingServiceRoleFixture,
  );
  if (
    missingServiceRoleAudit.ready ||
    missingServiceRoleAudit.missing.length !== 1 ||
    missingServiceRoleAudit.missing[0] !== "SUPABASE_SERVICE_ROLE_KEY"
  ) {
    throw new Error(
      `Vercel production environment audit self-test failed closed-name matching: ${JSON.stringify(missingServiceRoleAudit)}`,
    );
  }

  for (const invalidScope of [
    "",
    "--prod",
    "Team.Name",
    "team/name",
    "token=scope-secret",
    "Bearer scope-secret",
  ]) {
    try {
      normalizeVercelScope(invalidScope);
      throw new Error(`Scope self-test accepted invalid value: ${invalidScope}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("accepted invalid value") ||
        message.includes("scope-secret") ||
        !message.includes("VERCEL_SCOPE")
      ) {
        throw error;
      }
    }
  }

  console.log(
    "Vercel production environment audit self-test passed: exact-name matching, missing service-role detection, and scope validation are fail closed.",
  );
}

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

const scope = normalizeVercelScope(
  process.env.VERCEL_SCOPE ?? "truelycollectables-projects",
);
fs.mkdirSync(vercelCliCacheDir, { recursive: true });
const result = spawnSync(
  "npm",
  [
    "--prefix",
    vercelCliCacheDir,
    "exec",
    "--yes",
    `--package=${vercelCliPackage}`,
    "--",
    "vercel",
    "--cwd",
    process.cwd(),
    "env",
    "ls",
    "production",
    "--scope",
    scope,
    "--no-color",
  ],
  {
    encoding: "utf8",
    shell: process.platform === "win32",
  },
);
const output = `${result.stdout || ""}${result.stderr || ""}`;

if (result.status !== 0) {
  throw new Error(
    `Could not audit Vercel Production environment variable names with command-pinned Vercel CLI ${vercelCliVersion}. No deployment was started. Confirm the repository is linked to the correct Vercel project and the operator is authenticated. Diagnostic: ${diagnosticSnippet(output)}`,
  );
}

const audit = auditEnvironmentListing(output);
const payload = buildPayload(audit, scope);

if (jsonOutput) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("Vercel Production environment audit:");
  console.log(`- scope: ${payload.scope}`);
  console.log(`- environment: ${payload.environment}`);
  console.log(
    `- required names found: ${payload.configuredCount}/${payload.requiredCount}`,
  );
  console.log(
    `- missing names: ${payload.missing.length > 0 ? payload.missing.join(", ") : "none"}`,
  );
  console.log("- environment values read or printed: no");
  console.log("- deployment started: no");
  console.log(`- next: ${payload.next}`);
}

if (!audit.ready) {
  throw new Error(
    `Vercel Production environment audit is blocked. Missing required name${audit.missing.length === 1 ? "" : "s"}: ${audit.missing.join(", ")}. No deployment was started and no environment values were read or printed.`,
  );
}
