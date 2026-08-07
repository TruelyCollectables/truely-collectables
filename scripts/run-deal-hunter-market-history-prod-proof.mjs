import fs from "node:fs";
import path from "node:path";

const expectedMain = process.env.EXPECTED_MAIN_SHA;
const productionEnvFile = process.env.PRODUCTION_ENV_FILE;
const accessToken = process.env.GH_SUPABASE_ACCESS_TOKEN;
const evidenceDir = process.env.EVIDENCE_DIR || ".audit/deal-hunter-market-history-prod-proof";

if (!expectedMain) throw new Error("EXPECTED_MAIN_SHA is required.");
if (!productionEnvFile || !fs.existsSync(productionEnvFile)) throw new Error("Pulled Production environment file is unavailable.");
if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is unavailable.");
fs.mkdirSync(evidenceDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseEnv(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function stripOuterTransaction(sql) {
  let body = sql.trim();
  const hasBegin = /^begin\s*;/i.test(body);
  const hasCommit = /commit\s*;\s*$/i.test(body);
  if (hasBegin !== hasCommit) throw new Error("Migration has incomplete transaction wrapper.");
  if (hasBegin) body = body.replace(/^begin\s*;/i, "").replace(/commit\s*;\s*$/i, "").trim();
  if (/create\s+(?:unique\s+)?index\s+concurrently/i.test(body)) throw new Error("Concurrent index creation is not allowed in this proof.");
  return body;
}

const env = parseEnv(productionEnvFile);
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!/^https:\/\//.test(supabaseUrl)) throw new Error("Production Supabase URL missing.");
if (!serviceKey) throw new Error("Production Supabase service-role key missing.");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

function isTransient(status, text) {
  return status === 524 || status === 544 || status === 429 || status >= 500 || /timeout|temporar|connection terminated/i.test(text);
}

async function query(sql, readOnly = false, label = "query", maxAttempts = 8) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, parameters: [], read_only: readOnly }),
      });
      const text = await response.text();
      const elapsedMs = Date.now() - started;
      if (response.ok) return text ? JSON.parse(text) : [];
      const error = new Error(`${label} attempt ${attempt}/${maxAttempts}: Supabase HTTP ${response.status} after ${elapsedMs}ms: ${text.slice(0, 1000)}`);
      if (!isTransient(response.status, text) || attempt === maxAttempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts || !/timeout|fetch failed|connection|HTTP (?:429|5\d\d)/i.test(lastError.message)) throw lastError;
    }
    await sleep(Math.min(12000, attempt * 2000));
  }
  throw lastError || new Error(`${label} failed.`);
}

async function restTableExists(table) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Range: "0-0" },
  });
  if (response.ok || response.status === 206) return true;
  const text = await response.text();
  if (response.status === 404 && /PGRST205|relation|table|schema cache/i.test(text)) return false;
  throw new Error(`Production REST preflight for ${table} failed HTTP ${response.status}: ${text.slice(0, 500)}`);
}

async function tableState(requiredTables) {
  const state = {};
  for (const table of requiredTables) state[table] = await restTableExists(table);
  return state;
}

async function applyMigrationIfNeeded({ name, requiredTables }) {
  let state = await tableState(requiredTables);
  const values = requiredTables.map((table) => state[table] === true);
  if (values.every(Boolean)) return { name, applied: false, reason: "already_present_rest_verified" };
  if (values.some(Boolean)) throw new Error(`${name} is partially present in Production; refusing blind reapply: ${JSON.stringify(state)}`);

  const file = path.join("supabase", "migrations", name);
  const sql = stripOuterTransaction(fs.readFileSync(file, "utf8"));
  try {
    await query(`begin;\n${sql}\ncommit;`, false, `migration ${name}`, 1);
  } catch (error) {
    if (!/timeout|connection|HTTP (?:524|544|5\d\d)/i.test(String(error))) throw error;
    await sleep(3000);
    state = await tableState(requiredTables);
    if (requiredTables.every((table) => state[table] === true)) {
      return { name, applied: true, reason: "applied_despite_ambiguous_control_plane_timeout_rest_verified" };
    }
    if (requiredTables.some((table) => state[table] === true)) {
      throw new Error(`${name} timed out and left partial schema; refusing retry: ${JSON.stringify(state)}`);
    }
    throw error;
  }

  state = await tableState(requiredTables);
  if (!requiredTables.every((table) => state[table] === true)) throw new Error(`${name} returned success but required tables are missing: ${JSON.stringify(state)}`);
  return { name, applied: true, reason: "missing_then_applied_rest_verified" };
}

const migrationResults = [];
migrationResults.push(await applyMigrationIfNeeded({ name: "20260806_instacomp_mac_deal_hunter_scheduler.sql", requiredTables: ["tcos_deal_hunter_runs", "tcos_deal_hunter_candidates"] }));
migrationResults.push(await applyMigrationIfNeeded({ name: "20260807_instacomp_exact_card_market_history.sql", requiredTables: ["tcos_card_market_identities", "tcos_card_market_observations"] }));

