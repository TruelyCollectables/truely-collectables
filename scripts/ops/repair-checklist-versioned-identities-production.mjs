import fs from "node:fs";
import path from "node:path";

const ACCESS_TOKEN = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const EVIDENCE_DIR = path.resolve(
  process.env.EVIDENCE_DIR ||
    "evidence/checklist-versioned-identity-repair-production",
);
const API_ORIGIN = "https://api.supabase.com";
const MIGRATION_NAME =
  "20260801134500_checklist_registry_repair_printing_filter.sql";
const MIGRATION_PATH = path.resolve("supabase", "migrations", MIGRATION_NAME);
const EXPECTED_ACTIVE_VERSIONS = 272;
const EXPECTED_TOTAL_IDENTITIES = 33357;
const EXPECTED_OVER_REPAIRED_IDENTITIES = 36387;
const EXPECTED_INVALID_REPAIR_ROWS = 3030;

const TARGETS = [
  {
    setId: "SV5K",
    releaseId: "1c0f14b1-b0dd-4269-8e47-9ec6d682c1b7",
    expectedCards: 100,
    expectedIdentities: 100,
  },
  {
    setId: "SV8",
    releaseId: "d7cd0f26-1e21-4e21-9885-abf5348b0abd",
    expectedCards: 138,
    expectedIdentities: 138,
  },
  {
    setId: "M-P",
    releaseId: "9ac4168d-07c5-4393-96b0-d55abe3b9b4e",
    expectedCards: 114,
    expectedIdentities: 114,
  },
];

