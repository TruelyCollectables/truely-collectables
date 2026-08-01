import fs from "node:fs";
import path from "node:path";

const EXPECTED_MAIN_SHA = String(process.env.EXPECTED_MAIN_SHA || "").trim();
const SUPABASE_ACCESS_TOKEN = String(
  process.env.GH_SUPABASE_ACCESS_TOKEN || "",
).trim();
const PRODUCTION_ENV_PATH = String(process.env.PRODUCTION_ENV_PATH || "").trim();
const EVIDENCE_DIR = String(
  process.env.EVIDENCE_DIR || "evidence/instacomp-learning-registry",
).trim();

const MIGRATIONS = [
  "20260716170000_create_tcos_card_knowledge_base.sql",
  "20260725_tcos_checklist_registry_core.sql",
  "20260725_tcos_checklist_source_storage.sql",
  "20260731160500_instacomp_automatic_learning.sql",
  "20260731161500_checklist_registry_transactional_writer.sql",
];

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

function safeText(value, limit = 6000) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:service_role|anon)_key\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, limit);
}

function writeJson(filename, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

function writeFailure(params) {
  const receipt = {
    schema: "truelycollectables.instacompLearningRegistry.productionFailure.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    failedAt: new Date().toISOString(),
    migration: params.migration || null,
    statementIndex: params.statementIndex || null,
    statementCount: params.statementCount || null,
    appliedStatementCount: params.appliedStatementCount || 0,
    statementPrefix: safeText(params.statementPrefix || "", 800),
    error: safeText(params.error),
  };
  writeJson("production-failure.json", receipt);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "production-failure.md"),
    [
      "# InstaComp Learning and Checklist Registry Production failure",
      "",
      `- Source SHA: \`${receipt.sourceSha}\``,
      `- Migration: \`${receipt.migration || "unknown"}\``,
      `- Statement: ${receipt.statementIndex || "?"}/${receipt.statementCount || "?"}`,
      `- Complete statements applied before failure: ${receipt.appliedStatementCount}`,
      `- Statement prefix: \`${receipt.statementPrefix.replace(/`/g, "\\`")}\``,
      "",
      "```text",
      receipt.error,
      "```",
      "",
    ].join("\n"),
  );
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
  const withoutComments = statement
    .replace(/--[^\n]*(?:\n|$)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/;/g, " ")
    .trim();
  return Boolean(withoutComments);
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

