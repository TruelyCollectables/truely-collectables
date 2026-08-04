import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const MIGRATIONS = [
  "supabase/migrations/20260804011500_kingmaker_auto_rematch_after_checklists.sql",
  "supabase/migrations/20260804011600_fix_kingmaker_auto_rematch_trigger.sql",
];
const REGRESSION = "scripts/run-kingmaker-checklist-auto-rematch-regressions.sql";
const RECEIPT_SCHEMA = "tcos.kingmaker.beckettAutoRematchProductionReceipt.v1";
const REQUIRED_TRUE_FIELDS = [
  "trigger_present",
  "rpc_present",
  "audit_table_present",
  "audit_rls_enabled",
  "public_table_grants_revoked",
  "public_rpc_execute_revoked",
  "service_rpc_execute",
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
      `Supabase Management ${stage} failed with HTTP ${response.status}: ${text.slice(0, 1500)}`,
    );
  }
  return text ? JSON.parse(text) : [];
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] || {} : result || {};
}

function migrationReceipt(path) {
  const sql = readFileSync(path, "utf8");
  return {
    path,
    sql,
    sha256: createHash("sha256").update(sql).digest("hex"),
  };
}

function regressionSql() {
  return readFileSync(REGRESSION, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

function statsSql() {
  return `
    select
      count(*) filter (where identity_match_status = 'exact') as exact_rows,
      count(*) filter (where identity_match_status = 'ambiguous') as ambiguous_rows,
      count(*) filter (where identity_match_status = 'unmatched') as unmatched_rows,
      count(*) filter (where identity_match_status = 'not_applicable') as not_applicable_rows,
      (
        select count(*)
        from public.tcos_kingmaker_observations
        where source = 'beckett'
      ) as beckett_observations
    from public.tcos_kingmaker_price_entries;
  `;
}

function backfillSql() {
  return `
    set statement_timeout = '20min';
    do $$
    declare
      target record;
    begin
      for target in
        select distinct
          release.id as release_id,
          version.id as version_id
        from public.checklist_releases release
        join public.checklist_manufacturers manufacturer
          on manufacturer.id = release.manufacturer_id
        join public.checklist_sports sport
          on sport.id = release.sport_id
        join public.checklist_versions version
          on version.release_id = release.id
         and version.is_active
         and version.status in ('live','revised')
        where exists (
          select 1
          from public.tcos_kingmaker_price_entries entry
          join public.tcos_kingmaker_price_guides guide
            on guide.id = entry.guide_id
          where entry.entry_kind = 'card'
            and entry.validation_status <> 'rejected'
            and entry.low_observation_id is null
            and entry.high_observation_id is null
            and entry.identity_match_status in ('unmatched','ambiguous')
            and public.tcos_kingmaker_price_normalize(guide.sport) =
                public.tcos_kingmaker_price_normalize(sport.name)
            and public.tcos_kingmaker_price_normalize(entry.release_year) in (
              public.tcos_kingmaker_price_normalize(release.release_year),
              public.tcos_kingmaker_price_normalize(release.season)
            )
            and public.tcos_kingmaker_price_normalize(entry.manufacturer) =
                public.tcos_kingmaker_price_normalize(manufacturer.name)
            and public.tcos_kingmaker_price_normalize(release.product_name) in (
              public.tcos_kingmaker_price_normalize(entry.product),
              public.tcos_kingmaker_price_normalize(
                concat_ws(' ', entry.release_year, entry.product)
              )
            )
        )
      loop
        perform public.tcos_rematch_kingmaker_price_entries_for_release(
          target.release_id,
          target.version_id,
          'production_activation_backfill'
        );
      end loop;
    end;
    $$;
  `;
}

function verificationSql() {
  return `
    select
      exists (
        select 1
        from pg_trigger trigger_row
        join pg_class relation on relation.oid = trigger_row.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'checklist_versions'
          and trigger_row.tgname = 'checklist_versions_kingmaker_beckett_rematch'
          and not trigger_row.tgisinternal
      ) as trigger_present,
      to_regprocedure(
        'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)'
      ) is not null as rpc_present,
      to_regclass('public.tcos_kingmaker_beckett_rematch_runs') is not null
        as audit_table_present,
      coalesce((
        select relation.relrowsecurity
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'tcos_kingmaker_beckett_rematch_runs'
      ), false) as audit_rls_enabled,
      not exists (
        select 1
        from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'tcos_kingmaker_beckett_rematch_runs'
          and grantee in ('anon','authenticated')
      ) as public_table_grants_revoked,
      not has_function_privilege(
        'anon',
        'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)',
        'execute'
      ) and not has_function_privilege(
        'authenticated',
        'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)',
        'execute'
      ) and not exists (
        select 1
        from pg_proc procedure
        cross join lateral aclexplode(
          coalesce(procedure.proacl, acldefault('f', procedure.proowner))
        ) privilege
        where procedure.oid =
          'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)'::regprocedure
          and privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as public_rpc_execute_revoked,
      has_function_privilege(
        'service_role',
        'public.tcos_rematch_kingmaker_price_entries_for_release(uuid,uuid,text)',
        'execute'
      ) as service_rpc_execute,
      (
        select count(*)
        from public.tcos_kingmaker_beckett_rematch_runs
        where status = 'succeeded'
      ) as successful_rematch_runs,
      (
        select coalesce(sum(candidate_entries), 0)
        from public.tcos_kingmaker_beckett_rematch_runs
        where status = 'succeeded'
      ) as rematch_candidates_processed,
      (
        select coalesce(sum(exact_after), 0)
        from public.tcos_kingmaker_beckett_rematch_runs
        where status = 'succeeded'
      ) as exact_after_across_runs;
  `;
}

function assertVerification(row) {
  for (const field of REQUIRED_TRUE_FIELDS) {
    if (row?.[field] !== true) {
      throw new Error(`Production auto-rematch verification failed: ${field}.`);
    }
  }
}

async function main() {
  const envPath = process.env.PRODUCTION_ENV_FILE;
  const token = process.env.GH_SUPABASE_ACCESS_TOKEN;
  const receiptPath = resolve(
    process.cwd(),
    process.env.RECEIPT_PATH ||
      "evidence/kingmaker-auto-rematch-production-20260803/receipt.json",
  );

  if (!envPath || !token) {
    throw new Error("PRODUCTION_ENV_FILE and GH_SUPABASE_ACCESS_TOKEN are required.");
  }
  if (process.env.ALLOW_KINGMAKER_AUTO_REMATCH_APPLY !== "YES") {
    throw new Error("ALLOW_KINGMAKER_AUTO_REMATCH_APPLY=YES is required.");
  }

  const env = parseEnv(readFileSync(envPath, "utf8"));
  const project = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const migrations = MIGRATIONS.map(migrationReceipt);

  const before = firstRow(
    await queryManagement({
      project,
      token,
      query: statsSql(),
      readOnly: true,
      stage: "pre-apply statistics",
    }),
  );

  for (const migration of migrations) {
    await queryManagement({
      project,
      token,
      query: migration.sql,
      readOnly: false,
      stage: `migration apply ${migration.path}`,
    });
  }

  await queryManagement({
    project,
    token,
    query: regressionSql(),
    readOnly: false,
    stage: "synthetic unmatched-to-exact regression",
  });

  await queryManagement({
    project,
    token,
    query: backfillSql(),
    readOnly: false,
    stage: "current active-checklist backfill",
  });

  const after = firstRow(
    await queryManagement({
      project,
      token,
      query: statsSql(),
      readOnly: true,
      stage: "post-apply statistics",
    }),
  );
  const verification = firstRow(
    await queryManagement({
      project,
      token,
      query: verificationSql(),
      readOnly: true,
      stage: "read-only contract verification",
    }),
  );
  assertVerification(verification);

  if (Number(after.beckett_observations || 0) !== Number(before.beckett_observations || 0)) {
    throw new Error("Automatic rematching changed the number of promoted Beckett observations.");
  }
  if (Number(after.exact_rows || 0) < Number(before.exact_rows || 0)) {
    throw new Error("Automatic rematching reduced exact identity coverage.");
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "passed",
    generatedAt: new Date().toISOString(),
    expectedMainSha: process.env.EXPECTED_MAIN_SHA || null,
    migrations: migrations.map(({ path, sha256 }) => ({ path, sha256 })),
    regression: {
      path: REGRESSION,
      sha256: createHash("sha256")
        .update(readFileSync(REGRESSION, "utf8"))
        .digest("hex"),
      passed: true,
    },
    before: {
      exact: Number(before.exact_rows || 0),
      ambiguous: Number(before.ambiguous_rows || 0),
      unmatched: Number(before.unmatched_rows || 0),
      notApplicable: Number(before.not_applicable_rows || 0),
      beckettObservations: Number(before.beckett_observations || 0),
    },
    after: {
      exact: Number(after.exact_rows || 0),
      ambiguous: Number(after.ambiguous_rows || 0),
      unmatched: Number(after.unmatched_rows || 0),
      notApplicable: Number(after.not_applicable_rows || 0),
      beckettObservations: Number(after.beckett_observations || 0),
    },
    delta: {
      exact: Number(after.exact_rows || 0) - Number(before.exact_rows || 0),
      ambiguous: Number(after.ambiguous_rows || 0) - Number(before.ambiguous_rows || 0),
      unmatched: Number(after.unmatched_rows || 0) - Number(before.unmatched_rows || 0),
    },
    verification: Object.fromEntries(
      REQUIRED_TRUE_FIELDS.map((field) => [field, verification[field]]),
    ),
    rematchRuns: {
      successful: Number(verification.successful_rematch_runs || 0),
      candidatesProcessed: Number(verification.rematch_candidates_processed || 0),
      exactAfterAcrossRuns: Number(verification.exact_after_across_runs || 0),
    },
    pricesPromotedByThisOperation: 0,
    secretsPersisted: false,
  };

  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
