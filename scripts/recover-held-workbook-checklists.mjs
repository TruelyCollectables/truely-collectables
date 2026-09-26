import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { buildPlan, assertPlanComplexity } from "./mainstream-checklist/registry-tools.mjs";
import { normalized } from "./mainstream-checklist/source-tools.mjs";

const TARGETS_FILE = process.env.GOGTS_COORDINATE_TARGETS;
const OUTPUT_ROOT = resolve(process.env.GOGTS_COORDINATE_OUTPUT || ".checklist-discovery/held-workbook-recovery");
const MINIMUM_CARD_ROWS = Math.max(1, Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 20));
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/held-workbook-tmp");
if (!TARGETS_FILE) throw new Error("GOGTS_COORDINATE_TARGETS is required.");

const DEFAULT_HELD = new Set([
  "basketball|2024|panini|prizm-wnba",
  "hockey|2021-22|leaf|lumber",
  "hockey|2021-22|topps|sticker-collection-nhl",
  "hockey|2021-22|upper-deck|black-diamond-nhl",
  "hockey|2021-22|upper-deck|mvp-nhl",
  "hockey|2021-22|upper-deck|o-pee-chee-nhl",
  "hockey|2021-22|upper-deck|series-two-nhl",
  "hockey|2021-22|upper-deck|sp-game-used-nhl",
  "hockey|2021-22|upper-deck|the-cup-nhl",
  "hockey|2022-23|leaf|used",
  "hockey|2022-23|upper-deck|black-diamond-nhl",
  "hockey|2022-23|upper-deck|o-pee-chee-nhl",
  "hockey|2022-23|upper-deck|premier-nhl",
  "hockey|2022-23|upper-deck|the-cup-nhl",
  "hockey|2022|leaf|art-of",
  "hockey|2023-24|upper-deck|black-diamond-nhl",
  "hockey|2023-24|upper-deck|clear-cut-nhl",
  "hockey|2023-24|upper-deck|skybox-metal-universe-nhl",
  "hockey|2023-24|upper-deck|the-cup-nhl",
  "hockey|2023|leaf|ultimate",
  "hockey|2024-25|upper-deck|black-diamond-nhl",
  "hockey|2024-25|upper-deck|clear-cut-nhl",
  "hockey|2024-25|upper-deck|series-one-nhl",
  "hockey|2024-25|upper-deck|series-two-nhl",
  "hockey|2024-25|upper-deck|sp-authentic-nhl",
  "hockey|2024-25|upper-deck|synergy-nhl",
  "hockey|2024|leaf|metal-legends",
  "hockey|2025-26|upper-deck|black-diamond-nhl",
  "hockey|2025-26|upper-deck|chicago-blackhawks-centennial",
  "hockey|2025-26|upper-deck|clear-cut-nhl",
  "hockey|2025|upper-deck|national-hockey-card-day",
  "hockey|2026|upper-deck|national-hockey-card-day",
]);
const requested = String(process.env.RECOVERY_EXACT_KEYS || "").split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
const held = requested.length ? new Set(requested) : DEFAULT_HELD;

const acronyms = new Map([["ahl","AHL"],["chl","CHL"],["nba","NBA"],["nfl","NFL"],["nhl","NHL"],["pwhl","PWHL"],["wnba","WNBA"]]);
const displayToken = (value) => String(value || "").split("-").filter(Boolean).map((part) => acronyms.get(part.toLowerCase()) || `${part.slice(0,1).toUpperCase()}${part.slice(1)}`).join(" ");
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";

function buildEntry(target, sourceUrl) {
  const parts = String(target.exactSetKey || "").split("|");
  if (parts.length !== 4) throw new Error(`Invalid exactSetKey: ${target.exactSetKey}`);
  const [sportKey, seasonKey, manufacturerKey, productKey] = parts;
  const manufacturer = displayToken(manufacturerKey);
  const product = displayToken(productKey);
  return {
    id: `workbook-recovery-${safeSlug(target.exactSetKey)}`,
    sourceName: new URL(sourceUrl).hostname,
    sourceUrl,
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: MINIMUM_CARD_ROWS,
    release: {
      exactSetKey: target.exactSetKey,
      canonicalName: `${seasonKey} ${manufacturer} ${product} ${displayToken(sportKey)}`,
      manufacturer,
      brand: null,
      product,
      releaseYear: Number(target.year || String(seasonKey).match(/\d{4}/)?.[0] || 0),
      season: seasonKey,
      sport: sportKey,
      league: null,
    },
  };
}

