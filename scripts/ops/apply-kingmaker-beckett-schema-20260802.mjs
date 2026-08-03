import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CORE_MIGRATION =
  "supabase/migrations/20260803030000_kingmaker_intelligence_fusion.sql";
const BECKETT_MIGRATION =
  "supabase/migrations/20260803043000_kingmaker_beckett_price_guides.sql";
const RECEIPT_SCHEMA = "tcos.kingmaker.beckettProductionSchemaReceipt.v1";
const REQUIRED_TRUE_FIELDS = [
  "observation_table",
  "five_tables",
  "rls_enabled",
  "public_table_grants_revoked",
  "service_table_grants_present",
  "match_rpc",
  "promote_rpc",
  "service_rpc_execute",
  "public_rpc_execute_revoked",
  "private_source_bucket",
  "beckett_source_allowed",
];

function parseEnv(contents) {
  const parsed = {};
  for (const raw of String(contents || "").split(/\r?\n/)) {
    const line = raw.trim();
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

function projectRef(productionUrl) {
  const match = String(productionUrl || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) throw new Error("Production Supabase URL was not pulled from Vercel.");
  return match[1];
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
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase Management ${stage} failed with HTTP ${response.status}: ${text.slice(0, 1200)}`,
    );
  }
  return text ? JSON.parse(text) : [];
}

function verificationSql() {
  return `
    select
      to_regclass('public.tcos_kingmaker_observations') is not null
        as observation_table,
      (
        select count(*) = 5
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind = 'r'
          and relation.relname like 'tcos_kingmaker_price_%'
      ) as five_tables,
      (
        select count(*) = 5
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind = 'r'
          and relation.relname like 'tcos_kingmaker_price_%'
          and relation.relrowsecurity
      ) as rls_enabled,
      not exists (
        select 1
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name like 'tcos_kingmaker_price_%'
          and grantee in ('anon', 'authenticated')
      ) as public_table_grants_revoked,
      (
        select count(*) >= 20
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name like 'tcos_kingmaker_price_%'
          and grantee = 'service_role'
      ) as service_table_grants_present,
      to_regprocedure(
        'public.tcos_match_kingmaker_price_entries(uuid)'
      ) is not null as match_rpc,
      to_regprocedure(
        'public.tcos_promote_kingmaker_price_entries(uuid)'
      ) is not null as promote_rpc,
      has_function_privilege(
        'service_role',
        'public.tcos_match_kingmaker_price_entries(uuid)',
        'execute'
      ) and has_function_privilege(
        'service_role',
        'public.tcos_promote_kingmaker_price_entries(uuid)',
        'execute'
      ) as service_rpc_execute,
      not has_function_privilege(
        'anon',
        'public.tcos_match_kingmaker_price_entries(uuid)',
        'execute'
      ) and not has_function_privilege(
        'authenticated',
        'public.tcos_match_kingmaker_price_entries(uuid)',
        'execute'
      ) and not has_function_privilege(
        'anon',
        'public.tcos_promote_kingmaker_price_entries(uuid)',
        'execute'
      ) and not has_function_privilege(
        'authenticated',
        'public.tcos_promote_kingmaker_price_entries(uuid)',
        'execute'
      ) and not exists (
        select 1
        from pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) privilege
        where procedure.oid in (
          'public.tcos_match_kingmaker_price_entries(uuid)'::regprocedure,
          'public.tcos_promote_kingmaker_price_entries(uuid)'::regprocedure
        )
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as public_rpc_execute_revoked,
      exists (
        select 1
        from storage.buckets
        where id = 'tcos-kingmaker-price-guide-sources'
          and public = false
          and file_size_limit = 524288000
          and 'application/pdf' = any(allowed_mime_types)
          and 'application/zip' = any(allowed_mime_types)
      ) as private_source_bucket,
      exists (
        select 1
        from pg_constraint constraint_row
        join pg_class relation on relation.oid = constraint_row.conrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'tcos_kingmaker_price_guides'
          and pg_get_constraintdef(constraint_row.oid) like '%source = ''beckett''%'
      ) as beckett_source_allowed,
      (select count(*) from public.tcos_kingmaker_price_guides) as guide_rows,
      (select count(*) from public.tcos_kingmaker_price_entries) as entry_rows;
  `;
}

function assertVerified(row) {
  for (const field of REQUIRED_TRUE_FIELDS) {
    if (row?.[field] !== true) {
      throw new Error(`Production KINGMAKER Beckett schema verification failed: ${field}.`);
    }
  }
}

function migrationReceipt(path) {
  const sql = readFileSync(path, "utf8");
  return {
    path,
    sql,
    sha256: createHash("sha256").update(sql).digest("hex"),
  };
}

async function main() {
  const envPath = process.env.PRODUCTION_ENV_FILE;
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const receiptPath = resolve(
    process.cwd(),
    process.env.RECEIPT_PATH ||
      "evidence/kingmaker-beckett-production-schema-20260802/receipt.json",
  );
  if (!envPath || !token) {
    throw new Error("PRODUCTION_ENV_FILE and GH_SUPABASE_ACCESS_TOKEN are required.");
  }
  if (process.env.ALLOW_KINGMAKER_BECKETT_SCHEMA_APPLY !== "YES") {
    throw new Error("ALLOW_KINGMAKER_BECKETT_SCHEMA_APPLY=YES is required.");
  }

  const core = migrationReceipt(CORE_MIGRATION);
  const beckett = migrationReceipt(BECKETT_MIGRATION);
  const env = parseEnv(readFileSync(envPath, "utf8"));
  const project = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);

  await queryManagement({
    project,
    token,
    query: core.sql,
    readOnly: false,
    stage: "KINGMAKER core migration apply",
  });
  await queryManagement({
    project,
    token,
    query: beckett.sql,
    readOnly: false,
    stage: "Beckett migration apply",
  });
  const verification = await queryManagement({
    project,
    token,
    query: verificationSql(),
    readOnly: true,
    stage: "read-only verification",
  });
  const row = Array.isArray(verification) ? verification[0] : verification;
  assertVerified(row);

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "passed",
    generatedAt: new Date().toISOString(),
    migrations: [
      { path: core.path, sha256: core.sha256 },
      { path: beckett.path, sha256: beckett.sha256 },
    ],
    expectedMainSha: process.env.EXPECTED_MAIN_SHA || null,
    verification: Object.fromEntries(
      REQUIRED_TRUE_FIELDS.map((field) => [field, row[field]]),
    ),
    stagedRows: {
      guides: Number(row.guide_rows || 0),
      entries: Number(row.entry_rows || 0),
    },
    secretsPersisted: false,
    sourceFilesUploaded: false,
  };
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
