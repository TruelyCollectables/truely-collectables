import fs from "node:fs";

const envFile = process.env.LAUNCH_ENV_FILE || ".env.storefront.production";
const outputFile = process.env.SUPABASE_MANAGEMENT_AUDIT_OUTPUT || "supabase-management-launch-audit.json";
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();

function parseDotEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function usable(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/sensitive|encrypted|unavailable|placeholder|redacted/i.test(text) && !text.startsWith("__"));
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.supabase.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: response.ok, status: response.status, body };
}

function normalizeRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.data)) return body.data;
  return body && typeof body === "object" ? [body] : [];
}

const env = parseDotEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "");
const supabaseUrl = usable(env.NEXT_PUBLIC_SUPABASE_URL) ? env.NEXT_PUBLIC_SUPABASE_URL : null;
let projectRef = null;
try { projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : null; } catch {}

const tables = [
  "stores", "store_settings", "products", "orders", "offers", "stripe_webhook_events", "checkout_attempts",
  "stripe_post_payment_objects", "financial_adjustment_ledger_entries", "stripe_reconciliation_runs",
  "stripe_reconciliation_items", "payment_simulation_runs", "payment_simulation_scenarios",
  "live_payment_launch_gates", "live_payment_launch_events", "order_shipping_labels",
  "order_shipping_tracking_events", "order_shipping_coverage_claims", "public_endpoint_rate_limit_events",
  "admin_login_attempts", "tos_acceptance_events", "transaction_evidence_reports",
];

const payload = {
  schema: "truelyCollectables.supabaseManagementLaunchAudit.v1",
  generatedAt: new Date().toISOString(),
  authenticated: false,
  projectResolved: Boolean(projectRef),
  projectRefFingerprint: projectRef ? `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}` : null,
  criticalTableCount: tables.length,
  presentCount: 0,
  missingCount: 0,
  unknownCount: tables.length,
  presentTables: [],
  missingTables: [],
  unknownTables: [...tables],
  migrationHistoryAvailable: false,
  appliedMigrationCount: null,
  latestAppliedMigration: null,
  errors: [],
  secretValuesIncluded: false,
  readOnlyGuarantee: "The Supabase Management API is used only for project verification and read-only SQL. No migration, DDL, DML, database setting, API key, secret, deployment, payment, approval, or runtime-switch change is performed.",
};

try {
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is not configured in GitHub Actions.");
  if (!projectRef) throw new Error("Could not derive the Supabase project ref from the Vercel Production site configuration.");

  const project = await api(`/v1/projects/${encodeURIComponent(projectRef)}`);
  if (!project.ok) throw new Error(`Supabase project verification returned HTTP ${project.status}.`);
  payload.authenticated = true;

  const namesSql = tables.map((name) => `'${name.replaceAll("'", "''")}'`).join(",");
  const tableQuery = `
    select requested.table_name,
           to_regclass('public.' || requested.table_name) is not null as present
      from unnest(array[${namesSql}]::text[]) as requested(table_name)
     order by requested.table_name;
  `;
  const tableResponse = await api(`/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: "POST",
    body: JSON.stringify({ query: tableQuery, parameters: [] }),
  });
  if (!tableResponse.ok) throw new Error(`Read-only table audit returned HTTP ${tableResponse.status}.`);

  const rows = normalizeRows(tableResponse.body).filter((row) => row && typeof row.table_name === "string");
  if (rows.length !== tables.length) throw new Error(`Read-only table audit returned ${rows.length}/${tables.length} expected rows.`);
  payload.presentTables = rows.filter((row) => row.present === true).map((row) => row.table_name);
  payload.missingTables = rows.filter((row) => row.present !== true).map((row) => row.table_name);
  payload.unknownTables = [];
  payload.presentCount = payload.presentTables.length;
  payload.missingCount = payload.missingTables.length;
  payload.unknownCount = 0;

  const historyCheck = await api(`/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: "POST",
    body: JSON.stringify({
      query: "select to_regclass('supabase_migrations.schema_migrations') is not null as available;",
      parameters: [],
    }),
  });
  const historyRows = historyCheck.ok ? normalizeRows(historyCheck.body) : [];
  payload.migrationHistoryAvailable = historyRows[0]?.available === true;

  if (payload.migrationHistoryAvailable) {
    const history = await api(`/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
      method: "POST",
      body: JSON.stringify({
        query: "select version, name from supabase_migrations.schema_migrations order by version desc limit 500;",
        parameters: [],
      }),
    });
    if (history.ok) {
      const applied = normalizeRows(history.body);
      payload.appliedMigrationCount = applied.length;
      payload.latestAppliedMigration = applied[0]
        ? { version: String(applied[0].version || ""), name: String(applied[0].name || "") }
        : null;
    } else {
      payload.errors.push(`Migration history query returned HTTP ${history.status}.`);
    }
  }
} catch (error) {
  payload.errors.push(error instanceof Error ? error.message : "Unknown Supabase Management API error.");
}

payload.readyForMigrationDecision = payload.authenticated && payload.unknownCount === 0;
payload.next = !payload.authenticated
  ? "Add SUPABASE_ACCESS_TOKEN as a GitHub repository secret and rerun this audit."
  : payload.missingCount > 0
    ? "Apply only the migrations required for the reported missing storefront tables, then rerun the read-only audit."
    : "All critical storefront tables are present. Continue Stripe approval, final data cleanup, deployment, and smoke testing.";

fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`Supabase Management launch audit completed: authenticated=${payload.authenticated}, present=${payload.presentCount}, missing=${payload.missingCount}, unknown=${payload.unknownCount}.`);
if (!payload.authenticated) process.exitCode = 1;
