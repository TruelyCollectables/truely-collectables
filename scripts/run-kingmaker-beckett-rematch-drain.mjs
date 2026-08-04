import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RECEIPT_SCHEMA = "tcos.kingmaker.beckettAutoRematchDrainReceipt.v1";
const MIGRATION =
  "supabase/migrations/20260804024500_batch_kingmaker_auto_rematch_drain.sql";
const OPTIONAL_INDEX_NAME =
  "tcos_kingmaker_price_entries_rematch_version_idx";

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

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function queryManagement({ project, token, query, readOnly, stage }) {
  let response;
  try {
    response = await fetch(
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Supabase Management ${stage} request failed: ${message}`);
  }

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

function migrationStatusSql() {
  return `
    select
      to_regprocedure(
        'public.tcos_rematch_kingmaker_price_entries_for_release_batch(uuid,uuid,integer,text)'
      ) is not null as batch_rpc_present,
      to_regprocedure(
        'public.tcos_drain_kingmaker_price_rematch_batch(integer,text)'
      ) is not null as drain_rpc_present,
      to_regclass(
        'public.${OPTIONAL_INDEX_NAME}'
      ) is not null as optional_index_present;
  `;
}

function rematchActivitySql() {
  return `
    with rematch_activity as (
      select extract(epoch from now() - coalesce(query_start, xact_start, backend_start)) as age_seconds
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and state <> 'idle'
        and (
          query ilike '%tcos_rematch_kingmaker_price_entries_for_release%'
          or query ilike '%tcos_match_kingmaker_price_entry_ids%'
          or query ilike '%tcos_drain_kingmaker_price_rematch_batch%'
          or query ilike '%${OPTIONAL_INDEX_NAME}%'
        )
    )
    select
      count(*)::integer as active_rematch_queries,
      coalesce(max(age_seconds), 0)::numeric as oldest_rematch_seconds
    from rematch_activity;
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

function productionSafeMigration(migrationSql) {
  const startMarker =
    `create index if not exists ${OPTIONAL_INDEX_NAME}`;
  const endMarker = "    and high_observation_id is null;";
  const start = migrationSql.toLowerCase().indexOf(startMarker.toLowerCase());
  if (start < 0) {
    throw new Error("Optional KINGMAKER rematch index block was not found.");
  }
  const endStart = migrationSql.indexOf(endMarker, start);
  if (endStart < 0) {
    throw new Error("Optional KINGMAKER rematch index block end was not found.");
  }
  const end = endStart + endMarker.length;
  const stripped = `${migrationSql.slice(0, start)}-- Optional rematch lookup index intentionally skipped by the protected Production runner.\n${migrationSql.slice(end)}`;

  if (stripped.includes(OPTIONAL_INDEX_NAME)) {
    throw new Error("Optional KINGMAKER rematch index remained in Production-safe DDL.");
  }
  for (const required of [
    "tcos_rematch_kingmaker_price_entries_for_release_batch",
    "tcos_drain_kingmaker_price_rematch_batch",
    "tcos_trigger_kingmaker_beckett_rematch",
  ]) {
    if (!stripped.includes(required)) {
      throw new Error(`Production-safe migration lost required function ${required}.`);
    }
  }
  return stripped;
}

async function waitForRematchActivity({
  project,
  token,
  maxAttempts = 24,
  delayMilliseconds = 15_000,
}) {
  let latest = { active_rematch_queries: 0, oldest_rematch_seconds: 0 };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = firstRow(
      await queryManagement({
        project,
        token,
        query: rematchActivitySql(),
        readOnly: true,
        stage: `rematch activity check ${attempt}/${maxAttempts}`,
      }),
    );
    const active = numeric(latest, "active_rematch_queries");
    const oldest = Math.round(numeric(latest, "oldest_rematch_seconds"));
    if (active === 0) {
      return { attempts: attempt, activeAtCompletion: 0, oldestSeconds: oldest };
    }
    console.log(
      `Waiting for ${active} older KINGMAKER rematch transaction(s); oldest ${oldest}s.`,
    );
    if (attempt < maxAttempts) await sleep(delayMilliseconds);
  }
  throw new Error(
    `Older KINGMAKER rematch transactions did not clear after ${maxAttempts} checks; active ${numeric(latest, "active_rematch_queries")}.`,
  );
}

async function ensureBatchedMigration({ project, token, migrationSql }) {
  let status = firstRow(
    await queryManagement({
      project,
      token,
      query: migrationStatusSql(),
      readOnly: true,
      stage: "batched rematch migration status",
    }),
  );

  if (status.batch_rpc_present === true && status.drain_rpc_present === true) {
    console.log("KINGMAKER batched rematch functions are already installed.");
    return {
      mode: "already_applied",
      optionalIndexPresent: status.optional_index_present === true,
      wait: { attempts: 0, activeAtCompletion: 0, oldestSeconds: 0 },
      productionSafeSha256: null,
    };
  }

  const wait = await waitForRematchActivity({ project, token });
  const safeMigration = productionSafeMigration(migrationSql);
  await queryManagement({
    project,
    token,
    query: safeMigration,
    readOnly: false,
    stage: "Production-safe batched rematch migration",
  });

  status = firstRow(
    await queryManagement({
      project,
      token,
      query: migrationStatusSql(),
      readOnly: true,
      stage: "post-migration batched rematch status",
    }),
  );
  if (status.batch_rpc_present !== true || status.drain_rpc_present !== true) {
    throw new Error("Production-safe batched rematch migration did not install both RPCs.");
  }

  return {
    mode: "applied_without_optional_index",
    optionalIndexPresent: status.optional_index_present === true,
    wait,
    productionSafeSha256: createHash("sha256")
      .update(safeMigration)
      .digest("hex"),
  };
}

function selfTest() {
  const migrationSql = readFileSync(MIGRATION, "utf8");
  const safeMigration = productionSafeMigration(migrationSql);
  if (safeMigration.includes(OPTIONAL_INDEX_NAME)) {
    throw new Error("Self-test found the optional index in Production-safe DDL.");
  }
  if (!migrationStatusSql().includes("batch_rpc_present")) {
    throw new Error("Self-test found an incomplete migration status query.");
  }
  if (!rematchActivitySql().includes("pid <> pg_backend_pid()")) {
    throw new Error("Self-test found an unsafe activity query.");
  }
  if (
    createHash("sha256").update(safeMigration).digest("hex") ===
    createHash("sha256").update(migrationSql).digest("hex")
  ) {
    throw new Error("Self-test expected Production-safe DDL to differ from source DDL.");
  }
  console.log("KINGMAKER Production migration setup self-test passed.");
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
  const migrationSetup = await ensureBatchedMigration({
    project,
    token,
    migrationSql,
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
      setup: migrationSetup,
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

if (process.argv.includes("--self-test")) {
  try {
    selfTest();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
} else {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
