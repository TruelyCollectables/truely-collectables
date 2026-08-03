import fs from "node:fs";
import path from "node:path";

const EXPECTED_MAIN_SHA = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const SUPABASE_ACCESS_TOKEN = String(
  process.env.GH_SUPABASE_ACCESS_TOKEN || "",
).trim();
const PRODUCTION_ENV_PATH = String(process.env.PRODUCTION_ENV_PATH || "").trim();
const EVIDENCE_DIR = String(
  process.env.EVIDENCE_DIR || "evidence/pokemon-checklist-registry-20260802",
).trim();
const MODE = String(process.argv[2] || "").trim();
const BASELINE_PATH = String(process.env.BASELINE_PATH || "").trim();

const MIGRATIONS = [
  "20260725200000_tcos_checklist_registry_core.sql",
  "20260725201000_tcos_checklist_source_storage.sql",
  "20260731161500_checklist_registry_transactional_writer.sql",
  "20260801132000_checklist_registry_versioned_identities.sql",
  "20260801134500_checklist_registry_repair_printing_filter.sql",
  "20260801201000_checklist_registry_preserve_active_version.sql",
];

const TARGET_ADAPTERS = {
  incomplete: "pokemon-japanese-official-incomplete-reconciled",
  historical: "pokemon-japanese-official-historical-reconciled",
  variant: "pokemon-japanese-official-variant-reconciled",
};

function parseDotEnv(filePath) {
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function safeText(value, limit = 8000) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:service_role|anon)_key\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, limit);
}