async function main() {
  if (!EXPECTED_MAIN_SHA || !SUPABASE_ACCESS_TOKEN || !PRODUCTION_ENV_PATH) {
    throw new Error("Production migration runner environment is incomplete.");
  }

  const productionEnv = parseDotEnv(PRODUCTION_ENV_PATH);
  const productionUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "");
  if (!/^https:\/\//.test(productionUrl)) {
    throw new Error("Production NEXT_PUBLIC_SUPABASE_URL was not pulled.");
  }
  const projectRef = new URL(productionUrl).hostname.split(".")[0];
  if (!projectRef) throw new Error("Could not resolve the Production Supabase project.");

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const request = async (query, readOnly) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Supabase query failed with HTTP ${response.status}: ${safeText(body)}`,
      );
    }
    return body ? JSON.parse(body) : [];
  };

  const probe = splitSqlStatements(
    "do $probe$ begin perform ';'; perform 1; end; $probe$; select 1;",
    "splitter-probe",
  );
  if (probe.length !== 2) {
    throw new Error(`SQL splitter probe returned ${probe.length} statements.`);
  }

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

  const before = await request(
    `select json_build_object(
      'saved_scans', (select count(*) from public.instacomp_scans),
      'knowledge_entries_installed', to_regclass('public.tcos_card_knowledge_entries') is not null,
      'registry_installed', to_regclass('public.checklist_releases') is not null,
      'learning_cache_installed', to_regclass('public.instacomp_scan_knowledge_cache') is not null,
      'auto_learning_trigger_installed', exists (
        select 1 from pg_trigger
        where tgname = 'instacomp_scans_auto_learning' and not tgisinternal
      )
    ) as state;`,
    true,
  );

  let appliedStatementCount = 0;
  for (const migration of migrationStatements) {
    console.log(
      `Applying ${migration.name} (${migration.statements.length} complete statements)`,
    );
    for (let index = 0; index < migration.statements.length; index += 1) {
      const statement = migration.statements[index];
      try {
        await request(statement, false);
        appliedStatementCount += 1;
      } catch (error) {
        writeFailure({
          migration: migration.name,
          statementIndex: index + 1,
          statementCount: migration.statements.length,
          appliedStatementCount,
          statementPrefix: statement.replace(/\s+/g, " ").slice(0, 800),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }

  const after = await request(
    `select json_build_object(
      'saved_scans', (select count(*) from public.instacomp_scans),
      'knowledge_entries', (select count(*) from public.tcos_card_knowledge_entries),
      'knowledge_observations', (select count(*) from public.tcos_card_knowledge_observations),
      'trusted_entries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'tcos_trusted'),
      'learning_entries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'learning'),
      'review_entries', (select count(*) from public.tcos_card_knowledge_entries where trust_status = 'needs_review'),
      'scan_cache_rows', (select count(*) from public.instacomp_scan_knowledge_cache),
      'registry_tables', (
        select count(*) from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relkind = 'r'
          and relation.relname like 'checklist\\_%' escape '\\'
      ),
      'registry_public_grants', (
        select count(*) from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name like 'checklist\\_%' escape '\\'
          and grantee in ('anon','authenticated')
      ),
      'registry_releases', (select count(*) from public.checklist_releases),
      'registry_cards', (select count(*) from public.checklist_cards),
      'registry_identities', (select count(*) from public.checklist_card_identities),
      'private_source_bucket', exists (
        select 1 from storage.buckets
        where id = 'tcos-checklist-source-files'
          and public = false
          and file_size_limit = 52428800
      ),
      'auto_learning_trigger', exists (
        select 1 from pg_trigger trigger_row
        join pg_class relation on relation.oid = trigger_row.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'instacomp_scans'
          and trigger_row.tgname = 'instacomp_scans_auto_learning'
          and not trigger_row.tgisinternal
      ),
      'confirm_rpc', to_regprocedure('public.tcos_instacomp_confirm_scan_knowledge(text,jsonb,text)') is not null,
      'cache_replay_rpc', to_regprocedure('public.tcos_instacomp_record_cache_replay(uuid,text,uuid,text,uuid)') is not null,
      'registry_import_rpc', to_regprocedure('public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)') is not null,
      'unlearned_saved_scans', (
        select count(*)
        from public.instacomp_scans scan
        left join public.tcos_card_knowledge_observations observation
          on observation.observation_key = 'scan:' || scan.id::text
        where observation.id is null
      )
    ) as state;`,
    true,
  );

  const state = after?.[0]?.state;
  if (!state) throw new Error("Post-migration verification returned no state.");
  const blockers = [];
  if (Number(state.registry_tables) !== 25) {
    blockers.push(`registry_tables=${state.registry_tables}`);
  }
  if (Number(state.registry_public_grants) !== 0) {
    blockers.push(`registry_public_grants=${state.registry_public_grants}`);
  }
  if (Number(state.unlearned_saved_scans) !== 0) {
    blockers.push(`unlearned_saved_scans=${state.unlearned_saved_scans}`);
  }
  if (state.private_source_bucket !== true) blockers.push("private_source_bucket=false");
  if (state.auto_learning_trigger !== true) blockers.push("auto_learning_trigger=false");
  if (state.confirm_rpc !== true) blockers.push("confirm_rpc=false");
  if (state.cache_replay_rpc !== true) blockers.push("cache_replay_rpc=false");
  if (state.registry_import_rpc !== true) blockers.push("registry_import_rpc=false");
  if (Number(state.knowledge_observations) < Number(state.saved_scans)) {
    blockers.push(
      `knowledge_observations=${state.knowledge_observations}<saved_scans=${state.saved_scans}`,
    );
  }
  if (blockers.length) {
    const error = `Production schema verification failed: ${blockers.join(", ")}`;
    writeFailure({ appliedStatementCount, error });
    throw new Error(error);
  }

  const receipt = {
    schema: "truelycollectables.instacompLearningRegistry.production.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    appliedAt: new Date().toISOString(),
    idempotentStatementChain: true,
    appliedStatementCount,
    migrations: MIGRATIONS,
    before: before?.[0]?.state || null,
    after: state,
    blockers: [],
  };
  writeJson("production-receipt.json", receipt);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "production-receipt.md"),
    [
      "# InstaComp Learning and Checklist Registry Production receipt",
      "",
      `- Source SHA: \`${receipt.sourceSha}\``,
      "- Applied as an idempotent complete-statement chain: true",
      `- Complete SQL statements applied: ${appliedStatementCount}`,
      `- Saved scans: ${state.saved_scans}`,
      `- Knowledge observations: ${state.knowledge_observations}`,
      `- Trusted identities: ${state.trusted_entries}`,
      `- Learning identities: ${state.learning_entries}`,
      `- Registry tables: ${state.registry_tables}`,
      `- Registry releases imported: ${state.registry_releases}`,
      `- Registry exact identities imported: ${state.registry_identities}`,
      "- Private source bucket: verified",
      "- Automatic scan-learning trigger: verified",
      "- Unlearned saved scans: 0",
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify({ ok: true, appliedStatementCount, state }, null, 2));
}

main().catch((error) => {
  if (!fs.existsSync(path.join(EVIDENCE_DIR, "production-failure.json"))) {
    writeFailure({ error: error instanceof Error ? error.message : String(error) });
  }
  console.error(safeText(error instanceof Error ? error.stack || error.message : error));
  process.exitCode = 1;
});
