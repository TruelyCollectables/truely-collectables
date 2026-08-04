import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RECEIPT_SCHEMA = "tcos.kingmaker.beckettAutoRematchDrainReceipt.v1";
const MIGRATION =
  "supabase/migrations/20260804024500_batch_kingmaker_auto_rematch_drain.sql";

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

function projectRef(productionUrl) {
  const match = String(productionUrl || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) {
    throw new Error("Production Supabase URL was not pulled from Vercel.");
  }
  return match[1];
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
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
      `Supabase Management ${stage} failed with HTTP ${response.status}: ${text.slice(0, 1000)}`,
    );
  }
  return text ? JSON.parse(text) : [];
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] || {} : result || {};
}

function firstValue(result) {
  const row = firstRow(result);
  return Object.values(row)[0];
}

function asJsonObject(value, stage) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to the guarded error below.
    }
  }
  throw new Error(`${stage} did not return a JSON object.`);
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
        'public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid,uuid,integer,text)'
      ) is not null as batch_rpc_present,
      to_regprocedure(
        'public.tcos_drain_kingmaker_price_rematch_batch(integer,text)'
      ) is not null as drain_rpc_present,
      not has_function_privilege(
        'anon',
        'public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid,uuid,integer,text)',
        'execute'
      ) as anon_batch_execute_revoked,
      not has_function_privilege(
        'authenticated',
        'public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid,uuid,integer,text)',
        'execute'
      ) as authenticated_batch_execute_revoked,
      not has_function_privilege(
        'anon',
        'public.tcos_drain_kingmaker_price_rematch_batch(integer,text)',
        'execute'
      ) as anon_drain_execute_revoked,
      not has_function_privilege(
        'authenticated',
        'public.tcos_drain_kingmaker_price_rematch_batch(integer,text)',
        'execute'
      ) as authenticated_drain_execute_revoked,
      has_function_privilege(
        'service_role',
        'public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid,uuid,integer,text)',
        'execute'
      ) as service_batch_execute,
      has_function_privilege(
        'service_role',
        'public.tcos_drain_kingmaker_price_rematch_batch(integer,text)',
        'execute'
      ) as service_drain_execute;
  `;
}

function drainSql(batchSize) {
  return `
    set statement_timeout = '110s';
    select public.tcos_drain_kingmaker_price_rematch_batch(
      ${batchSize},
      'scheduled_github_drain'
    ) as result;
  `;
}

function numeric(row, field) {
  const value = Number(row?.[field] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric field ${field}.`);
  return value;
}

async function main() {
  const envFile = process.env.PRODUCTION_ENV_FILE;
  const token =
    process.env.GH_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
  const receiptPath = resolve(
    process.env.RECEIPT_PATH ||
      "evidence/kingmaker-beckett-rematch-drain/receipt.json",
  );
  const batchSize = boundedInteger(
    process.env.KINGMAKER_REMATCH_BATCH_SIZE,
    500,
    1,
    1000,
    "KINGMAKER_REMATCH_BATCH_SIZE",
  );
  const maxBatches = boundedInteger(
    process.env.KINGMAKER_REMATCH_MAX_BATCHES,
    400,
    1,
    1000,
    "KINGMAKER_REMATCH_MAX_BATCHES",
  );

  if (!envFile) throw new Error("PRODUCTION_ENV_FILE is required.");
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required.");
  console.log(`::add-mask::${token}`);

  const productionEnv = parseEnv(readFileSync(envFile, "utf8"));
  const productionUrl =
    productionEnv.NEXT_PUBLIC_SUPABASE_URL || productionEnv.SUPABASE_URL;
  const project = projectRef(productionUrl);
  const migrationSql = readFileSync(MIGRATION, "utf8");

  await queryManagement({
    project,
    token,
    query: migrationSql,
    readOnly: false,
    stage: "batched rematch migration",
  });

  const verification = firstRow(
    await queryManagement({
      project,
      token,
      query: verificationSql(),
      readOnly: true,
      stage: "batched rematch verification",
    }),
  );
  for (const [field, value] of Object.entries(verification)) {
    if (value !== true) throw new Error(`Production verification failed: ${field}.`);
  }

  const before = firstRow(
    await queryManagement({
      project,
      token,
      query: statsSql(),
      readOnly: true,
      stage: "pre-drain statistics",
    }),
  );

  let batches = 0;
  let processedEntries = 0;
  let newExactMatches = 0;
  let ambiguousOutcomes = 0;
  let unmatchedOutcomes = 0;
  let idle = false;

  while (batches < maxBatches) {
    const response = await queryManagement({
      project,
      token,
      query: drainSql(batchSize),
      readOnly: false,
      stage: `rematch drain batch ${batches + 1}`,
    });
    const result = asJsonObject(firstValue(response), "Rematch drain batch");

    if (result.drain_status === "idle") {
      idle = true;
      break;
    }
    if (result.drain_status !== "processed" || result.status !== "succeeded") {
      throw new Error("Rematch drain returned a non-success state.");
    }

    const processed = numeric(result, "processed_entries");
    if (processed < 1 || processed > batchSize) {
      throw new Error(`Rematch drain processed an invalid batch size: ${processed}.`);
    }

    batches += 1;
    processedEntries += processed;
    newExactMatches += numeric(result, "new_exact_matches");
    ambiguousOutcomes += numeric(result, "ambiguous_after");
    unmatchedOutcomes += numeric(result, "unmatched_after");
    console.log(
      `KINGMAKER Beckett rematch batch ${batches}: processed ${processed}, exact ${numeric(result, "new_exact_matches")}.`,
    );
  }

  const after = firstRow(
    await queryManagement({
      project,
      token,
      query: statsSql(),
      readOnly: true,
      stage: "post-drain statistics",
    }),
  );

  const beforeObservations = numeric(before, "beckett_observations");
  const afterObservations = numeric(after, "beckett_observations");
  const beforeExact = numeric(before, "exact_rows");
  const afterExact = numeric(after, "exact_rows");
  if (afterObservations !== beforeObservations) {
    throw new Error("Automatic rematching changed Beckett observation count.");
  }
  if (afterExact < beforeExact) {
    throw new Error("Automatic rematching decreased exact identity coverage.");
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: idle ? "passed" : "partial",
    generatedAt: new Date().toISOString(),
    migration: {
      path: MIGRATION,
      sha256: createHash("sha256").update(migrationSql).digest("hex"),
    },
    configuration: { batchSize, maxBatches },
    drain: {
      batches,
      processedEntries,
      newExactMatches,
      ambiguousOutcomes,
      unmatchedOutcomes,
      idle,
      hasMore: !idle,
    },
    before: {
      exact: beforeExact,
      ambiguous: numeric(before, "ambiguous_rows"),
      unmatched: numeric(before, "unmatched_rows"),
      notApplicable: numeric(before, "not_applicable_rows"),
      beckettObservations: beforeObservations,
    },
    after: {
      exact: afterExact,
      ambiguous: numeric(after, "ambiguous_rows"),
      unmatched: numeric(after, "unmatched_rows"),
      notApplicable: numeric(after, "not_applicable_rows"),
      beckettObservations: afterObservations,
    },
    verification,
    pricesPromotedByThisOperation: 0,
    secretsPersisted: false,
  };

  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    `KINGMAKER Beckett rematch drain ${receipt.status}: ${processedEntries} rows across ${batches} batches.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
