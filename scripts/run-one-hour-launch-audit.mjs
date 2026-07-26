import fs from "node:fs";

const envFile = process.env.LAUNCH_ENV_FILE || ".env.storefront.production";
const namesFile = process.env.LAUNCH_ENV_NAMES_FILE || "vercel-production-env-names.txt";
const quotaFile = process.env.LAUNCH_QUOTA_FILE || "vercel-quota-status.json";
const outputFile = process.env.LAUNCH_AUDIT_OUTPUT || "one-hour-launch-audit.json";
const siteOrigin = "https://truelycollectables.com";

function parseDotEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7) : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value.replace(/\\n/g, "\n");
  }
  return result;
}

function usable(value) {
  const text = String(value || "").trim();
  return Boolean(
    text &&
      !/sensitive|encrypted|unavailable|placeholder|redacted/i.test(text) &&
      !text.startsWith("__") &&
      text !== "@sensitive",
  );
}

function exactNamePresent(listing, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Z0-9_])${escaped}([^A-Z0-9_]|$)`, "m").test(listing);
}

function safeJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function auditTable({ baseUrl, anonKey, table, select = "id" }) {
  try {
    const url = `${baseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}&limit=1`;
    const response = await fetchWithTimeout(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
        Prefer: "count=none",
      },
    });
    let code = null;
    try {
      const payload = await response.clone().json();
      code = typeof payload?.code === "string" ? payload.code : null;
    } catch {}
    const missing = response.status === 404 || code === "PGRST205" || code === "42P01";
    return {
      table,
      status: missing ? "missing" : response.ok || response.status === 401 || response.status === 403 ? "present" : "unknown",
      httpStatus: response.status,
      diagnosticCode: code,
    };
  } catch (error) {
    return {
      table,
      status: "unknown",
      httpStatus: null,
      diagnosticCode: error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed",
    };
  }
}

async function auditPage(path, expectedText = null) {
  try {
    const response = await fetchWithTimeout(`${siteOrigin}${path}`);
    const text = await response.text();
    return {
      path,
      status: response.status,
      ok: response.ok && (!expectedText || text.toLowerCase().includes(expectedText.toLowerCase())),
      expectedTextFound: expectedText ? text.toLowerCase().includes(expectedText.toLowerCase()) : null,
      finalHost: new URL(response.url).host,
    };
  } catch (error) {
    return {
      path,
      status: null,
      ok: false,
      expectedTextFound: null,
      finalHost: null,
      error: error instanceof Error && error.name === "AbortError" ? "timeout" : "request_failed",
    };
  }
}

const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
const env = parseDotEnv(envText);
const namesListing = fs.existsSync(namesFile) ? fs.readFileSync(namesFile, "utf8") : "";
const quota = safeJson(quotaFile);

const requiredStorefrontNames = [
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
];

const managementCandidates = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_DB_URL",
  "SUPABASE_DB_PASSWORD",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "PGHOST",
  "PGUSER",
  "PGPASSWORD",
];

const requiredNames = requiredStorefrontNames.map((name) => ({
  name,
  presentInVercel: exactNamePresent(namesListing, name),
  usableOutsideVercelBuild: usable(env[name]),
}));
const management = managementCandidates.map((name) => ({
  name,
  presentInVercel: exactNamePresent(namesListing, name),
  usableOutsideVercelBuild: usable(env[name]),
}));

const supabaseUrl = usable(env.NEXT_PUBLIC_SUPABASE_URL) ? env.NEXT_PUBLIC_SUPABASE_URL : null;
const supabaseAnon = usable(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null;

const criticalTables = [
  ["stores", "id"],
  ["store_settings", "store_id"],
  ["products", "id"],
  ["orders", "id"],
  ["offers", "id"],
  ["stripe_webhook_events", "id"],
  ["checkout_attempts", "id"],
  ["stripe_post_payment_objects", "id"],
  ["financial_adjustment_ledger_entries", "id"],
  ["stripe_reconciliation_runs", "id"],
  ["stripe_reconciliation_items", "id"],
  ["payment_simulation_runs", "id"],
  ["payment_simulation_scenarios", "id"],
  ["live_payment_launch_gates", "store_id"],
  ["live_payment_launch_events", "id"],
  ["order_shipping_labels", "id"],
  ["order_shipping_tracking_events", "id"],
  ["order_shipping_coverage_claims", "id"],
  ["public_endpoint_rate_limit_events", "id"],
  ["admin_login_attempts", "id"],
  ["tos_acceptance_events", "id"],
  ["transaction_evidence_reports", "id"],
];

const tableResults = supabaseUrl && supabaseAnon
  ? await Promise.all(criticalTables.map(([table, select]) => auditTable({ baseUrl: supabaseUrl, anonKey: supabaseAnon, table, select })))
  : criticalTables.map(([table]) => ({ table, status: "unknown", httpStatus: null, diagnosticCode: "public_supabase_env_unavailable" }));

const siteResults = await Promise.all([
  auditPage("/", "Truely Collectables"),
  auditPage("/robots.txt"),
  auditPage("/sitemap.xml"),
  auditPage("/admin/login"),
]);

const missingTables = tableResults.filter((item) => item.status === "missing");
const unknownTables = tableResults.filter((item) => item.status === "unknown");
const usableManagementNames = management.filter((item) => item.usableOutsideVercelBuild).map((item) => item.name);
const canApplyMigrationsAutomatically = usableManagementNames.some((name) =>
  ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_URL", "DATABASE_URL", "POSTGRES_URL", "PGPASSWORD"].includes(name),
);

const payload = {
  schema: "truelyCollectables.oneHourLaunchAudit.v1",
  generatedAt: new Date().toISOString(),
  branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
  storefrontEnvironment: {
    requiredCount: requiredNames.length,
    presentCount: requiredNames.filter((item) => item.presentInVercel).length,
    missingNames: requiredNames.filter((item) => !item.presentInVercel).map((item) => item.name),
    valuesUsableOutsideVercelBuildCount: requiredNames.filter((item) => item.usableOutsideVercelBuild).length,
    checks: requiredNames,
  },
  migrationAccess: {
    canApplyMigrationsAutomatically,
    usableCredentialNames: usableManagementNames,
    checks: management,
    note: "Only variable names and usability booleans are reported; no values are included.",
  },
  supabaseSchema: {
    auditedWithPublicCredentials: Boolean(supabaseUrl && supabaseAnon),
    criticalTableCount: tableResults.length,
    presentCount: tableResults.filter((item) => item.status === "present").length,
    missingCount: missingTables.length,
    unknownCount: unknownTables.length,
    missingTables: missingTables.map((item) => item.table),
    unknownTables: unknownTables.map((item) => item.table),
    tables: tableResults,
  },
  currentPublicSite: {
    allChecksPassed: siteResults.every((item) => item.ok),
    checks: siteResults,
  },
  vercelQuota: quota
    ? {
        state: quota.state || "unknown",
        canRetry: Boolean(quota.canRetry),
        reason: quota.reason || null,
        retryAt: quota.retryAt || null,
        uploadStarted: Boolean(quota.vercelUploadStarted),
      }
    : { state: "unknown", canRetry: false, reason: "quota_status_unavailable", retryAt: null, uploadStarted: false },
  blockers: [
    ...requiredNames.filter((item) => !item.presentInVercel).map((item) => `missing_env:${item.name}`),
    ...missingTables.map((item) => `missing_table:${item.table}`),
    ...unknownTables.map((item) => `unknown_table:${item.table}`),
    ...siteResults.filter((item) => !item.ok).map((item) => `site_check:${item.path}`),
    ...(quota?.state && quota.state !== "open" ? [`vercel_quota:${quota.state}`] : []),
  ],
  readOnlyGuarantee: "No deployment, preview, alias change, environment mutation, database write, migration, Checkout Session, payment, refund, payout, postage purchase, launch approval, or runtime-switch change was attempted.",
};

payload.next = payload.blockers.length === 0
  ? "No blocker was found by this read-only audit. Proceed to live Stripe/database approval verification and the controlled deploy window."
  : canApplyMigrationsAutomatically
    ? "Use the available database-management credential to clear the reported schema blockers, then rerun the audit."
    : "Clear the reported blockers. If schema changes are needed, an owner-supplied Supabase management credential or SQL Editor action is required.";

fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`One-hour launch audit completed with ${payload.blockers.length} blocker(s). Redacted evidence written to ${outputFile}.`);
