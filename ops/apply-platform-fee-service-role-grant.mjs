import fs from "node:fs";
import path from "node:path";

const [appDirInput, envPathInput, evidenceDirInput] = process.argv.slice(2);
if (!appDirInput || !envPathInput || !evidenceDirInput) {
  throw new Error("Usage: node apply-platform-fee-service-role-grant.mjs <appDir> <envPath> <evidenceDir>");
}

const appDir = path.resolve(appDirInput);
const envPath = path.resolve(envPathInput);
const evidenceDir = path.resolve(evidenceDirInput);
const token = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "").trim();
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is unavailable.");

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const productionEnv = parseEnv(fs.readFileSync(envPath, "utf8"));
const productionUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
if (!/^https:\/\//.test(productionUrl)) throw new Error("Production Supabase URL is unavailable.");
const projectRef = new URL(productionUrl).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function request(query, readOnly = false) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
  });
  const body = await response.text();
  if (!response.ok) {
    const safe = body
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .slice(0, 4000);
    throw new Error(`Production platform-fee grant query failed with HTTP ${response.status}: ${safe}`);
  }
  return body ? JSON.parse(body) : [];
}

const migrationName = "20260730050000_grant_platform_fee_delete_service_role.sql";
const migration = fs.readFileSync(path.join(appDir, "supabase", "migrations", migrationName), "utf8").trim();
if (!migration) throw new Error(`${migrationName} is empty.`);
await request(migration, false);

const rows = await request(`
  select json_build_object(
    'service_role_delete', has_table_privilege('service_role', 'public.platform_fee_ledger_entries', 'DELETE'),
    'anon_delete', has_table_privilege('anon', 'public.platform_fee_ledger_entries', 'DELETE'),
    'authenticated_delete', has_table_privilege('authenticated', 'public.platform_fee_ledger_entries', 'DELETE'),
    'captured_at', now()
  ) as receipt;
`, true);
const receipt = rows?.[0]?.receipt;
if (!receipt || receipt.service_role_delete !== true) {
  throw new Error("Production service_role DELETE permission was not established.");
}
if (receipt.anon_delete === true || receipt.authenticated_delete === true) {
  throw new Error("A public role received prohibited platform-fee DELETE permission.");
}

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "production-platform-fee-service-role-grant.json"),
  JSON.stringify({ ok: true, migrationName, ...receipt }, null, 2),
);
console.log("PRODUCTION_PLATFORM_FEE_SERVICE_ROLE_DELETE_GRANT=passed");
