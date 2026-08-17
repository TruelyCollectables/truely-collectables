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
  const begin = /^begin\s*;/i.test(body);
  const commit = /commit\s*;\s*$/i.test(body);
  if (begin !== commit) throw new Error("Migration has incomplete transaction wrapper.");
  if (begin) body = body.replace(/^begin\s*;/i, "").replace(/commit\s*;\s*$/i, "").trim();
  if (/create\s+(?:unique\s+)?index\s+concurrently/i.test(body)) throw new Error("Concurrent index creation is not allowed in this proof.");
  return body;
}

const env = parseEnv(productionEnvFile);
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
if (!/^https:\/\//.test(supabaseUrl)) throw new Error("Production Supabase URL missing.");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

function transient(status, text) {
  return status === 429 || status === 524 || status === 544 || status >= 500 || /timeout|temporar|connection terminated/i.test(text);
}
async function query(sql, readOnly = false, label = "query", attempts = 12) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const started = Date.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, parameters: [], read_only: readOnly }),
      });
      const text = await response.text();
      const elapsed = Date.now() - started;
      if (response.ok) return text ? JSON.parse(text) : [];
      const error = new Error(`${label} attempt ${attempt}/${attempts}: HTTP ${response.status} after ${elapsed}ms: ${text.slice(0, 700)}`);
      if (!transient(response.status, text) || attempt === attempts) throw error;
      last = error;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts || !/timeout|fetch failed|connection|HTTP (?:429|5\d\d)/i.test(last.message)) throw last;
    }
    await sleep(Math.min(15000, 2000 * attempt));
  }
  throw last || new Error(`${label} failed`);
}

async function tableState(tables, label) {
  const body = tables.map((t) => `'${t}', to_regclass('public.${t}') is not null`).join(",");
  const rows = await query(`select json_build_object(${body}) state;`, true, label);
  return rows?.[0]?.state || {};
}
async function applyMigrationIfNeeded(name, tables) {
  let state = await tableState(tables, `${name} preflight`);
  const flags = tables.map((t) => state[t] === true);
  if (flags.every(Boolean)) return { name, applied: false, reason: "already_present" };
  if (flags.some(Boolean)) throw new Error(`${name} is partially present; refusing reapply: ${JSON.stringify(state)}`);
  const sql = stripOuterTransaction(fs.readFileSync(path.join("supabase", "migrations", name), "utf8"));
  try {
    await query(`begin;\n${sql}\ncommit;`, false, `migration ${name}`, 1);
  } catch (error) {
    if (!/timeout|connection|HTTP (?:524|544|5\d\d)/i.test(String(error))) throw error;
    await sleep(4000);
    state = await tableState(tables, `${name} timeout reconciliation`);
    if (tables.every((t) => state[t] === true)) return { name, applied: true, reason: "committed_before_control_plane_timeout" };
    if (tables.some((t) => state[t] === true)) throw new Error(`${name} timed out with partial schema: ${JSON.stringify(state)}`);
    throw error;
  }
  state = await tableState(tables, `${name} postflight`);
  if (!tables.every((t) => state[t] === true)) throw new Error(`${name} returned success but tables missing: ${JSON.stringify(state)}`);
  return { name, applied: true, reason: "missing_then_applied" };
}

const migrationResults = [
  await applyMigrationIfNeeded("20260806_instacomp_mac_deal_hunter_scheduler.sql", ["tcos_deal_hunter_runs", "tcos_deal_hunter_candidates"]),
  await applyMigrationIfNeeded("20260807_instacomp_exact_card_market_history.sql", ["tcos_card_market_identities", "tcos_card_market_observations"]),
];