function writeJson(filename, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const filePath = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
  return filePath;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function removeLeadingTransactionWrapper(sql) {
  let output = String(sql || "").trim();
  const withoutLeadingComments = output.replace(
    /^(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*/,
    "",
  );
  const hasBegin = /^begin\s*;/i.test(withoutLeadingComments);
  const hasCommit = /commit\s*;\s*$/i.test(output);
  if (hasBegin !== hasCommit) {
    throw new Error("Migration has an incomplete transaction wrapper.");
  }
  if (!hasBegin) return output;
  const leadingLength = output.length - withoutLeadingComments.length;
  const prefix = output.slice(0, leadingLength);
  output = `${prefix}${withoutLeadingComments.replace(/^begin\s*;/i, "")}`;
  return output.replace(/commit\s*;\s*$/i, "").trim();
}

function statementHasExecutableSql(statement) {
  return Boolean(
    statement
      .replace(/--[^\n]*(?:\n|$)/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/;/g, " ")
      .trim(),
  );
}

function splitSqlStatements(sql, migrationName) {
  const statements = [];
  let current = "";
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag = null;

  const pushStatement = () => {
    const statement = current.trim();
    current = "";
    if (!statement || !statementHasExecutableSql(statement)) return;
    if (/^(?:begin|commit|rollback)\s*;?$/i.test(statement)) return;
    statements.push(statement.endsWith(";") ? statement : `${statement};`);
  };

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1] || "";
    if (lineComment) {
      current += char;
      index += 1;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (char === "/" && next === "*") {
        current += "/*";
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (char === "*" && next === "/") {
        current += "*/";
        blockCommentDepth -= 1;
        index += 2;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        current += char;
        index += 1;
      }
      continue;
    }
    if (singleQuoted) {
      current += char;
      index += 1;
      if (char === "'" && sql[index] === "'") {
        current += "'";
        index += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      current += char;
      index += 1;
      if (char === '"' && sql[index] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      current += "--";
      lineComment = true;
      index += 2;
      continue;
    }
    if (char === "/" && next === "*") {
      current += "/*";
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (char === "'") {
      current += char;
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      current += char;
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (char === "$") {
      const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }
    if (char === ";") {
      current += char;
      index += 1;
      pushStatement();
      continue;
    }
    current += char;
    index += 1;
  }

  if (singleQuoted || doubleQuoted || dollarTag || blockCommentDepth > 0) {
    throw new Error(`Migration ${migrationName} ended inside a quoted SQL body.`);
  }
  pushStatement();
  if (!statements.length) {
    throw new Error(`Migration ${migrationName} produced no SQL statements.`);
  }
  return statements;
}

function stateQuery() {
  const adapters = Object.values(TARGET_ADAPTERS).map(sqlLiteral).join(", ");
  return `with active_versions as (
    select * from public.checklist_versions where is_active
  ), identity_counts as (
    select
      version_row.id,
      version_row.normalized_identity_count as expected_identities,
      count(identity_row.id)::bigint as actual_identities
    from active_versions version_row
    left join public.checklist_card_identities identity_row
      on identity_row.version_id = version_row.id
    group by version_row.id, version_row.normalized_identity_count
  ), adapter_counts as (
    select
      coalesce(release_row.metadata->>'latestAdapterId', '(none)') as adapter_id,
      count(*)::bigint as release_count
    from public.checklist_releases release_row
    group by coalesce(release_row.metadata->>'latestAdapterId', '(none)')
  )
  select json_build_object(
    'releases', (select count(*) from public.checklist_releases),
    'active_versions', (select count(*) from active_versions),
    'active_cards', (
      select count(*) from public.checklist_cards card_row
      join active_versions version_row on version_row.id = card_row.version_id
    ),
    'active_identities', (
      select count(*) from public.checklist_card_identities identity_row
      join active_versions version_row on version_row.id = identity_row.version_id
    ),
    'identity_deficit_versions', (
      select count(*) from identity_counts
      where actual_identities <> expected_identities
    ),
    'source_files', (select count(*) from public.checklist_source_files),
    'failed_import_runs', (
      select count(*) from public.checklist_import_runs where status = 'failed'
    ),
    'adapter_counts', coalesce((
      select jsonb_object_agg(adapter_id, release_count order by adapter_id)
      from adapter_counts
    ), '{}'::jsonb),
    'target_adapter_counts', coalesce((
      select jsonb_object_agg(adapter_id, release_count order by adapter_id)
      from adapter_counts where adapter_id in (${adapters})
    ), '{}'::jsonb),
    'writer_rpc', to_regprocedure(
      'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'
    ) is not null,
    'repair_rpc', to_regprocedure(
      'public.tcos_repair_active_checklist_identities(uuid[])'
    ) is not null,
    'private_source_bucket', exists (
      select 1 from storage.buckets
      where id = 'tcos-checklist-source-files' and public = false
    ),
    'registry_public_grants', (
      select count(*) from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name like 'checklist\\_%' escape '\\'
        and grantee in ('anon', 'authenticated')
    )
  ) as state;`;
}

function numberValue(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return number;
}

function targetCount(state, adapterId) {
  return Number(state.target_adapter_counts?.[adapterId] || 0);
}

async function createClient() {
  if (!EXPECTED_MAIN_SHA || !SUPABASE_ACCESS_TOKEN || !PRODUCTION_ENV_PATH) {
    throw new Error("Production Registry environment is incomplete.");
  }
  const productionEnv = parseDotEnv(PRODUCTION_ENV_PATH);
  const productionUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "");
  if (!/^https:\/\//.test(productionUrl)) {
    throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled.");
  }
  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Could not resolve Production Supabase project.");
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

  const request = async (query, readOnly) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
        });
        const body = await response.text();
        if (response.ok) return body ? JSON.parse(body) : [];
        const transient = response.status === 429 || response.status >= 500;
        const error = new Error(
          `Supabase query failed with HTTP ${response.status}: ${safeText(body)}`,
        );
        if (!transient || attempt === 6) throw error;
        lastError = error;
      } catch (error) {
        lastError = error;
        if (attempt === 6) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
    throw lastError || new Error("Supabase query failed without an error.");
  };
  return { request, projectRef };
}

async function readState(request) {
  const rows = await request(stateQuery(), true);
  const state = rows?.[0]?.state;
  if (!state) throw new Error("Production Registry audit returned no state.");
  return state;
}

async function recordMigrationHistory(request, migrationStatements) {
  const columnRows = await request(
    `select column_name, is_nullable, column_default
     from information_schema.columns
     where table_schema = 'supabase_migrations'
       and table_name = 'schema_migrations'
     order by ordinal_position;`,
    true,
  );
  const columns = new Map(columnRows.map((row) => [row.column_name, row]));
  if (!columns.has("version")) {
    throw new Error("Supabase migration history table has no version column.");
  }
  const supported = new Set(["version", "name", "statements"]);
  const unsupportedRequired = columnRows.filter(
    (row) =>
      row.is_nullable === "NO" &&
      row.column_default == null &&
      !supported.has(row.column_name),
  );
  if (unsupportedRequired.length) {
    throw new Error(
      `Migration history has unsupported required columns: ${unsupportedRequired
        .map((row) => row.column_name)
        .join(", ")}`,
    );
  }

  const versions = MIGRATIONS.map((name) => name.slice(0, 14));
  const existingRows = await request(
    `select version${columns.has("name") ? ", name" : ""}
     from supabase_migrations.schema_migrations
     where version in (${versions.map(sqlLiteral).join(", ")});`,
    true,
  );
  const existing = new Map(existingRows.map((row) => [String(row.version), row]));

  for (const migration of migrationStatements) {
    const version = migration.name.slice(0, 14);
    const name = migration.name.slice(15, -4);
    const row = existing.get(version);
    if (row) {
      if (columns.has("name") && row.name && String(row.name) !== name) {
        throw new Error(
          `Migration ${version} is already recorded under unexpected name ${row.name}.`,
        );
      }
      continue;
    }
    const insertColumns = ["version"];
    const insertValues = [sqlLiteral(version)];
    if (columns.has("name")) {
      insertColumns.push("name");
      insertValues.push(sqlLiteral(name));
    }
    if (columns.has("statements")) {
      insertColumns.push("statements");
      insertValues.push("ARRAY[]::text[]");
    }
    await request(
      `insert into supabase_migrations.schema_migrations (${insertColumns.join(", ")})
       values (${insertValues.join(", ")})
       on conflict (version) do nothing;`,
      false,
    );
  }

  const verifiedRows = await request(
    `select version${columns.has("name") ? ", name" : ""}
     from supabase_migrations.schema_migrations
     where version in (${versions.map(sqlLiteral).join(", ")})
     order by version;`,
    true,
  );
  if (verifiedRows.length !== MIGRATIONS.length) {
    throw new Error(
      `Only ${verifiedRows.length}/${MIGRATIONS.length} approved migrations are recorded.`,
    );
  }
  return verifiedRows;
}

async function migrateAndAudit() {
  const { request, projectRef } = await createClient();
  const migrationStatements = MIGRATIONS.map((name) => {
    const filePath = path.join("supabase", "migrations", name);
    let sql = fs.readFileSync(filePath, "utf8").trim();
    if (!sql) throw new Error(`Migration ${name} is empty.`);
    sql = removeLeadingTransactionWrapper(sql);
    if (/create\s+(?:unique\s+)?index\s+concurrently/i.test(sql)) {
      throw new Error(`Migration ${name} contains an unsupported concurrent index.`);
    }
    return { name, statements: splitSqlStatements(sql, name) };
  });

  const applied = [];
  for (const migration of migrationStatements) {
    console.log(`Applying approved migration ${migration.name}`);
    let count = 0;
    for (const statement of migration.statements) {
      await request(statement, false);
      count += 1;
    }
    applied.push({ name: migration.name, statements: count });
  }

  const repairRows = await request(
    `select public.tcos_repair_active_checklist_identities(null::uuid[]) as repair;`,
    false,
  );
  const repair = repairRows?.[0]?.repair;
  if (!repair || repair.ok !== true) {
    throw new Error(`Active identity repair failed: ${safeText(JSON.stringify(repair))}`);
  }

  const migrationHistory = await recordMigrationHistory(request, migrationStatements);
  const state = await readState(request);
  const blockers = [];
  if (numberValue(state.releases, "release count") !== 272) {
    blockers.push(`releases=${state.releases}, expected=272`);
  }
  if (numberValue(state.active_versions, "active version count") !== 272) {
    blockers.push(`active_versions=${state.active_versions}, expected=272`);
  }
  if (numberValue(state.identity_deficit_versions, "identity deficits") !== 0) {
    blockers.push(`identity_deficit_versions=${state.identity_deficit_versions}`);
  }
  if (state.writer_rpc !== true) blockers.push("writer_rpc=false");
  if (state.repair_rpc !== true) blockers.push("repair_rpc=false");
  if (state.private_source_bucket !== true) blockers.push("private_source_bucket=false");
  if (numberValue(state.registry_public_grants, "public grants") !== 0) {
    blockers.push(`registry_public_grants=${state.registry_public_grants}`);
  }
  for (const adapterId of Object.values(TARGET_ADAPTERS)) {
    if (targetCount(state, adapterId) !== 0) {
      blockers.push(`${adapterId}=${targetCount(state, adapterId)}, expected=0`);
    }
  }

  const receipt = {
    schema: "truelycollectables.pokemonChecklistRegistry.productionBaseline.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    projectRef,
    auditedAt: new Date().toISOString(),
    migrations: applied,
    migrationHistory,
    repair,
    state,
    blockers,
  };
  writeJson("production-baseline.json", receipt);
  if (blockers.length) {
    throw new Error(`Production baseline blocked: ${blockers.join(", ")}`);
  }
  console.log(JSON.stringify({ ok: true, state, repair }, null, 2));
}

async function verifyDelta() {
  if (!BASELINE_PATH) throw new Error("BASELINE_PATH is required for verify-delta.");
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  const expectedReleases = numberValue(process.env.EXPECTED_RELEASE_DELTA, "release delta");
  const expectedCards = numberValue(process.env.EXPECTED_CARD_DELTA, "card delta");
  const expectedIdentities = numberValue(
    process.env.EXPECTED_IDENTITY_DELTA,
    "identity delta",
  );
  const expectedIncomplete = numberValue(
    process.env.EXPECTED_INCOMPLETE_ADAPTER_COUNT,
    "incomplete adapter count",
  );
  const expectedHistorical = numberValue(
    process.env.EXPECTED_HISTORICAL_ADAPTER_COUNT,
    "historical adapter count",
  );
  const expectedVariant = numberValue(
    process.env.EXPECTED_VARIANT_ADAPTER_COUNT,
    "variant adapter count",
  );

  const { request } = await createClient();
  const state = await readState(request);
  const baselineState = baseline.state;
  const actual = {
    releases: numberValue(state.releases, "release count") - numberValue(baselineState.releases, "baseline releases"),
    activeVersions:
      numberValue(state.active_versions, "active versions") -
      numberValue(baselineState.active_versions, "baseline active versions"),
    cards:
      numberValue(state.active_cards, "active cards") -
      numberValue(baselineState.active_cards, "baseline active cards"),
    identities:
      numberValue(state.active_identities, "active identities") -
      numberValue(baselineState.active_identities, "baseline active identities"),
    incomplete: targetCount(state, TARGET_ADAPTERS.incomplete),
    historical: targetCount(state, TARGET_ADAPTERS.historical),
    variant: targetCount(state, TARGET_ADAPTERS.variant),
  };
  const expected = {
    releases: expectedReleases,
    activeVersions: expectedReleases,
    cards: expectedCards,
    identities: expectedIdentities,
    incomplete: expectedIncomplete,
    historical: expectedHistorical,
    variant: expectedVariant,
  };
  const blockers = [];
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) blockers.push(`${key}=${actual[key]}, expected=${value}`);
  }
  if (numberValue(state.identity_deficit_versions, "identity deficits") !== 0) {
    blockers.push(`identity_deficit_versions=${state.identity_deficit_versions}`);
  }
  if (numberValue(state.registry_public_grants, "public grants") !== 0) {
    blockers.push(`registry_public_grants=${state.registry_public_grants}`);
  }

  const label = String(process.env.VERIFICATION_LABEL || "delta").replace(
    /[^a-zA-Z0-9_-]+/g,
    "-",
  );
  const receipt = {
    schema: "truelycollectables.pokemonChecklistRegistry.productionDelta.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    verifiedAt: new Date().toISOString(),
    label,
    expected,
    actual,
    state,
    blockers,
  };
  writeJson(`production-${label}.json`, receipt);
  if (blockers.length) {
    throw new Error(`Production ${label} verification failed: ${blockers.join(", ")}`);
  }
  console.log(JSON.stringify({ ok: true, label, expected, actual }, null, 2));
}

async function main() {
  if (MODE === "migrate-audit") return migrateAndAudit();
  if (MODE === "verify-delta") return verifyDelta();
  throw new Error(`Unsupported mode: ${MODE || "(blank)"}`);
}

main().catch((error) => {
  const failure = {
    schema: "truelycollectables.pokemonChecklistRegistry.productionFailure.v1",
    sourceSha: EXPECTED_MAIN_SHA || null,
    failedAt: new Date().toISOString(),
    mode: MODE || null,
    error: safeText(error instanceof Error ? error.stack || error.message : error),
  };
  writeJson(`failure-${MODE || "unknown"}.json`, failure);
  console.error(failure.error);
  process.exitCode = 1;
});
