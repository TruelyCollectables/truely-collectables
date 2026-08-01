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
    .slice(0, limit);
}

function writeJson(filename, payload) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, filename),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

const STATEMENTS = [
  `create or replace function public.tcos_instacomp_normalize_knowledge_entry_json()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
  as $$
  begin
    new.ai_result := case when jsonb_typeof(new.ai_result) = 'object' then new.ai_result else '{}'::jsonb end;
    new.operator_corrections := case when jsonb_typeof(new.operator_corrections) = 'object' then new.operator_corrections else '{}'::jsonb end;
    new.catalog_evidence := case when jsonb_typeof(new.catalog_evidence) = 'object' then new.catalog_evidence else '{}'::jsonb end;
    new.consensus := case when jsonb_typeof(new.consensus) = 'object' then new.consensus else '{}'::jsonb end;
    new.market_snapshot := case when jsonb_typeof(new.market_snapshot) = 'object' then new.market_snapshot else '{}'::jsonb end;
    new.source_coverage := case when jsonb_typeof(new.source_coverage) = 'array' then new.source_coverage else '[]'::jsonb end;
    new.result_payload := case when jsonb_typeof(new.result_payload) = 'object' then new.result_payload else '{}'::jsonb end;
    return new;
  end;
  $$;`,
  `drop trigger if exists tcos_card_knowledge_entries_normalize_json on public.tcos_card_knowledge_entries;`,
  `create trigger tcos_card_knowledge_entries_normalize_json
   before insert or update on public.tcos_card_knowledge_entries
   for each row execute function public.tcos_instacomp_normalize_knowledge_entry_json();`,
  `create or replace function public.tcos_instacomp_normalize_knowledge_observation_json()
  returns trigger
  language plpgsql
  set search_path = public, pg_temp
  as $$
  begin
    new.ai_result := case when jsonb_typeof(new.ai_result) = 'object' then new.ai_result else '{}'::jsonb end;
    new.operator_corrections := case when jsonb_typeof(new.operator_corrections) = 'object' then new.operator_corrections else '{}'::jsonb end;
    new.catalog_evidence := case when jsonb_typeof(new.catalog_evidence) = 'object' then new.catalog_evidence else '{}'::jsonb end;
    new.consensus := case when jsonb_typeof(new.consensus) = 'object' then new.consensus else '{}'::jsonb end;
    new.result_payload := case when jsonb_typeof(new.result_payload) = 'object' then new.result_payload else '{}'::jsonb end;
    return new;
  end;
  $$;`,
  `drop trigger if exists tcos_card_knowledge_observations_normalize_json on public.tcos_card_knowledge_observations;`,
  `create trigger tcos_card_knowledge_observations_normalize_json
   before insert or update on public.tcos_card_knowledge_observations
   for each row execute function public.tcos_instacomp_normalize_knowledge_observation_json();`,
  `revoke all on function public.tcos_instacomp_normalize_knowledge_entry_json() from public, anon, authenticated;`,
  `revoke all on function public.tcos_instacomp_normalize_knowledge_observation_json() from public, anon, authenticated;`,
];

async function main() {
  if (!EXPECTED_MAIN_SHA || !SUPABASE_ACCESS_TOKEN || !PRODUCTION_ENV_PATH) {
    throw new Error("Production JSON-guard installer environment is incomplete.");
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

  let appliedStatementCount = 0;
  for (const statement of STATEMENTS) {
    await request(statement, false);
    appliedStatementCount += 1;
  }

  const rows = await request(
    `select json_build_object(
      'entry_function', to_regprocedure('public.tcos_instacomp_normalize_knowledge_entry_json()') is not null,
      'observation_function', to_regprocedure('public.tcos_instacomp_normalize_knowledge_observation_json()') is not null,
      'entry_trigger', exists (
        select 1 from pg_trigger trigger_row
        join pg_class relation on relation.oid = trigger_row.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'tcos_card_knowledge_entries'
          and trigger_row.tgname = 'tcos_card_knowledge_entries_normalize_json'
          and not trigger_row.tgisinternal
      ),
      'observation_trigger', exists (
        select 1 from pg_trigger trigger_row
        join pg_class relation on relation.oid = trigger_row.tgrelid
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public'
          and relation.relname = 'tcos_card_knowledge_observations'
          and trigger_row.tgname = 'tcos_card_knowledge_observations_normalize_json'
          and not trigger_row.tgisinternal
      )
    ) as state;`,
    true,
  );
  const state = rows?.[0]?.state;
  if (
    !state?.entry_function ||
    !state?.observation_function ||
    !state?.entry_trigger ||
    !state?.observation_trigger
  ) {
    throw new Error(`Production JSON guards failed verification: ${JSON.stringify(state)}`);
  }

  const receipt = {
    schema: "truelycollectables.instacompKnowledgeJsonGuards.production.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    installedAt: new Date().toISOString(),
    appliedStatementCount,
    state,
  };
  writeJson("json-guard-install-receipt.json", receipt);
  console.log(JSON.stringify({ ok: true, ...receipt }, null, 2));
}

main().catch((error) => {
  const message = safeText(error instanceof Error ? error.stack || error.message : error);
  writeJson("json-guard-install-failure.json", {
    schema: "truelycollectables.instacompKnowledgeJsonGuards.productionFailure.v1",
    sourceSha: EXPECTED_MAIN_SHA,
    failedAt: new Date().toISOString(),
    error: message,
  });
  console.error(message);
  process.exitCode = 1;
});
