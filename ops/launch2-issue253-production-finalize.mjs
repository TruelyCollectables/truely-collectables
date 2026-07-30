import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [appDirInput, envPathInput, evidenceDirInput] = process.argv.slice(2);
if (!appDirInput || !envPathInput || !evidenceDirInput) {
  throw new Error("Usage: node finalizer.mjs <appDir> <productionEnvPath> <evidenceDir>");
}

const appDir = path.resolve(appDirInput);
const envPath = path.resolve(envPathInput);
const evidenceDir = path.resolve(evidenceDirInput);
const expectedSha = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const vercelToken = String(process.env.VERCEL_TOKEN || "").trim();
const supabaseToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "").trim();
const vercelScope = String(process.env.VERCEL_SCOPE || "").trim();

if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error("EXPECTED_MAIN_SHA is invalid.");
if (!vercelToken) throw new Error("VERCEL_TOKEN is unavailable.");
if (!supabaseToken) throw new Error("SUPABASE_ACCESS_TOKEN is unavailable.");
if (!vercelScope) throw new Error("VERCEL_SCOPE is unavailable.");
if (!fs.existsSync(envPath)) throw new Error("Production environment file is missing.");

fs.mkdirSync(evidenceDir, { recursive: true });

function parseEnvFile(text) {
  const parsed = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function safeErrorText(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(new RegExp(vercelToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]")
    .replace(new RegExp(supabaseToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]")
    .slice(0, 5000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const productionEnv = parseEnvFile(fs.readFileSync(envPath, "utf8"));
const productionSupabaseUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const cronSecret = String(productionEnv.CRON_SECRET || "").trim();
if (!/^https:\/\//.test(productionSupabaseUrl)) {
  throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled from Vercel.");
}
if (!cronSecret) throw new Error("Production CRON_SECRET is unavailable for protected-boundary verification.");

const projectRef = new URL(productionSupabaseUrl).hostname.split(".")[0];
if (!projectRef) throw new Error("Unable to derive the Supabase project reference.");
const supabaseEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function supabaseQuery(query, readOnly = false) {
  const response = await fetch(supabaseEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase Production query failed with HTTP ${response.status}: ${safeErrorText(body)}`);
  }
  return body ? JSON.parse(body) : [];
}

const migrationName = "20260730002900_protect_inactive_marketplace_sales.sql";
const migrationPath = path.join(appDir, "supabase", "migrations", migrationName);
const migrationSql = fs.readFileSync(migrationPath, "utf8").trim();
if (!migrationSql) throw new Error(`${migrationName} is empty.`);

await supabaseQuery(migrationSql, false);

const validationRows = await supabaseQuery(`
  select json_build_object(
    'inactive_guard_function_exists', to_regprocedure(
      'public.capture_ebay_inactive_collectible_sale()'
    ) is not null,
    'inactive_capture_trigger_exists', exists (
      select 1
      from pg_trigger
      where tgname = 'capture_ebay_inactive_collectible_sale'
        and not tgisinternal
    ),
    'inbound_guard_table_exists', to_regclass('public.ebay_inbound_sale_guards') is not null,
    'function_installs_zero_guard', coalesce((
      select position('ebay_inbound_sale_guards' in pg_get_functiondef(p.oid)) > 0
         and position('protected_quantity' in pg_get_functiondef(p.oid)) > 0
         and position('least(existing.protected_quantity' in pg_get_functiondef(p.oid)) > 0
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'capture_ebay_inactive_collectible_sale'
      limit 1
    ), false),
    'sale_records_total', (select count(*) from public.collectible_sales),
    'sale_records_verified', (select count(*) from public.collectible_sales where evidence_status = 'verified'),
    'sale_records_manual', (select count(*) from public.collectible_sales where evidence_status = 'manual'),
    'sale_records_unresolved', (select count(*) from public.collectible_sales where evidence_status = 'unresolved'),
    'verified_or_manual_missing_actual_price', (
      select count(*) from public.collectible_sales
      where evidence_status in ('verified','manual') and sold_price is null
    ),
    'null_price_not_explicitly_unresolved', (
      select count(*) from public.collectible_sales
      where sold_price is null and evidence_status <> 'unresolved'
    ),
    'website_pre_cutoff_sale_records', (
      select count(*) from public.collectible_sales
      where source_marketplace = 'website'
        and sold_at < timestamptz '2026-07-28 00:00:00+00'
    ),
    'duplicate_sale_event_groups', (
      select count(*) from (
        select store_id, event_key
        from public.collectible_sales
        group by store_id, event_key
        having count(*) > 1
      ) duplicates
    ),
    'negative_product_quantities', (select count(*) from public.products where quantity < 0),
    'negative_inventory_quantities', (select count(*) from public.inventory_items where quantity < 0),
    'sold_stock_restoration_violations', (
      select count(*) from public.products where sold_at is not null and quantity > 0
    ),
    'collx_only_excluded_inventory_rows', (
      select count(*) from public.collx_only_inventory_boundary_violations
    ),
    'active_zero_quantity_inbound_guards', (
      select count(*) from public.ebay_inbound_sale_guards
      where active and protected_quantity = 0
    ),
    'captured_at', now()
  ) as receipt;
`, true);

const validation = validationRows?.[0]?.receipt;
if (!validation) throw new Error("Production issue #253 validation receipt was empty.");
for (const key of [
  "inactive_guard_function_exists",
  "inactive_capture_trigger_exists",
  "inbound_guard_table_exists",
  "function_installs_zero_guard",
]) {
  if (validation[key] !== true) throw new Error(`Production validation failed: ${key}.`);
}
for (const key of [
  "verified_or_manual_missing_actual_price",
  "null_price_not_explicitly_unresolved",
  "duplicate_sale_event_groups",
  "negative_product_quantities",
  "negative_inventory_quantities",
  "sold_stock_restoration_violations",
]) {
  if (Number(validation[key]) !== 0) throw new Error(`Production invariant failed: ${key}=${validation[key]}.`);
}

const deployment = spawnSync(
  "npx",
  [
    "vercel@56.2.0",
    "deploy",
    "--prod",
    "--yes",
    "--force",
    "--archive=tgz",
    "--meta",
    `githubCommitSha=${expectedSha}`,
    "--meta",
    "launchGate=issue253-finalize",
    "--scope",
    vercelScope,
    "--token",
    vercelToken,
  ],
  {
    cwd: appDir,
    encoding: "utf8",
    env: process.env,
    timeout: 20 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  },
);
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) {
  throw new Error(`Vercel Production deployment failed: ${safeErrorText(deployment.stderr)}`);
}
const deploymentText = `${deployment.stdout || ""}\n${deployment.stderr || ""}`;
const deploymentUrls = deploymentText.match(/https:\/\/[A-Za-z0-9.-]+\.vercel\.app/g) || [];
const deploymentUrl = deploymentUrls.at(-1);
if (!deploymentUrl) throw new Error("Vercel did not return a Production deployment URL.");
const deploymentHost = new URL(deploymentUrl).hostname;

const projectLink = JSON.parse(fs.readFileSync(path.join(appDir, ".vercel", "project.json"), "utf8"));
const orgId = String(projectLink.orgId || "").trim();
if (!orgId) throw new Error("Vercel project orgId is unavailable.");

let deploymentApi = null;
for (let attempt = 1; attempt <= 90; attempt += 1) {
  const response = await fetch(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentHost)}?teamId=${encodeURIComponent(orgId)}`,
    { headers: { Authorization: `Bearer ${vercelToken}` } },
  );
  const body = await response.text();
  if (response.ok) {
    const candidate = JSON.parse(body);
    const aliases = [...(candidate.alias || []), ...(candidate.aliases || [])]
      .map((value) => String(value).replace(/^https?:\/\//, "").replace(/\/$/, ""));
    const exact = candidate.meta?.githubCommitSha === expectedSha;
    const ready = candidate.readyState === "READY";
    const production = candidate.target === "production";
    const sameHost = candidate.url === deploymentHost;
    const customDomain = aliases.includes("truelycollectables.com");
    if (exact && ready && production && sameHost && customDomain) {
      deploymentApi = {
        id: candidate.id,
        url: candidate.url,
        readyState: candidate.readyState,
        target: candidate.target,
        exactSha: candidate.meta.githubCommitSha,
        customDomainAliasVerified: true,
      };
      break;
    }
  }
  await sleep(10_000);
}
if (!deploymentApi) {
  throw new Error("Exact-SHA Vercel Production deployment and custom-domain alias were not verified within 15 minutes.");
}

async function requestStatus(url, options = {}) {
  const response = await fetch(url, { redirect: "follow", ...options });
  return { response, text: await response.text() };
}

let liveReceipt = null;
for (let attempt = 1; attempt <= 72; attempt += 1) {
  try {
    const [home, shop, authorized, unsigned] = await Promise.all([
      requestStatus("https://truelycollectables.com/"),
      requestStatus("https://truelycollectables.com/shop"),
      requestStatus("https://truelycollectables.com/api/admin-orders-health", {
        headers: { Authorization: `Bearer ${cronSecret}` },
      }),
      requestStatus("https://truelycollectables.com/api/admin-orders-health"),
    ]);
    let authorizedJson = {};
    try {
      authorizedJson = JSON.parse(authorized.text);
    } catch {
      authorizedJson = {};
    }
    if (
      home.response.status === 200 &&
      shop.response.status === 200 &&
      authorized.response.status === 200 &&
      unsigned.response.status === 401 &&
      authorizedJson.ok === true
    ) {
      liveReceipt = {
        homeStatus: home.response.status,
        shopStatus: shop.response.status,
        authorizedAdminHealthStatus: authorized.response.status,
        unsignedAdminHealthStatus: unsigned.response.status,
        authorizedAdminHealthOk: true,
        verifiedAt: new Date().toISOString(),
      };
      break;
    }
  } catch {
    // Retry until the exact deployment and custom domain are fully propagated.
  }
  await sleep(10_000);
}
if (!liveReceipt) throw new Error("Live custom-domain and protected-boundary verification did not pass within 12 minutes.");

const receipt = {
  ok: true,
  exactMainSha: expectedSha,
  migration: {
    name: migrationName,
    appliedAndVerified: true,
  },
  productionAggregateValidation: validation,
  deployment: {
    deploymentUrl,
    ...deploymentApi,
  },
  liveBoundary: liveReceipt,
  evidenceScope: "aggregate counts and deployment metadata only",
  prohibitedRealWorldEvidenceCreated: false,
  generatedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(evidenceDir, "launch2-issue253-production-finalize-receipt.json"), JSON.stringify(receipt, null, 2));
fs.writeFileSync(path.join(evidenceDir, "deployment-url.txt"), `${deploymentUrl}\n`);
fs.writeFileSync(path.join(evidenceDir, "exact-main-sha.txt"), `${expectedSha}\n`);
console.log(`ISSUE253_PRODUCTION_FINALIZE_OK=${expectedSha}`);