const contractRows = await query(`select json_build_object(
  'runs', to_regclass('public.tcos_deal_hunter_runs') is not null,
  'candidates', to_regclass('public.tcos_deal_hunter_candidates') is not null,
  'identities', to_regclass('public.tcos_card_market_identities') is not null,
  'observations', to_regclass('public.tcos_card_market_observations') is not null,
  'updateTrigger', exists (select 1 from pg_trigger where tgrelid='public.tcos_card_market_observations'::regclass and tgname='tcos_card_market_observations_no_update' and not tgisinternal),
  'deleteTrigger', exists (select 1 from pg_trigger where tgrelid='public.tcos_card_market_observations'::regclass and tgname='tcos_card_market_observations_no_delete' and not tgisinternal)
) contract;`, true, "schema/trigger contract", 10);
const contract = contractRows?.[0]?.contract || {};
if (Object.values(contract).some((value) => value !== true)) throw new Error(`Production contract incomplete: ${JSON.stringify(contract)}`);

const testIdentity = "00000000-0000-4000-8000-000000081407";
await query(`begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare ask_count integer; sold_count integer; blocked_update boolean:=false; blocked_delete boolean:=false;
begin
  insert into public.tcos_card_market_identities (registry_identity_id,registry_fingerprint_sha256,identity_json,verification_source,first_seen_at,last_seen_at)
  values ('${testIdentity}',repeat('a',64),'{"player":"PRODUCTION_ROLLBACK_PROOF","cardNumber":"TEST"}'::jsonb,'production_rollback_proof',now(),now());
  insert into public.tcos_card_market_observations (registry_identity_id,observation_fingerprint,observation_kind,marketplace,provider_source,listing_item_id,listing_url,title,item_price,shipping_price,buyer_fees,tax,delivered_price,currency,observed_at,source_payload) values
  ('${testIdentity}',repeat('b',64),'ASK','Proof','rollback','ask-proof','https://example.invalid/ask','Rollback-only ASK',7,6,0.52,1.11,14.63,'USD',now(),'{"rollback":true}'::jsonb),
  ('${testIdentity}',repeat('c',64),'SOLD','Proof','rollback','sold-proof','https://example.invalid/sold','Rollback-only SOLD',10,0,null,null,10,'USD',now(),'{"rollback":true}'::jsonb);
  insert into public.tcos_card_market_observations (registry_identity_id,observation_fingerprint,observation_kind,marketplace,title,delivered_price,currency,observed_at)
  values ('${testIdentity}',repeat('b',64),'ASK','Proof','Duplicate ASK',99,'USD',now()) on conflict (observation_fingerprint) do nothing;
  select count(*) into ask_count from public.tcos_card_market_observations where registry_identity_id='${testIdentity}' and observation_kind='ASK';
  select count(*) into sold_count from public.tcos_card_market_observations where registry_identity_id='${testIdentity}' and observation_kind='SOLD';
  if ask_count<>1 or sold_count<>1 then raise exception 'ASK/SOLD separation or fingerprint dedupe failed'; end if;
  begin update public.tcos_card_market_observations set delivered_price=999 where registry_identity_id='${testIdentity}' and observation_kind='ASK'; exception when others then if position('append-only' in SQLERRM)>0 then blocked_update:=true; else raise; end if; end;
  if not blocked_update then raise exception 'Append-only UPDATE guard did not fire'; end if;
  begin delete from public.tcos_card_market_observations where registry_identity_id='${testIdentity}' and observation_kind='SOLD'; exception when others then if position('append-only' in SQLERRM)>0 then blocked_delete:=true; else raise; end if; end;
  if not blocked_delete then raise exception 'Append-only DELETE guard did not fire'; end if;
end $$;
rollback;`, false, "rollback-only behavior proof", 10);

const residueIdentity = await restTableExists("tcos_card_market_identities");
const residueObservation = await restTableExists("tcos_card_market_observations");
if (!residueIdentity || !residueObservation) throw new Error("Required Production history tables disappeared after rollback proof.");

async function restCount(table, filter) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1&${filter}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact", Range: "0-0" },
  });
  const text = await response.text();
  if (!response.ok && response.status !== 206) throw new Error(`Residue count failed HTTP ${response.status}: ${text.slice(0, 500)}`);
  const range = response.headers.get("content-range") || "";
  const total = range.match(/\/(\d+)$/)?.[1];
  if (total === undefined) throw new Error(`Residue count missing exact Content-Range: ${range}`);
  return Number(total);
}

const residue = {
  identityRows: await restCount("tcos_card_market_identities", `registry_identity_id=eq.${testIdentity}`),
  observationRows: await restCount("tcos_card_market_observations", `registry_identity_id=eq.${testIdentity}`),
};
if (residue.identityRows !== 0 || residue.observationRows !== 0) throw new Error(`Rollback proof left Production residue: ${JSON.stringify(residue)}`);

const receipt = { ok:true, expectedMain, migrationResults, contract, rollbackProof:{askSoldSeparated:true,duplicateFingerprintSuppressed:true,updateBlocked:true,deleteBlocked:true,syntheticResidue:residue}, completedAt:new Date().toISOString() };
fs.writeFileSync(path.join(evidenceDir,"production-db-proof.json"),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