function workbookUrls(target) {
  return [target.sourceUrl, ...(target.fallbackUrls || [])]
    .filter(Boolean)
    .filter((url, i, a) => a.indexOf(url) === i)
    .filter((url) => /\.(?:xls|xlsx)(?:$|[?#])/i.test(url));
}

async function fetchSource(url) {
  const response = await fetch(url, {
    headers: { "Cache-Control": "no-cache", "User-Agent": "TCOS-Checklist-Recovery/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Downloaded workbook was empty.");
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("Downloaded workbook exceeded 50 MiB.");
  const finalUrl = response.url || url;
  const filename = decodeURIComponent(new URL(finalUrl).pathname.split("/").filter(Boolean).at(-1) || "checklist.xlsx").replace(/[^A-Za-z0-9._-]+/g, "-");
  const mimeType = extname(new URL(finalUrl).pathname).toLowerCase() === ".xlsx"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "application/vnd.ms-excel";
  return { bytes, finalUrl, selectedUrl: url, filename, mimeType };
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
        if not card: continue
        if key(card) in CARD: continue
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
function cleanCardNumber(value) {
  return normalized(value).replace(/^#\s*/, "").replace(/\.0$/, "");
}
function cleanSetName(value) {
  const name = normalized(value).replace(/\s+(?:card )?checklist$/i, "").trim();
  return !name || /^(?:base|base cards|base set)$/i.test(name) ? "Base Set" : name.slice(0,160);
}
function explicitlyMultiSubjectSet(name) {
  const text = normalized(name).toLowerCase();
  return /\b(?:dual|triple|quad|quartet|quint(?:uple)?|sextet|six[- ]?way|octet|eight[- ]?way|multi(?:ple)?|combo|combination|pairing|book|booklet|ensemble)\b/i.test(text) && /\b(?:autograph|signature|signed|relic|memorabilia|patch|swatch|jersey|book|booklet)\b/i.test(text);
}

function parseStructuredRows(entry, rawRows) {
  const cards=[]; const errors=[]; const warnings=[]; const exact=new Set(); const byNumber=new Map();
  for (const row of rawRows) {
    const setName=cleanSetName(row.setName);
    const cardNumber=cleanCardNumber(row.cardNumber);
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
    const card={
      setName, cardNumber, players,
      teams: normalized(row.team) ? [normalized(row.team)] : [],
      rookieDesignation: truthyFlag(row.rookie) || /(?:\bRC\b|\brookie\b)/i.test(row.subject),
      firstBowmanDesignation: false,
      autographStatus: auto ? "autograph" : "non-auto",
      memorabiliaStatus: mem ? "memorabilia" : "non-memorabilia",
      variation: /^(?:SP|SSP)$/i.test(sp) ? sp.toUpperCase() : null,
      sourceNotes: `Structured workbook ${row.sheet} row ${row.row}${normalized(row.serial) ? `; source serial ${normalized(row.serial)}` : ""}`,
    };
    const prior=byNumber.get(numberKey);
    if (prior && prior.subjectKey !== subjectKey) {
      if (explicitlyMultiSubjectSet(setName)) {
        prior.card.players=[...new Set([...prior.card.players,...players])];
        prior.card.teams=[...new Set([...prior.card.teams,...card.teams])];
        prior.subjectKey=prior.card.players.map((v)=>v.toLowerCase()).sort().join("+");
        continue;
      }
      errors.push({ code:"reference_card_number_subject_conflict", severity:"error", message:`${setName} #${cardNumber} maps to conflicting subjects.` });
      continue;
    }
    byNumber.set(numberKey,{subjectKey,card}); cards.push(card);
  }
  if (cards.length < Math.max(1, Number(entry.minimumCardRows || MINIMUM_CARD_ROWS))) errors.push({ code:"reference_checklist_insufficient_rows", severity:"error", message:`Only ${cards.length} deterministic card rows were parsed; ${entry.minimumCardRows || MINIMUM_CARD_ROWS} are required.` });
  warnings.push({ code:"reference_parallel_rows_not_deterministic", severity:"warning", message:"Structured recovery preserved card-level set, subject, team, rookie/auto/memorabilia/SP facts; no standalone all-card parallel rows were inferred." });
  return { cards, parallels:[], warnings, errors };
}

function workbookRows(source) {
  mkdirSync(TEMP_ROOT,{recursive:true});
  const path=resolve(TEMP_ROOT,`${Date.now()}-${Math.random().toString(36).slice(2)}-${source.filename}`);
  writeFileSync(path,source.bytes);
  try {
    return JSON.parse(execFileSync("python3",["-c",PYTHON,path],{encoding:"utf8",maxBuffer:64*1024*1024,timeout:180000}));
  } finally { rmSync(path,{force:true}); }
}

mkdirSync(OUTPUT_ROOT,{recursive:true});
for (const d of ["sources","parsed","plans","results"]) mkdirSync(resolve(OUTPUT_ROOT,d),{recursive:true});
const allTargets=JSON.parse(await readFile(TARGETS_FILE,"utf8"));
const targets=allTargets.filter((t)=>held.has(t.exactSetKey));
if (!targets.length) throw new Error("No held targets found in target manifest.");
const results=[];
for (let i=0;i<targets.length;i+=1) {
  const target=targets[i]; const slug=safeSlug(target.exactSetKey); const attempts=[];
  console.log(`=== WORKBOOK RECOVERY ${i+1}/${targets.length}: ${target.exactSetKey} ===`);
  for (const url of workbookUrls(target)) {
    try {
      const source=await fetchSource(url); const entry=buildEntry(target,url); const raw=workbookRows(source); const parsed=parseStructuredRows(entry,raw); const plan=buildPlan(entry,parsed,source,new Date().toISOString()); const complexity=assertPlanComplexity(plan); const errors=plan.validation.issues.filter((x)=>x.severity==="error");
      attempts.push({url,source,parsed,plan,complexity,errors,rawCount:raw.length});
      console.log(JSON.stringify({key:target.exactSetKey,url,status:errors.length?"validation_failed":"ready",rawRows:raw.length,counts:plan.validation.counts,errorCount:errors.length}));
    } catch (error) { attempts.push({url,error:error instanceof Error ? error.stack||error.message : String(error)}); console.warn(JSON.stringify({key:target.exactSetKey,url,status:"failed",error:String(error instanceof Error?error.message:error).slice(0,500)})); }
  }
  const viable=attempts.filter((a)=>a.plan).sort((a,b)=>{const ap=a.errors.length===0?1:0,bp=b.errors.length===0?1:0;if(ap!==bp)return bp-ap;if(a.errors.length!==b.errors.length)return a.errors.length-b.errors.length;return Number(b.plan.validation.counts.cards||0)-Number(a.plan.validation.counts.cards||0);});
  if (!viable.length) { const result={exactSetKey:target.exactSetKey,status:"failed",error:attempts.map((a)=>`${a.url}: ${a.error||"no plan"}`).join(" | ").slice(0,4000)}; results.push(result); writeFileSync(resolve(OUTPUT_ROOT,"results",`${slug}.json`),JSON.stringify(result,null,2)); continue; }
  const chosen=viable[0]; const sourceName=`${slug}__${chosen.source.filename}`;
  writeFileSync(resolve(OUTPUT_ROOT,"sources",sourceName),Buffer.from(chosen.source.bytes)); writeFileSync(resolve(OUTPUT_ROOT,"parsed",`${slug}.json`),JSON.stringify(chosen.parsed,null,2)); writeFileSync(resolve(OUTPUT_ROOT,"plans",`${slug}.json`),JSON.stringify(chosen.plan,null,2));
  const result={exactSetKey:target.exactSetKey,status:chosen.errors.length?"validation_failed":"ready",sourceUrl:target.sourceUrl,selectedUrl:chosen.source.selectedUrl,finalUrl:chosen.source.finalUrl,mimeType:chosen.source.mimeType,filename:chosen.source.filename,counts:chosen.plan.validation.counts,serializedBytes:chosen.complexity.serializedBytes,sourceBytes:chosen.source.bytes.byteLength,errors:chosen.errors.slice(0,30),warnings:chosen.plan.validation.issues.filter((x)=>x.severity!=="error").slice(0,30),storage:chosen.plan.source.storage,attempts:attempts.map((a)=>a.plan?{url:a.url,status:a.errors.length?"validation_failed":"ready",rawRows:a.rawCount,counts:a.plan.validation.counts,errorCount:a.errors.length}:{url:a.url,status:"failed",error:String(a.error||"").slice(0,1000)})};
  results.push(result); writeFileSync(resolve(OUTPUT_ROOT,"results",`${slug}.json`),JSON.stringify(result,null,2)); console.log(JSON.stringify({key:target.exactSetKey,status:result.status,counts:result.counts}));
}
const ready=results.filter((r)=>r.status==="ready"), validationFailed=results.filter((r)=>r.status==="validation_failed"), failed=results.filter((r)=>r.status==="failed");
const summary={schema:"tcos.checklist.heldWorkbookRecovery.v1",targetCount:targets.length,resultCount:results.length,readyCount:ready.length,validationFailedCount:validationFailed.length,failedCount:failed.length,totalCards:ready.reduce((s,r)=>s+Number(r.counts?.cards||0),0),totalParallels:ready.reduce((s,r)=>s+Number(r.counts?.parallels||0),0),totalIdentities:ready.reduce((s,r)=>s+Number(r.counts?.identities||0),0),ready,validationFailed,failed};
writeFileSync(resolve(OUTPUT_ROOT,"summary.json"),JSON.stringify(summary,null,2)); console.log(JSON.stringify({targetCount:summary.targetCount,readyCount:summary.readyCount,validationFailedCount:summary.validationFailedCount,failedCount:summary.failedCount,totalCards:summary.totalCards,totalIdentities:summary.totalIdentities},null,2));
if (!ready.length) process.exitCode=2;
