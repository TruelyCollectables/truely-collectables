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
  "STRIPE_LIVE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_LIVE_PUBLISHABLE_KEY",
  "STRIPE_LIVE_WEBHOOK_SECRET",
  "STRIPE_LIVE_FINANCIAL_EVENTS_VERIFIED",
  "TCOS_LIVE_PAYMENTS_ENABLED",
  "OPENAI_API_KEY",
  "SERPAPI_API_KEY",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_ENVIRONMENT",
  "RESEND_API_KEY",
  "TCOS_SHIPPING_PURCHASE_MODE",
  "TCOS_LIVE_SHIPPING_ENABLED",
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

function normalizeVercelProject(value) {
  const trimmed = String(value).trim();
  if (
    !trimmed ||
    trimmed.startsWith("-") ||
    trimmed.length > 100 ||
    /[\s/\\:?#@.]/.test(trimmed) ||
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(trimmed)
  ) {
    throw new Error(
      "VERCEL_PROJECT_NAME must be a simple lowercase Vercel project slug using only letters, numbers, and hyphens.",
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

function buildPayload(audit, scope, linkedProject) {
  return {
    schema: "tcos.vercelProductionEnvironmentAudit.v3",
    generatedAt: new Date().toISOString(),
    scope,
    linkedProject,
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
      "This audit may create local .vercel project-link metadata when CI starts from a clean checkout. It lists Vercel Production environment variable names only and does not pull, print, write, update, or remove remote values; start a build or deployment; change aliases; open Checkout; buy postage; approve launch; or change runtime switches.",
  };
}

function runPinnedVercel(args) {
  return spawnSync(
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
      ...args,
    ],
    {
      encoding: "utf8",
      shell: process.platform === "win32",
    },
  );
}

function ensureVercelProjectLink({ scope, project }) {
  const linkFile = path.join(process.cwd(), ".vercel", "project.json");
  if (fs.existsSync(linkFile)) return false;

  const token = String(process.env.VERCEL_TOKEN || "").trim();
  if (!token) {
    throw new Error(
      "The checkout is not linked to Vercel and VERCEL_TOKEN is unavailable, so the Production environment audit cannot establish the local project link.",
    );
  }

  const result = runPinnedVercel([
    "link",
    "--yes",
    "--project",
    project,
    "--scope",
    scope,
    "--token",
    token,
    "--no-color",
  ]);
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0 || !fs.existsSync(linkFile)) {
    throw new Error(
      `Could not establish the local Vercel project link with command-pinned Vercel CLI ${vercelCliVersion}. No deployment was started. Diagnostic: ${diagnosticSnippet(output)}`,
    );
  }
  return true;
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

  for (const invalidProject of ["", "--prod", "Project.Name", "team/project"]) {
    try {
      normalizeVercelProject(invalidProject);
      throw new Error(`Project self-test accepted invalid value: ${invalidProject}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("accepted invalid value") ||
        !message.includes("VERCEL_PROJECT_NAME")
      ) {
        throw error;
      }
    }
  }

  console.log(
    "Vercel production environment audit self-test passed: exact-name matching, complete launch-variable coverage, missing service-role detection, scope validation, and project-name validation are fail closed.",
  );
}

if (selfTest) {
  runSelfTest();
  process.exit(0);
}

const scope = normalizeVercelScope(
  process.env.VERCEL_SCOPE ?? "truelycollectables-projects",
);
const project = normalizeVercelProject(
  process.env.VERCEL_PROJECT_NAME ?? "truely-collectables",
);
fs.mkdirSync(vercelCliCacheDir, { recursive: true });
const linkedLocally = ensureVercelProjectLink({ scope, project });
const result = runPinnedVercel([
  "env",
  "ls",
  "production",
  "--scope",
  scope,
  "--no-color",
]);
const output = `${result.stdout || ""}${result.stderr || ""}`;

if (result.status !== 0) {
  throw new Error(
    `Could not audit Vercel Production environment variable names with command-pinned Vercel CLI ${vercelCliVersion}. No deployment was started. Confirm the repository is linked to the correct Vercel project and the operator is authenticated. Diagnostic: ${diagnosticSnippet(output)}`,
  );
}

const audit = auditEnvironmentListing(output);
const payload = buildPayload(audit, scope, project);
payload.localProjectLinkCreated = linkedLocally;

if (jsonOutput) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("Vercel Production environment audit:");
  console.log(`- scope: ${payload.scope}`);
  console.log(`- linked project: ${payload.linkedProject}`);
  console.log(`- local project link created: ${payload.localProjectLinkCreated ? "yes" : "no"}`);
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
