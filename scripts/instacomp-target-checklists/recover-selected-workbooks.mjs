import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan, dbClient } from "../mainstream-checklist/registry-tools.mjs";
import { normalized } from "../mainstream-checklist/source-tools.mjs";
import { persistPlanStaged } from "./staged-registry-writer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.WORKBOOK_RECOVERY_RECEIPT || `${ROOT}/selected-workbook-recovery-receipt.json`);
const MINIMUM_CARD_ROWS = Math.max(1, Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 20));
const TARGET_ATTEMPTS = Math.max(1, Number(process.env.WORKBOOK_TARGET_ATTEMPTS || 4));
const RETRY_DELAY_MS = Math.max(2_000, Number(process.env.WORKBOOK_TARGET_RETRY_DELAY_MS || 10_000));
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/selected-workbook-tmp");

const EXACT_KEYS = new Set([
  "hockey|2021-22|leaf|lumber",
  "hockey|2021-22|upper-deck|mvp-nhl",
  "hockey|2021-22|upper-deck|series-two-nhl",
  "hockey|2022-23|leaf|used",
  "hockey|2022-23|upper-deck|black-diamond-nhl",
  "hockey|2023-24|upper-deck|black-diamond-nhl",
  "hockey|2023-24|upper-deck|clear-cut-nhl",
  "hockey|2023-24|upper-deck|the-cup-nhl",
  "hockey|2024-25|upper-deck|black-diamond-nhl",
  "hockey|2024-25|upper-deck|clear-cut-nhl",
  "hockey|2024-25|upper-deck|series-one-nhl",
  "hockey|2024-25|upper-deck|synergy-nhl",
  "hockey|2025-26|upper-deck|black-diamond-nhl",
  "hockey|2025-26|upper-deck|chicago-blackhawks-centennial",
  "hockey|2025-26|upper-deck|clear-cut-nhl",
]);

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath = resolve(ROOT, "output/summary.json");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(sourcesDir)) throw new Error("Verified harvest bundle is incomplete.");

const acronyms = new Map([["ahl","AHL"],["chl","CHL"],["nba","NBA"],["nfl","NFL"],["nhl","NHL"],["pwhl","PWHL"],["wnba","WNBA"]]);
const displayToken = (value) => String(value || "").split("-").filter(Boolean).map((part) => acronyms.get(part.toLowerCase()) || `${part.slice(0,1).toUpperCase()}${part.slice(1)}`).join(" ");
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const transientMessage = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b52[125]\b|\b544\b|fetch failed|network/i.test(String(message || ""));

function buildEntry(row, sourceUrl) {
  const [sportKey, seasonKey, manufacturerKey, productKey] = row.exactSetKey.split("|");
  const manufacturer = displayToken(manufacturerKey);
  const product = displayToken(productKey);
  return {
    id: `selected-workbook-${safeSlug(row.exactSetKey)}`,
    sourceName: new URL(sourceUrl).hostname,
    sourceUrl,
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: MINIMUM_CARD_ROWS,
    release: {
      exactSetKey: row.exactSetKey,
      canonicalName: `${seasonKey} ${manufacturer} ${product} ${displayToken(sportKey)}`,
      manufacturer,
      brand: null,
      product,
      releaseYear: Number(String(seasonKey).match(/\d{4}/)?.[0] || 0),
      season: seasonKey,
      sport: sportKey,
      league: null,
    },
  };
}

const PYTHON = String.raw`
import json, re, sys
path = sys.argv[1]

def text(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return str(v).strip()

def key(v):
    return re.sub(r'[^a-z0-9]+', ' ', text(v).lower()).strip()

if path.lower().endswith('.xlsx'):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets = [(ws.title, [list(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets]
else:
    import xlrd
    wb = xlrd.open_workbook(path)
    sheets = []
    for ws in wb.sheets():
        rows = [[ws.cell_value(r,c) for c in range(ws.ncols)] for r in range(ws.nrows)]
        sheets.append((ws.name, rows))

CARD = {'card','card number','card no','card num','checklist'}
SET = {'set','set name','card set','subset','insert set'}
SUBJECT = {'description','player','athlete','subject','name'}
FIRST = {'first name','firstname'}
LAST = {'last name','lastname'}
TEAM = {'team','team name','teamname'}
CITY = {'team city','teamcity'}
ROOKIE = {'rookie','rc'}
AUTO = {'auto','autograph','autographs'}
MEM = {'mem','mem tech','memorabilia','relic'}
SERIAL = {'serial d','serial','d','d to'}
SP = {'sp','sps','sp s','short print'}

out=[]
for sheet, rows in sheets:
    header_idx=None; cols={}
    for ridx,row in enumerate(rows[:40]):
        h=[key(v) for v in row]
        def find(names):
            for i,v in enumerate(h):
                if v in names: return i
            return None
        c=find(CARD); s=find(SET); subj=find(SUBJECT); first=find(FIRST); last=find(LAST)
        if c is not None and (subj is not None or (first is not None and last is not None)):
            header_idx=ridx
            cols={'card':c,'set':s,'subject':subj,'first':first,'last':last,'team':find(TEAM),'city':find(CITY),'rookie':find(ROOKIE),'auto':find(AUTO),'mem':find(MEM),'serial':find(SERIAL),'sp':find(SP)}
            break
    if header_idx is None: continue
    last_set=''
    for ridx,row in enumerate(rows[header_idx+1:], header_idx+2):
        def at(name):
            i=cols.get(name)
            return text(row[i]) if i is not None and i < len(row) else ''
        card=at('card').lstrip('#').strip()
        if not card or key(card) in CARD: continue
        set_name=at('set') or last_set or 'Base Set'
        if at('set'): last_set=at('set')
        subject=at('subject') or (' '.join(x for x in [at('first'),at('last')] if x).strip())
        if not subject: continue
        team=' '.join(x for x in [at('city'),at('team')] if x).strip()
        out.append({'sheet':sheet,'row':ridx,'setName':set_name,'cardNumber':card,'subject':subject,'team':team,'rookie':at('rookie'),'auto':at('auto'),'mem':at('mem'),'serial':at('serial'),'sp':at('sp')})
print(json.dumps(out, ensure_ascii=False))
`;

