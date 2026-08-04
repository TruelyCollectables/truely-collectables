import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const MIGRATION_PATH =
  "supabase/migrations/20260804034500_kingmaker_private_pricing_coverage.sql";
const RECEIPT_PATH = resolve(
  process.env.RECEIPT_PATH ||
    "evidence/kingmaker-private-pricing-coverage-production-20260803/receipt.json",
);
const ENVIRONMENT_VARIABLE = "SUPABASE_SERVICE_ROLE_KEY";

function parseEnv(contents) {
  const parsed = {};
  for (const raw of String(contents || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim().replace(/^export\s+/, "");
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

function projectRef(url) {
  const match = String(url || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) throw new Error("Production database URL was not resolved.");
  return match[1];
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] || {} : result || {};
}

function jsonObject(value, label) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }
  if (Array.isArray(value) && value.length === 1) {
    return jsonObject(value[0], label);
  }
  throw new Error(`${label} did not return an object.`);
}

function numeric(row, field) {
  const value = Number(row?.[field] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric field ${field}.`);
  return value;
}

function maskText(value, secrets = []) {
  let output = String(value || "");
  for (const secret of secrets.filter(Boolean)) {
    output = output.split(secret).join("[masked]");
  }
  return output
    .replace(/(?:eyJ|sb_secret_)[A-Za-z0-9._-]{20,}/g, "[masked]")
    .replace(/[A-Za-z0-9_-]{60,}/g, "[masked]")
    .slice(0, 1200);
}

function runVercel(args, { input, secrets = [], allowFailure = false } = {}) {
  const result = spawnSync(
    "npx",
    [
      "vercel@56.2.0",
      ...args,
      "--scope",
      process.env.VERCEL_SCOPE,
      "--token",
      process.env.VERCEL_TOKEN,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input,
      maxBuffer: 30 * 1024 * 1024,
    },
  );

  if (result.error || result.status !== 0) {
    if (allowFailure) return result;
    const diagnostics = maskText(
      `${result.stdout || ""}\n${result.stderr || ""}`,
      secrets,
    );
    throw new Error(
      `Vercel command failed with exit status ${result.status ?? "unknown"}: ${diagnostics}`,
    );
  }
  return result;
}

function configureVercelServiceKey(serviceKey) {
  const input = `${serviceKey}\n`;
  const common = [ENVIRONMENT_VARIABLE, "production", "--sensitive"];
  const addResult = runVercel(["env", "add", ...common], {
    input,
    secrets: [serviceKey],
    allowFailure: true,
  });
  if (!addResult.error && addResult.status === 0) return "added";

  const updateResult = runVercel(["env", "update", ...common], {
    input,
    secrets: [serviceKey],
    allowFailure: true,
  });
  if (!updateResult.error && updateResult.status === 0) return "updated";

  const diagnostics = maskText(
    [
      "add:",
      addResult.stdout,
      addResult.stderr,
      "update:",
      updateResult.stdout,
      updateResult.stderr,
    ].join("\n"),
    [serviceKey],
  );
  throw new Error(`Vercel environment provisioning failed: ${diagnostics}`);
}

function deployProduction() {
  runVercel(["deploy", "--prod", "--yes", "--force"]);
  return true;
}

async function queryManagement({ project, token, query, readOnly, stage }) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
      signal: AbortSignal.timeout(119_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Production ${stage} failed with HTTP ${response.status}: ${text.slice(0, 800)}`,
    );
  }
  return text ? JSON.parse(text) : [];
}

async function fetchProjectServiceKey(project, token) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(60_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Production API-key resolution failed with HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  const keys = text ? JSON.parse(text) : [];
  if (!Array.isArray(keys)) {
    throw new Error("Production API-key resolution returned an invalid payload.");
  }
  const exact = keys.find(
    (key) =>
      String(key?.name || "").toLowerCase() === "service_role" &&
      typeof key?.api_key === "string" &&
      key.api_key.length > 20,
  );
  const secret = keys.find(
    (key) =>
      String(key?.type || "").toLowerCase() === "secret" &&
      typeof key?.api_key === "string" &&
      key.api_key.length > 20,
  );
  const selected = exact || secret;
  if (!selected) {
    throw new Error("No protected server API key was available for Production.");
  }
  return selected.api_key;
}

