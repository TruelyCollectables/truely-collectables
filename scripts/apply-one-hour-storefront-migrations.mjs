import fs from "node:fs";
import path from "node:path";

const envFile = process.env.LAUNCH_ENV_FILE || ".env.storefront.production";
const outputFile = process.env.STOREFRONT_MIGRATION_APPLY_OUTPUT || "storefront-migration-apply.json";
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const applyAuthorized = process.env.APPLY_STOREFRONT_MIGRATIONS === "true";

const selectedFiles = [
  "20260725010000_checkout_inventory_reservations.sql",
  "20260725170000_consume_checkout_reservations.sql",
  "20260726020000_enforce_platform_owner_payout_marker.sql",
  "20260726023000_reproduce_launch_inventory_order_integrity.sql",
  "20260726040000_reproduce_hardened_checkout_functions.sql",
  "20260726060000_offer_listing_shipping_snapshot.sql",
  "20260726070000_truely_buyer_protection.sql",
  "20260726150000_order_notification_outbox.sql",
  "20260726213000_harden_public_endpoint_rate_limit_privileges.sql",
];

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

function normalizeRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function safeDiagnostic(body, status) {
  const value = body && typeof body === "object"
    ? body.message || body.error || body.msg || `HTTP ${status}`
    : `HTTP ${status}`;
  return String(value).replace(/\s+/g, " ").slice(0, 500);
}

async function api(projectRef, endpoint, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}${endpoint}`, {
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

async function readOnly(projectRef, query) {
  return api(projectRef, "/database/query/read-only", {
    method: "POST",
    body: JSON.stringify({ query, parameters: [] }),
  });
}

function stripOuterTransaction(sql) {
  return sql
    .replace(/^\s*begin\s*;\s*/i, "")
    .replace(/\s*commit\s*;\s*$/i, "")
    .trim();
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const payload = {
  schema: "truelyCollectables.storefrontMigrationApply.v1",
  generatedAt: new Date().toISOString(),
  authorized: applyAuthorized,
  projectResolved: false,
  selectedCount: selectedFiles.length,
  applied: [],
  alreadyApplied: [],
  failed: null,
  excluded: ["20260726050000_collectible_asset_lifecycle.sql"],
  finalVerification: null,
  secretValuesIncluded: false,
  deploymentStarted: false,
};

try {
  if (!applyAuthorized) throw new Error("APPLY_STOREFRONT_MIGRATIONS is not true.");
  if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is missing.");

  const env = parseDotEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "");
  let projectRef = null;
  try { projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]; } catch {}
  if (!projectRef) throw new Error("Could not derive Supabase project ref.");
  payload.projectResolved = true;

  const columns = await readOnly(projectRef, `
    select column_name
      from information_schema.columns
     where table_schema = 'supabase_migrations'
       and table_name = 'schema_migrations'
     order by ordinal_position;
  `);
  if (!columns.ok) throw new Error(`Could not inspect migration history columns: ${safeDiagnostic(columns.body, columns.status)}`);
  const columnNames = new Set(normalizeRows(columns.body).map((row) => row.column_name));
  for (const required of ["version", "name", "statements"]) {
    if (!columnNames.has(required)) throw new Error(`Migration history is missing required column ${required}.`);
  }

  const history = await readOnly(projectRef, "select version from supabase_migrations.schema_migrations;");
  if (!history.ok) throw new Error(`Could not read migration history: ${safeDiagnostic(history.body, history.status)}`);
  const appliedVersions = new Set(normalizeRows(history.body).map((row) => String(row.version || "")));

  for (const file of selectedFiles) {
    const version = file.slice(0, 14);
    const name = file.slice(15, -4);
    if (appliedVersions.has(version)) {
      payload.alreadyApplied.push({ version, file });
      continue;
    }

    const filePath = path.join(process.cwd(), "supabase", "migrations", file);
    if (!fs.existsSync(filePath)) throw new Error(`Selected migration file is missing: ${file}`);
    const source = fs.readFileSync(filePath, "utf8");
    const body = stripOuterTransaction(source);
    const receipt = sqlLiteral(source);
    const query = `
      begin;
      set local lock_timeout = '10s';
      set local statement_timeout = '180s';
      ${body}
      insert into supabase_migrations.schema_migrations(version, name, statements)
      values (${sqlLiteral(version)}, ${sqlLiteral(name)}, array[${receipt}]::text[])
      on conflict (version) do nothing;
      commit;
    `;

    const result = await api(projectRef, "/database/query", {
      method: "POST",
      body: JSON.stringify({ query, parameters: [], read_only: false }),
    });
    if (!result.ok) {
      payload.failed = { version, file, status: result.status, diagnostic: safeDiagnostic(result.body, result.status) };
      throw new Error(`Migration ${file} failed: ${payload.failed.diagnostic}`);
    }

    const verify = await readOnly(projectRef, `select version, name from supabase_migrations.schema_migrations where version = ${sqlLiteral(version)};`);
    const verified = verify.ok && normalizeRows(verify.body).some((row) => String(row.version) === version);
    if (!verified) {
      payload.failed = { version, file, status: verify.status, diagnostic: "Migration SQL returned success but history verification failed." };
      throw new Error(`Migration history verification failed for ${file}.`);
    }

    payload.applied.push({ version, file });
    appliedVersions.add(version);
  }

  const final = await readOnly(projectRef, `
    select version, name
      from supabase_migrations.schema_migrations
     where version in (${selectedFiles.map((file) => sqlLiteral(file.slice(0, 14))).join(",")})
     order by version;
  `);
  const finalRows = final.ok ? normalizeRows(final.body) : [];
  payload.finalVerification = {
    expectedCount: selectedFiles.length,
    recordedCount: finalRows.length,
    complete: finalRows.length === selectedFiles.length,
    versions: finalRows.map((row) => String(row.version)),
  };
  if (!payload.finalVerification.complete) throw new Error("Final migration history verification is incomplete.");
} catch (error) {
  if (!payload.failed) payload.failed = { diagnostic: error instanceof Error ? error.message : "Unknown migration apply error." };
  process.exitCode = 1;
}

payload.completedAt = new Date().toISOString();
payload.readOnlyGuarantee = null;
payload.writeBoundary = "Only the nine explicitly selected Truely Collectables storefront migrations may be applied. The TCOS collectible asset lifecycle migration is excluded. No Vercel deployment, environment mutation, payment, refund, payout, postage purchase, launch approval, or runtime-switch change occurs.";
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`Storefront migration apply completed: ${payload.applied.length} newly applied, ${payload.alreadyApplied.length} already applied, failed=${Boolean(payload.failed)}.`);