function truthyFlag(value) {
  const v = normalized(value).toLowerCase();
  return Boolean(v) && !/^(?:0|n|no|false|none|-)$/.test(v);
}
function splitPlayers(subject) {
  const cleaned = normalized(subject).replace(/\s+(?:RC|ROOKIE CARD|ROOKIE)$/i, "").replace(/\s+\(RC\)$/i, "").replace(/\s+\*+$/g, "").trim();
  const pieces = cleaned.split(/\s+(?:\/|;|\+|&amp;)\s+/i).map(normalized).filter((v) => v.length >= 2 && v.length <= 160);
  return pieces.length ? [...new Set(pieces)] : cleaned ? [cleaned] : [];
}
function explicitlyMultiSubjectSet(name) {
  const text = normalized(name).toLowerCase();
  return /\b(?:dual|triple|quad|quartet|quint(?:uple)?|sextet|six[- ]?way|octet|eight[- ]?way|multi(?:ple)?|combo|combination|pairing|book|booklet|ensemble)\b/i.test(text) && /\b(?:autograph|signature|signed|relic|memorabilia|patch|swatch|jersey|book|booklet)\b/i.test(text);
}
function parseRows(entry, rawRows) {
  const cards=[]; const errors=[]; const warnings=[]; const exact=new Set(); const byNumber=new Map();
  for (const row of rawRows) {
    const rawSet=normalized(row.setName).replace(/\s+(?:card )?checklist$/i, "").trim();
    const setName=!rawSet || /^(?:base|base cards|base set)$/i.test(rawSet) ? "Base Set" : rawSet.slice(0,160);
    const cardNumber=normalized(row.cardNumber).replace(/^#\s*/, "").replace(/\.0$/, "");
    const players=splitPlayers(row.subject);
    if (!cardNumber || !players.length || cardNumber.length > 40) continue;
    const subjectKey=players.map((v)=>v.toLowerCase()).sort().join("+");
    const numberKey=`${setName.toLowerCase()}::${cardNumber.toLowerCase()}`;
    const exactKey=`${numberKey}::${subjectKey}`;
    if (exact.has(exactKey)) continue;
    exact.add(exactKey);
    const setText=setName.toLowerCase();
    const auto=truthyFlag(row.auto) || /autograph|signature|signed/.test(setText);
    const mem=truthyFlag(row.mem) || /relic|memorabilia|patch|swatch|jersey/.test(setText);
    const sp=normalized(row.sp);
    const card={setName,cardNumber,players,teams:normalized(row.team)?[normalized(row.team)]:[],rookieDesignation:truthyFlag(row.rookie)||/(?:\bRC\b|\brookie\b)/i.test(row.subject),firstBowmanDesignation:false,autographStatus:auto?"autograph":"non-auto",memorabiliaStatus:mem?"memorabilia":"non-memorabilia",variation:/^(?:SP|SSP)$/i.test(sp)?sp.toUpperCase():null,sourceNotes:`Structured workbook ${row.sheet} row ${row.row}${normalized(row.serial)?`; source serial ${normalized(row.serial)}`:""}`};
    const prior=byNumber.get(numberKey);
    if (prior && prior.subjectKey !== subjectKey) {
      if (explicitlyMultiSubjectSet(setName)) {
        prior.card.players=[...new Set([...prior.card.players,...players])];
        prior.card.teams=[...new Set([...prior.card.teams,...card.teams])];
        prior.subjectKey=prior.card.players.map((v)=>v.toLowerCase()).sort().join("+");
        continue;
      }
      errors.push({code:"reference_card_number_subject_conflict",severity:"error",message:`${setName} #${cardNumber} maps to conflicting subjects.`});
      continue;
    }
    byNumber.set(numberKey,{subjectKey,card}); cards.push(card);
  }
  if (cards.length < MINIMUM_CARD_ROWS) errors.push({code:"reference_checklist_insufficient_rows",severity:"error",message:`Only ${cards.length} deterministic card rows were parsed; ${MINIMUM_CARD_ROWS} are required.`});
  warnings.push({code:"reference_parallel_rows_not_deterministic",severity:"warning",message:"Workbook recovery preserves explicit card-level facts and does not invent standalone parallel rows."});
  return {cards,parallels:[],warnings,errors};
}

function workbookRows(bytes, filename) {
  mkdirSync(TEMP_ROOT,{recursive:true});
  const path=resolve(TEMP_ROOT,`${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
  writeFileSync(path,bytes);
  try { return JSON.parse(execFileSync("python3",["-c",PYTHON,path],{encoding:"utf8",maxBuffer:64*1024*1024,timeout:180000})); }
  finally { rmSync(path,{force:true}); }
}

async function persistWithRetry(db, plan, bytes, exactSetKey) {
  let last=null;
  for (let attempt=1; attempt<=TARGET_ATTEMPTS; attempt+=1) {
    try { return await persistPlanStaged(db,plan,bytes); }
    catch (error) {
      last=error instanceof Error?error:new Error(String(error));
      console.warn(`${exactSetKey} persist attempt ${attempt}/${TARGET_ATTEMPTS} failed: ${last.message}`);
      if (!transientMessage(last.message) || attempt===TARGET_ATTEMPTS) break;
      await sleep(Math.min(60_000, RETRY_DELAY_MS*attempt));
    }
  }
  throw last || new Error(`Unknown persistence failure for ${exactSetKey}`);
}

const summary=JSON.parse(readFileSync(summaryPath,"utf8"));
const candidates=(summary.validationFailed||[]).filter((row)=>EXACT_KEYS.has(row.exactSetKey));
if (candidates.length!==EXACT_KEYS.size) throw new Error(`Expected ${EXACT_KEYS.size} selected workbook failures, found ${candidates.length}.`);
const sourceFiles=readdirSync(sourcesDir);
const db=dbClient();
const results=[];

for (let index=0; index<candidates.length; index+=1) {
  const row=candidates[index];
  const slug=safeSlug(row.exactSetKey);
  const sourceName=sourceFiles.find((name)=>name.startsWith(`${slug}__`));
  if (!sourceName) { results.push({exactSetKey:row.exactSetKey,status:"failed",error:"Immutable source file missing."}); continue; }
  const bytes=readFileSync(resolve(sourcesDir,sourceName));
  const mimeType=sourceName.toLowerCase().endsWith(".xlsx")?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/vnd.ms-excel";
  const sourceUrl=row.selectedUrl||row.finalUrl||row.sourceUrl;
  const source={bytes,filename:sourceName.slice(sourceName.indexOf("__")+2),mimeType,selectedUrl:sourceUrl,finalUrl:row.finalUrl||sourceUrl};
  const entry=buildEntry(row,sourceUrl);
  console.log(`=== WORKBOOK REPAIR ${index+1}/${candidates.length}: ${row.exactSetKey} ===`);
  try {
    const raw=workbookRows(bytes,source.filename);
    const parsed=parseRows(entry,raw);
    const plan=buildPlan(entry,parsed,source,new Date().toISOString());
    const complexity=assertPlanComplexity(plan);
    if (plan.validation.status!=="passed") {
      results.push({exactSetKey:row.exactSetKey,status:"validation_failed",rawRows:raw.length,counts:plan.validation.counts,errors:plan.validation.issues.filter((x)=>x.severity==="error").slice(0,30)});
      continue;
    }
    const transaction=await persistWithRetry(db,plan,bytes,row.exactSetKey);
    results.push({exactSetKey:row.exactSetKey,status:"persisted",rawRows:raw.length,counts:plan.validation.counts,serializedBytes:complexity.serializedBytes,transaction});
  } catch (error) {
    results.push({exactSetKey:row.exactSetKey,status:"failed",error:error instanceof Error?error.message:String(error)});
  }
}

rmSync(TEMP_ROOT,{recursive:true,force:true});
const persisted=results.filter((row)=>row.status==="persisted");
const failed=results.filter((row)=>row.status!=="persisted");
const receipt={schema:"tcos.checklist.selectedWorkbookRecovery.v1",targetCount:EXACT_KEYS.size,attemptedCount:results.length,persistedCount:persisted.length,failedCount:failed.length,persistedCards:persisted.reduce((sum,row)=>sum+Number(row.counts?.cards||0),0),persistedIdentities:persisted.reduce((sum,row)=>sum+Number(row.counts?.identities||0),0),results};
writeFileSync(OUTPUT,`${JSON.stringify(receipt,null,2)}\n`);
console.log(JSON.stringify({targetCount:receipt.targetCount,attemptedCount:receipt.attemptedCount,persistedCount:receipt.persistedCount,failedCount:receipt.failedCount,persistedCards:receipt.persistedCards,persistedIdentities:receipt.persistedIdentities},null,2));
if (results.length!==EXACT_KEYS.size || failed.length) process.exitCode=2;
