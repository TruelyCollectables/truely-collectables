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

const BATCH_SIZE = 100;
const MAX_BATCHES = 40;

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

function stateQuery() {
  return `select json_build_object(
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
  ) as state;`;
}

function blockersFor(state) {
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
  return blockers;
}

async function main() {
  if (!EXPECTED_MAIN_SHA || !SUPABASE_ACCESS_TOKEN || !PRODUCTION_ENV_PATH) {
    throw new Error("Production backfill repair environment is incomplete.");
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

  const beforeRows = await request(stateQuery(), true);
  const before = beforeRows?.[0]?.state;
  if (!before) throw new Error("Backfill repair returned no initial state.");

  const batches = [];
  let previousRemaining = Number(before.unlearned_saved_scans || 0);

  for (let batch = 1; batch <= MAX_BATCHES && previousRemaining > 0; batch += 1) {
    const batchSql = `do $instacomp_backfill$
    declare
      v_scan jsonb;
    begin
      for v_scan in
        select to_jsonb(scan)
        from public.instacomp_scans scan
        left join public.tcos_card_knowledge_observations observation
          on observation.observation_key = 'scan:' || scan.id::text
        where observation.id is null
        order by scan.created_at asc, scan.id asc
        limit ${BATCH_SIZE}
      loop
        begin
          perform public.tcos_instacomp_record_scan_knowledge_payload(v_scan);
        exception when others then
          raise warning 'InstaComp bounded backfill skipped scan %: %', v_scan->>'id', sqlerrm;
        end;
      end loop;
    end;
    $instacomp_backfill$;`;

    await request(batchSql, false);
    const rows = await request(stateQuery(), true);
    const state = rows?.[0]?.state;
    if (!state) throw new Error(`Backfill batch ${batch} returned no state.`);

    const remaining = Number(state.unlearned_saved_scans || 0);
    const learned = Math.max(0, previousRemaining - remaining);
    batches.push({ batch, before: previousRemaining, learned, remaining });
    console.log(
      JSON.stringify({ batch, before: previousRemaining, learned, remaining }),
    );

    if (remaining === 0) break;
    if (remaining >= previousRemaining) break;
    previousRemaining = remaining;
  }

  const afterRows = await request(stateQuery(), true);
  const after = afterRows?.[0]?.state;
  if (!after) throw new Error("Backfill repair returned no final state.");

  const blockers = blockersFor(after);
  const receipt = {
    schema: "truelycollectables.instacompLearningRegistry.backfillRepair.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    repairedAt: new Date().toISOString(),
    batchSize: BATCH_SIZE,
    batches,
    before,
    after,
    blockers,
  };
  writeJson("backfill-repair-receipt.json", receipt);

  if (blockers.length) {
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "backfill-repair-failure.md"),
      [
        "# InstaComp Production backfill repair blocked",
        "",
        `- Source SHA: \`${EXPECTED_MAIN_SHA}\``,
        `- Saved scans: ${after.saved_scans}`,
        `- Knowledge observations: ${after.knowledge_observations}`,
        `- Unlearned saved scans: ${after.unlearned_saved_scans}`,
        `- Batches attempted: ${batches.length}`,
        `- Blockers: ${blockers.join(", ")}`,
        "",
      ].join("\n"),
    );
    throw new Error(`Backfill repair failed: ${blockers.join(", ")}`);
  }

  const productionReceipt = {
    schema: "truelycollectables.instacompLearningRegistry.production.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    appliedAt: new Date().toISOString(),
    idempotentStatementChain: true,
    repairedHistoricalBackfill: true,
    batches,
    before,
    after,
    blockers: [],
  };
  writeJson("production-receipt.json", productionReceipt);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "production-receipt.md"),
    [
      "# InstaComp Learning and Checklist Registry Production receipt",
      "",
      `- Source SHA: \`${EXPECTED_MAIN_SHA}\``,
      "- Historical learning repaired in bounded per-row-failure-isolated batches: true",
      `- Backfill batches: ${batches.length}`,
      `- Saved scans: ${after.saved_scans}`,
      `- Knowledge observations: ${after.knowledge_observations}`,
      `- Trusted identities: ${after.trusted_entries}`,
      `- Learning identities: ${after.learning_entries}`,
      `- Registry tables: ${after.registry_tables}`,
      `- Registry releases imported: ${after.registry_releases}`,
      `- Registry exact identities imported: ${after.registry_identities}`,
      "- Private source bucket: verified",
      "- Automatic scan-learning trigger: verified",
      "- Unlearned saved scans: 0",
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify({ ok: true, state: after, batches }, null, 2));
}

main().catch((error) => {
  console.error(safeText(error instanceof Error ? error.stack || error.message : error));
  process.exitCode = 1;
});
