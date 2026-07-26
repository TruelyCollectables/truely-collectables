import fs from "node:fs";
import path from "node:path";

const envFile = process.env.LAUNCH_ENV_FILE || ".env.storefront.production";
const outputFile = process.env.STOREFRONT_MIGRATION_AUDIT_OUTPUT || "unapplied-storefront-migrations.json";
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

async function api(projectRef, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, parameters: [] }),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) throw new Error(`Supabase read-only SQL returned HTTP ${response.status}.`);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.result)) return body.result;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

const env = parseDotEnv(fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "");
let projectRef = null;
try { projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]; } catch {}
if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is missing.");
if (!projectRef) throw new Error("Could not derive Supabase project ref.");

const appliedRows = await api(projectRef, "select version, name from supabase_migrations.schema_migrations order by version;");
const appliedVersions = new Set(appliedRows.map((row) => String(row.version || "")));
const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
const local = fs.readdirSync(migrationsDir)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map((name) => {
    const version = name.slice(0, 14);
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    return { name, version, sql };
  });

const postLaunchFeaturePattern = /(market_intel|instacomp|checklist|registry|release_calendar|profit_hunter|active_market|watchlist|discovery|catalog|sports_|collector_|account_|seller_marketplace|mcp)/i;
const storefrontPattern = /(checkout|stripe|payment|order|offer|shipping|rate_limit|admin_login|tos_|transaction_evidence|store_settings|stores|products|inventory|ebay_sync|security_ip|live_payment|live_shipping|financial|reconciliation)/i;

const unapplied = local
  .filter((item) => !appliedVersions.has(item.version))
  .map((item) => {
    const featureOnly = postLaunchFeaturePattern.test(item.name) && !storefrontPattern.test(item.name);
    const storefrontRelevant = storefrontPattern.test(item.name) || /public_endpoint_rate_limit_events|live_payment_launch|stripe_|checkout_|order_shipping|transaction_evidence|tos_acceptance|admin_login/i.test(item.sql);
    return {
      version: item.version,
      file: item.name,
      storefrontRelevant,
      postLaunchFeatureOnly: featureOnly,
      changesPrivileges: /\b(grant|revoke|row level security|policy)\b/i.test(item.sql),
      changesData: /\b(insert into|update\s+public\.|delete from)\b/i.test(item.sql),
    };
  });

const storefrontCandidates = unapplied.filter((item) => item.storefrontRelevant && !item.postLaunchFeatureOnly);
const payload = {
  schema: "truelyCollectables.unappliedStorefrontMigrations.v1",
  generatedAt: new Date().toISOString(),
  appliedMigrationCount: appliedVersions.size,
  localMigrationCount: local.length,
  unappliedCount: unapplied.length,
  storefrontCandidateCount: storefrontCandidates.length,
  storefrontCandidates,
  excludedPostLaunchCount: unapplied.filter((item) => item.postLaunchFeatureOnly).length,
  allUnapplied: unapplied,
  readOnlyGuarantee: "This comparison reads migration history and repository files only. No migration, SQL write, deployment, payment, approval, or runtime switch was executed.",
};
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
console.log(`Unapplied migration audit: ${unapplied.length} total, ${storefrontCandidates.length} storefront candidate(s).`);