const contractRows = await query(`select json_build_object(
 'runs',to_regclass('public.tcos_deal_hunter_runs') is not null,
 'candidates',to_regclass('public.tcos_deal_hunter_candidates') is not null,
 'identities',to_regclass('public.tcos_card_market_identities') is not null,
 'observations',to_regclass('public.tcos_card_market_observations') is not null,
 'updateTrigger',exists(select 1 from pg_trigger where tgrelid='public.tcos_card_market_observations'::regclass and tgname='tcos_card_market_observations_no_update' and not tgisinternal),
 'deleteTrigger',exists(select 1 from pg_trigger where tgrelid='public.tcos_card_market_observations'::regclass and tgname='tcos_card_market_observations_no_delete' and not tgisinternal)
) contract;`, true, "schema/trigger contract");
const contract = contractRows?.[0]?.contract || {};
if (Object.values(contract).some((v) => v !== true)) throw new Error(`Production contract incomplete: ${JSON.stringify(contract)}`);

const testIdentity = "00000000-0000-4000-8000-000000081407";
await query(`begin;
set local lock_timeout='5s'; set local statement_timeout='30s';
do $$ declare a integer; s integer; bu boolean:=false; bd boolean:=false; begin
 insert into public.tcos_card_market_identities(registry_identity_id,registry_fingerprint_sha256,identity_json,verification_source,first_seen_at,last_seen_at)
 values('${testIdentity}',repeat('a',64),'{"player":"PRODUCTION_ROLLBACK_PROOF"}'::jsonb,'production_rollback_proof',now(),now());
 insert into public.tcos_card_market_observations(registry_identity_id,observation_fingerprint,observation_kind,marketplace,title,item_price,shipping_price,buyer_fees,tax,delivered_price,currency,observed_at) values
 ('${testIdentity}',repeat('b',64),'ASK','Proof','ASK',7,6,.52,1.11,14.63,'USD',now()),
 ('${testIdentity}',repeat('c',64),'SOLD','Proof','SOLD',10,0,null,null,10,'USD',now());
 insert into public.tcos_card_market_observations(registry_identity_id,observation_fingerprint,observation_kind,marketplace,title,delivered_price,currency,observed_at)
 values('${testIdentity}',repeat('b',64),'ASK','Proof','duplicate',99,'USD',now()) on conflict(observation_fingerprint) do nothing;
 select count(*) into a from public.tcos_card_market_observations where registry_identity_id='${testIdentity}' and observation_kind='ASK';
 select count(*) into s from public.tcos_card_market_observations where registry_identity_id='${testIdentity}' and observation_kind='SOLD';
 if a<>1 or s<>1 then raise exception 'ASK/SOLD or dedupe failed'; end if;
 begin update public.tcos_card_market_observations set delivered_price=999 where registry_identity_id='${testIdentity}' and observation_kind='ASK'; exception when others then if position('append-only' in SQLERRM)>0 then bu:=true; else raise; end if; end;
 if not bu then raise exception 'UPDATE guard failed'; end if;
 begin delete from public.tcos_card_market_observations where registry_identity_id='${testIdentity}' and observation_kind='SOLD'; exception when others then if position('append-only' in SQLERRM)>0 then bd:=true; else raise; end if; end;
 if not bd then raise exception 'DELETE guard failed'; end if;
end $$; rollback;`, false, "rollback-only behavior proof");

const residueRows = await query(`select json_build_object(
 'identityRows',(select count(*) from public.tcos_card_market_identities where registry_identity_id='${testIdentity}'),
 'observationRows',(select count(*) from public.tcos_card_market_observations where registry_identity_id='${testIdentity}')
) residue;`, true, "rollback residue");
const residue = residueRows?.[0]?.residue || {};
if (Number(residue.identityRows || 0) !== 0 || Number(residue.observationRows || 0) !== 0) throw new Error(`Rollback left residue: ${JSON.stringify(residue)}`);

const receipt = { ok:true, expectedMain, migrationResults, contract, rollbackProof:{askSoldSeparated:true,duplicateFingerprintSuppressed:true,updateBlocked:true,deleteBlocked:true,syntheticResidue:residue}, completedAt:new Date().toISOString() };
fs.writeFileSync(path.join(evidenceDir,"production-db-proof.json"),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