function writeJson(filename, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

function safeError(error) {
  return String(error instanceof Error ? error.stack || error.message : error)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .slice(0, 12000);
}

async function api(pathname, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`${API_ORIGIN}${pathname}`, {
        method: options.method || "GET",
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const text = await response.text();
      if (!response.ok) {
        const error = new Error(
          `Supabase Management API ${response.status}: ${text.slice(0, 1200)}`,
        );
        if ((response.status !== 429 && response.status < 500) || attempt === 5) {
          throw error;
        }
        lastError = error;
      } else {
        return text ? JSON.parse(text) : null;
      }
    } catch (error) {
      lastError = error;
      if (attempt === 5) break;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function query(projectRef, sql, readOnly) {
  return api(`/v1/projects/${encodeURIComponent(projectRef)}/database/query`, {
    method: "POST",
    body: { query: sql, parameters: [], read_only: readOnly },
  });
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
  output = `${output.slice(0, leadingLength)}${withoutLeadingComments.replace(
    /^begin\s*;/i,
    "",
  )}`;
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

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag = null;

  const push = () => {
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
      push();
      continue;
    }
    current += char;
    index += 1;
  }

  if (singleQuoted || doubleQuoted || dollarTag || blockCommentDepth > 0) {
    throw new Error("Migration ended inside a quoted SQL body.");
  }
  push();
  if (!statements.length) throw new Error("Migration produced no SQL statements.");
  return statements;
}

function maybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const targetIdsSql = TARGETS.map(
  (target) => `'${target.releaseId}'::uuid`,
).join(",");

function verificationSql() {
  return `
with version_counts as (
  select
    release_row.id as release_id,
    release_row.product_name,
    version_row.id as version_id,
    version_row.version_number,
    version_row.parser_version,
    version_row.status,
    version_row.is_active,
    version_row.normalized_card_count as expected_cards,
    (select count(*)::integer from public.checklist_cards card where card.version_id = version_row.id) as actual_cards,
    version_row.normalized_identity_count as expected_identities,
    (select count(*)::integer from public.checklist_card_identities identity_row where identity_row.version_id = version_row.id) as actual_identities
  from public.checklist_versions version_row
  join public.checklist_releases release_row on release_row.id = version_row.release_id
  where version_row.is_active
)
select json_build_object(
  'activeVersions', (select count(*) from version_counts),
  'expectedCards', (select coalesce(sum(expected_cards),0) from version_counts),
  'actualCards', (select coalesce(sum(actual_cards),0) from version_counts),
  'expectedIdentities', (select coalesce(sum(expected_identities),0) from version_counts),
  'actualIdentities', (select coalesce(sum(actual_identities),0) from version_counts),
  'mismatchVersions', coalesce((
    select json_agg(row_to_json(mismatch) order by mismatch.product_name, mismatch.version_number)
    from version_counts mismatch
    where mismatch.actual_cards <> mismatch.expected_cards
       or mismatch.actual_identities <> mismatch.expected_identities
  ), '[]'::json),
  'targets', coalesce((
    select json_agg(row_to_json(target) order by target.product_name)
    from version_counts target
    where target.release_id in (${targetIdsSql})
  ), '[]'::json),
  'globalFingerprintConstraint', exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.checklist_card_identities'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) ~* '^UNIQUE \\(identity_schema, fingerprint_sha256\\)$'
  ),
  'versionScopedIndex', exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'checklist_card_identities'
      and indexname = 'checklist_card_identities_version_fingerprint_unique'
      and indexdef like '%version_id%identity_schema%fingerprint_sha256%'
  ),
  'repairRpc', to_regprocedure('public.tcos_repair_active_checklist_identities(uuid[])') is not null,
  'jsonHelper', to_regprocedure('public.tcos_checklist_try_jsonb(text)') is not null,
  'writerSilentlySkips', pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  ) ~* 'on conflict\\s*\\(identity_schema,\\s*fingerprint_sha256\\)\\s*do nothing'
) as state;
`;
}

async function discoverProject() {
  const response = await api("/v1/projects");
  const projects = Array.isArray(response)
    ? response
    : Array.isArray(response?.projects)
      ? response.projects
      : [];
  const matches = [];
  let inspectedProjects = 0;

  for (const project of projects) {
    const projectRef = String(project?.id || project?.ref || "").trim();
    if (!projectRef) continue;
    inspectedProjects += 1;
    try {
      const installed = await query(
        projectRef,
        "select to_regclass('public.checklist_releases') is not null as installed;",
        true,
      );
      if (installed?.[0]?.installed !== true) continue;
      const rows = await query(
        projectRef,
        `select count(*)::integer as matching_releases from public.checklist_releases where id in (${targetIdsSql});`,
        true,
      );
      if (Number(rows?.[0]?.matching_releases || 0) === TARGETS.length) {
        matches.push(projectRef);
      }
    } catch {
      // A project that cannot prove all three known releases is not eligible.
    }
  }

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Supabase project containing all three known Registry releases; found ${matches.length}.`,
    );
  }
  return { projectRef: matches[0], inspectedProjects };
}

function assertTargetCounts(state) {
  const targets = Array.isArray(state?.targets) ? state.targets : [];
  for (const expected of TARGETS) {
    const row = targets.find(
      (candidate) => String(candidate.release_id) === expected.releaseId,
    );
    if (!row) throw new Error(`Missing active target ${expected.setId}.`);
    if (row.is_active !== true || row.status !== "live") {
      throw new Error(`${expected.setId} is not active and live.`);
    }
    if (
      Number(row.expected_cards) !== expected.expectedCards ||
      Number(row.actual_cards) !== expected.expectedCards ||
      Number(row.expected_identities) !== expected.expectedIdentities ||
      Number(row.actual_identities) !== expected.expectedIdentities
    ) {
      throw new Error(`${expected.setId} row counts are incorrect: ${JSON.stringify(row)}`);
    }
  }
}

function assertAfter(state) {
  if (Number(state?.activeVersions) !== EXPECTED_ACTIVE_VERSIONS) {
    throw new Error(`Unexpected active version count: ${state?.activeVersions}`);
  }
  if (
    Number(state?.expectedCards) !== Number(state?.actualCards) ||
    Number(state?.expectedIdentities) !== EXPECTED_TOTAL_IDENTITIES ||
    Number(state?.actualIdentities) !== EXPECTED_TOTAL_IDENTITIES
  ) {
    throw new Error(`Production Registry totals are incorrect: ${JSON.stringify(state)}`);
  }
  if (!Array.isArray(state?.mismatchVersions) || state.mismatchVersions.length !== 0) {
    throw new Error(`Active Registry versions remain mismatched: ${JSON.stringify(state?.mismatchVersions)}`);
  }
  if (
    state.globalFingerprintConstraint !== false ||
    state.versionScopedIndex !== true ||
    state.repairRpc !== true ||
    state.jsonHelper !== true ||
    state.writerSilentlySkips !== false
  ) {
    throw new Error(`Registry writer contract is incorrect: ${JSON.stringify(state)}`);
  }
  assertTargetCounts(state);
}

async function main() {
  if (!ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN secret is unavailable.");
  if (!fs.existsSync(MIGRATION_PATH)) {
    throw new Error(`Missing migration ${MIGRATION_PATH}.`);
  }

  const discovery = await discoverProject();
  const projectRef = discovery.projectRef;
  const before = maybeJson(
    (await query(projectRef, verificationSql(), true))?.[0]?.state,
  );

  const beforeActual = Number(before?.actualIdentities);
  const firstCleanup = beforeActual === EXPECTED_OVER_REPAIRED_IDENTITIES;
  const alreadyClean = beforeActual === EXPECTED_TOTAL_IDENTITIES;
  if (
    Number(before?.activeVersions) !== EXPECTED_ACTIVE_VERSIONS ||
    Number(before?.expectedIdentities) !== EXPECTED_TOTAL_IDENTITIES ||
    (!firstCleanup && !alreadyClean)
  ) {
    throw new Error(`Unexpected pre-repair Production state: ${JSON.stringify(before)}`);
  }

  const statements = splitSqlStatements(
    removeLeadingTransactionWrapper(fs.readFileSync(MIGRATION_PATH, "utf8")),
  );
  let appliedStatements = 0;
  for (const statement of statements) {
    await query(projectRef, statement, false);
    appliedStatements += 1;
  }

  const repair = maybeJson(
    (
      await query(
        projectRef,
        "select public.tcos_repair_active_checklist_identities() as repair;",
        false,
      )
    )?.[0]?.repair,
  );
  const expectedRemoved = firstCleanup ? EXPECTED_INVALID_REPAIR_ROWS : 0;
  if (
    !repair ||
    repair.ok !== true ||
    Number(repair.removedInvalidIdentities) !== expectedRemoved ||
    Number(repair.insertedIdentities) !== 0 ||
    !Array.isArray(repair.unresolvedVersions) ||
    repair.unresolvedVersions.length !== 0
  ) {
    throw new Error(`Printing-aware Production repair failed: ${JSON.stringify(repair)}`);
  }

  const idempotence = maybeJson(
    (
      await query(
        projectRef,
        "select public.tcos_repair_active_checklist_identities() as repair;",
        false,
      )
    )?.[0]?.repair,
  );
  if (
    !idempotence ||
    idempotence.ok !== true ||
    Number(idempotence.removedInvalidIdentities) !== 0 ||
    Number(idempotence.insertedIdentities) !== 0 ||
    !Array.isArray(idempotence.unresolvedVersions) ||
    idempotence.unresolvedVersions.length !== 0
  ) {
    throw new Error(`Second Production repair was not idempotent: ${JSON.stringify(idempotence)}`);
  }

  const after = maybeJson(
    (await query(projectRef, verificationSql(), true))?.[0]?.state,
  );
  assertAfter(after);

  const receipt = {
    schema: "tcos.checklist.printingAwareIdentityProductionRepair.v1",
    repairedAt: new Date().toISOString(),
    sourceSha: process.env.GITHUB_SHA || null,
    projectRef,
    inspectedProjects: discovery.inspectedProjects,
    migration: MIGRATION_NAME,
    appliedStatements,
    before,
    repair,
    idempotence,
    after,
    ok: true,
  };
  writeJson("production-receipt.json", receipt);
  console.log(
    JSON.stringify(
      {
        ok: true,
        projectRef,
        appliedStatements,
        removedInvalidIdentities: repair.removedInvalidIdentities,
        insertedIdentities: repair.insertedIdentities,
        activeVersions: after.activeVersions,
        expectedIdentities: after.expectedIdentities,
        actualIdentities: after.actualIdentities,
        mismatchVersions: after.mismatchVersions,
        targets: after.targets,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const failure = {
    schema: "tcos.checklist.printingAwareIdentityProductionRepairFailure.v1",
    failedAt: new Date().toISOString(),
    sourceSha: process.env.GITHUB_SHA || null,
    error: safeError(error),
    ok: false,
  };
  writeJson("production-failure.json", failure);
  console.error(failure.error);
  process.exitCode = 1;
});