async function callServiceRpc(productionUrl, serviceKey) {
  const response = await fetch(
    `${productionUrl.replace(/\/$/, "")}/rest/v1/rpc/tcos_kingmaker_private_pricing_coverage_report`,
    {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        p_limit: 100,
        p_offset: 0,
        p_gap_type: null,
        p_sport: null,
        p_search: null,
      }),
      signal: AbortSignal.timeout(119_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Production service-role coverage RPC failed with HTTP ${response.status}: ${text.slice(0, 800)}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

function statsSql() {
  return `
    select
      count(*)::bigint as total_rows,
      count(*) filter (where identity_match_status = 'exact')::bigint as exact_rows,
      count(*) filter (where identity_match_status = 'ambiguous')::bigint as ambiguous_rows,
      count(*) filter (where identity_match_status = 'unmatched')::bigint as unmatched_rows,
      count(*) filter (where identity_match_status = 'not_applicable')::bigint as not_applicable_rows,
      count(*) filter (
        where low_observation_id is not null or high_observation_id is not null
      )::bigint as linked_observation_rows
    from public.tcos_kingmaker_price_entries;
  `;
}

function verificationSql() {
  return `
    select
      to_regprocedure(
        'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)'
      ) is not null as report_rpc_present,
      to_regclass(
        'public.tcos_kingmaker_price_entries_private_coverage_idx'
      ) is not null as coverage_index_present,
      not has_function_privilege(
        'anon',
        'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
        'execute'
      ) as anon_execute_revoked,
      not has_function_privilege(
        'authenticated',
        'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
        'execute'
      ) as authenticated_execute_revoked,
      has_function_privilege(
        'service_role',
        'public.tcos_kingmaker_private_pricing_coverage_report(integer,integer,text,text,text)',
        'execute'
      ) as service_execute_granted;
  `;
}

function assertNoPrivateFields(value) {
  const serialized = JSON.stringify(value).toLowerCase();
  for (const forbidden of [
    "raw_text",
    "original_filename",
    "source_sha256",
    "value_low",
    "value_high",
    "storage_object_path",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Coverage receipt contains prohibited field ${forbidden}.`);
    }
  }
}

async function main() {
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const envFile = process.env.PRODUCTION_ENV_FILE;
  if (
    !token ||
    !envFile ||
    !process.env.VERCEL_TOKEN ||
    !process.env.VERCEL_SCOPE
  ) {
    throw new Error("Protected Production credentials are required.");
  }
  console.log(`::add-mask::${token}`);

  const productionEnv = parseEnv(readFileSync(envFile, "utf8"));
  const productionUrl =
    productionEnv.NEXT_PUBLIC_SUPABASE_URL || productionEnv.SUPABASE_URL;
  if (!productionUrl) {
    throw new Error("Production database URL was not resolved.");
  }
  const project = projectRef(productionUrl);
  let serviceKey = productionEnv[ENVIRONMENT_VARIABLE];
  let serviceKeyProvisioning = "existing";
  if (!serviceKey) {
    serviceKey = await fetchProjectServiceKey(project, token);
    console.log(`::add-mask::${serviceKey}`);
    serviceKeyProvisioning = configureVercelServiceKey(serviceKey);
  } else {
    console.log(`::add-mask::${serviceKey}`);
  }

  const migrationSql = readFileSync(MIGRATION_PATH, "utf8");
  const before = firstRow(
    await queryManagement({
      project,
      token,
      query: statsSql(),
      readOnly: true,
      stage: "pre-apply statistics",
    }),
  );

  await queryManagement({
    project,
    token,
    query: migrationSql,
    readOnly: false,
    stage: "coverage migration",
  });

  const verification = firstRow(
    await queryManagement({
      project,
      token,
      query: verificationSql(),
      readOnly: true,
      stage: "coverage verification",
    }),
  );
  for (const [field, value] of Object.entries(verification)) {
    if (value !== true) {
      throw new Error(`Production verification failed: ${field}.`);
    }
  }

  const report = jsonObject(
    await callServiceRpc(productionUrl, serviceKey),
    "Coverage report",
  );
  if (report.boundary !== "aggregate_private_reference_only") {
    throw new Error("Coverage report boundary verification failed.");
  }
  assertNoPrivateFields(report);

  const after = firstRow(
    await queryManagement({
      project,
      token,
      query: statsSql(),
      readOnly: true,
      stage: "post-apply statistics",
    }),
  );
  for (const field of [
    "total_rows",
    "exact_rows",
    "ambiguous_rows",
    "unmatched_rows",
    "not_applicable_rows",
    "linked_observation_rows",
  ]) {
    if (numeric(after, field) !== numeric(before, field)) {
      throw new Error(`Coverage reporting changed Production field ${field}.`);
    }
  }

  const productionDeploymentCompleted = deployProduction();
  const receipt = {
    schema: "tcos.kingmaker.privatePricingCoverageProductionReceipt.v1",
    status: "passed",
    generatedAt: new Date().toISOString(),
    deployedCommit: process.env.EXPECTED_MAIN_SHA,
    migration: {
      path: MIGRATION_PATH,
      sha256: createHash("sha256").update(migrationSql).digest("hex"),
    },
    before: {
      totalRows: numeric(before, "total_rows"),
      exact: numeric(before, "exact_rows"),
      ambiguous: numeric(before, "ambiguous_rows"),
      unmatched: numeric(before, "unmatched_rows"),
      notApplicable: numeric(before, "not_applicable_rows"),
      linkedObservationRows: numeric(before, "linked_observation_rows"),
    },
    after: {
      totalRows: numeric(after, "total_rows"),
      exact: numeric(after, "exact_rows"),
      ambiguous: numeric(after, "ambiguous_rows"),
      unmatched: numeric(after, "unmatched_rows"),
      notApplicable: numeric(after, "not_applicable_rows"),
      linkedObservationRows: numeric(after, "linked_observation_rows"),
    },
    coverage: {
      boundary: report.boundary,
      generatedAt: report.generatedAt,
      summary: report.summary,
      pagination: report.pagination,
      topRows: report.rows,
    },
    verification,
    serviceRoleRpcVerified: true,
    vercelProductionServiceKeyProvisioning: serviceKeyProvisioning,
    productionDeploymentCompleted,
    pricesPromotedByThisOperation: 0,
    recordsMutatedByReport: 0,
    secretsPersistedInReceipt: false,
  };
  assertNoPrivateFields(receipt);
  mkdirSync(dirname(RECEIPT_PATH), { recursive: true });
  writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    `Private pricing coverage passed: ${report.summary?.unresolvedRows || 0} unresolved rows across ${report.summary?.totalGroups || 0} ranked groups.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
