import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan } from "../mainstream-checklist/registry-tools.mjs";
import { normalized } from "../mainstream-checklist/source-tools.mjs";
import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.LEAF_HOCKEY_SOURCE_ROOT || "");
const OUTPUT = resolve(process.env.LEAF_HOCKEY_RECEIPT || `${ROOT}/leaf-hockey-production-receipt.json`);
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/leaf-hockey-workbook-tmp");
const MINIMUM_CARD_ROWS = Math.max(1, Number(process.env.LEAF_HOCKEY_MINIMUM_CARD_ROWS || 10));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const transient = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b50[0234]\b|\b52[125]\b|\b544\b|fetch failed|network|aborted|temporar/i.test(String(message || ""));

const TARGETS = [
  { key:"2021-22-signature-series", exactSetKey:"hockey|2021-22|leaf|signature-series", season:"2021-22", releaseYear:2021, product:"Signature Series", file:"2021-22-signature-series.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/61d8c19756efab55de994cdd_2021-22_Leaf_Signature_Series_Hockey_CL_F_REV.xlsx" },
  { key:"2021-22-pro-set", exactSetKey:"hockey|2021-22|leaf|pro-set", season:"2021-22", releaseYear:2021, product:"Pro Set", file:"2021-22-pro-set.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/619e9d990442443640f2c3e2_2021-22_Pro_Set_Hockey_Blaster_CL_F.xlsx" },
  { key:"2021-22-lumber", exactSetKey:"hockey|2021-22|leaf|lumber", season:"2021-22", releaseYear:2021, product:"Lumber", file:"2021-22-lumber.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/6413320c760607c2daf89414_2021-22_Leaf_Lumber_Hockey_CL_F.xlsx" },
  { key:"2022-art-of", exactSetKey:"hockey|2022|leaf|art-of", season:"2022", releaseYear:2022, product:"Art Of", file:"2022-art-of.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/6463dcb3553743090c5c4408_2022_Leaf_Art_of_Hockey_CL_F.xlsx" },
  { key:"2022-expo-ink", exactSetKey:"hockey|2022|leaf|expo-ink", season:"2022", releaseYear:2022, product:"Expo Ink", file:"2022-expo-ink.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/6290e8576fe33c83591e1cb9_2022_Leaf_Expo_Ink_Hockey_CL_F.xlsx" },
  { key:"2022-23-used", exactSetKey:"hockey|2022-23|leaf|used", season:"2022-23", releaseYear:2022, product:"Used", file:"2022-23-used.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/64fb38d302373a5e553d19ac_2022-23_Leaf_In_The_Game_Used_Hockey_CL_F.xlsx" },
  { key:"2023-ultimate", exactSetKey:"hockey|2023|leaf|ultimate", season:"2023", releaseYear:2023, product:"Ultimate", file:"2023-ultimate.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://cdn.prod.website-files.com/6185749e80385c9daf8ddaf3/65396e9f6889e50b260b010b_2023_Leaf_Ultimate_Hockey_CL_F.xlsx" },
  { key:"2024-metal-legends", exactSetKey:"hockey|2024|leaf|metal-legends", season:"2024", releaseYear:2024, product:"Metal Legends", file:"2024-metal-legends.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceUrl:"https://assets-global.website-files.com/6185749e80385c9daf8ddaf3/65fb05959701deda1ce4804b_2024_Leaf_Metal_Hockey_Legends_CL_F.xlsx" },
  { key:"2025-metal-legends", exactSetKey:"hockey|2025|leaf|metal-legends", season:"2025", releaseYear:2025, product:"Metal Legends", file:"2025-metal-legends.xls", mimeType:"application/vnd.ms-excel", sourceUrl:"https://gogts.net/wp-content/uploads/2025/03/2025-Leaf-Metal-Legends-Hockey-Cards-Checklist.xls" },
  { key:"2026-metal", exactSetKey:"hockey|2026|leaf|metal", season:"2026", releaseYear:2026, product:"Metal", file:"2026-metal.csv", mimeType:"text/csv", sourceUrl:"https://docs.google.com/spreadsheets/d/e/2PACX-1vS6VjuhDWueHyJFOLMK_hkUr6GDPn4ldiyeuAM9arPPhDaxIiy4u5kFMXQ9fQVkAQ/pub?output=csv" },
];

const PYTHON = String.raw`
import csv, json, re, sys
path = sys.argv[1]

def text(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return str(v).strip()

def key(v): return re.sub(r'[^a-z0-9]+', ' ', text(v).lower()).strip()

if path.lower().endswith('.xlsx'):
    import openpyxl
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True)
    sheets=[(ws.title,[list(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets]
elif path.lower().endswith('.xls'):
    import xlrd
    wb=xlrd.open_workbook(path)
    sheets=[]
    for ws in wb.sheets():
        sheets.append((ws.name,[[ws.cell_value(r,c) for c in range(ws.ncols)] for r in range(ws.nrows)]))
else:
    with open(path,'r',encoding='utf-8-sig',newline='') as f: rows=list(csv.reader(f))
    sheets=[('Checklist',rows)]

CARD={'card','card number','card no','card num','checklist','card id','cardnumber'}
SET={'set','set name','card set','subset','insert set','insert','card type'}
SUBJECT={'description','player','athlete','subject','name','player name','card name'}
FIRST={'first name','firstname'}; LAST={'last name','lastname'}
TEAM={'team','team name','teamname'}; CITY={'team city','teamcity'}
ROOKIE={'rookie','rc'}; AUTO={'auto','autograph','autographs'}
MEM={'mem','mem tech','memorabilia','relic'}; SERIAL={'serial d','serial','d','d to','numbered to'}
SP={'sp','sps','sp s','short print'}
out=[]
for sheet,rows in sheets:
    header_idx=None; cols={}
    for ridx,row in enumerate(rows[:80]):
        h=[key(v) for v in row]
        def find(names):
            for i,v in enumerate(h):
                if v in names: return i
            return None
        c=find(CARD); s=find(SET); subj=find(SUBJECT); first=find(FIRST); last=find(LAST)
        if c is not None and (subj is not None or (first is not None and last is not None)):
            header_idx=ridx; cols={'card':c,'set':s,'subject':subj,'first':first,'last':last,'team':find(TEAM),'city':find(CITY),'rookie':find(ROOKIE),'auto':find(AUTO),'mem':find(MEM),'serial':find(SERIAL),'sp':find(SP)}; break
    if header_idx is None: continue
    last_set=''
    for ridx,row in enumerate(rows[header_idx+1:],header_idx+2):
        def at(name):
            i=cols.get(name); return text(row[i]) if i is not None and i < len(row) else ''
        card=at('card').lstrip('#').strip()
        if not card or key(card) in CARD: continue
        set_name=at('set') or last_set or sheet or 'Base Set'
        if at('set'): last_set=at('set')
        subject=at('subject') or (' '.join(x for x in [at('first'),at('last')] if x).strip())
        if not subject: continue
        team=' '.join(x for x in [at('city'),at('team')] if x).strip()
        out.append({'sheet':sheet,'row':ridx,'setName':set_name,'cardNumber':card,'subject':subject,'team':team,'rookie':at('rookie'),'auto':at('auto'),'mem':at('mem'),'serial':at('serial'),'sp':at('sp')})
print(json.dumps(out,ensure_ascii=False))
`;

function truthyFlag(value) { const v=normalized(value).toLowerCase(); return Boolean(v) && !/^(?:0|n|no|false|none|-)$/.test(v); }
function splitPlayers(subject) {
  const cleaned=normalized(subject).replace(/\s+(?:RC|ROOKIE CARD|ROOKIE)$/i,"").replace(/\s+\(RC\)$/i,"").replace(/\s+\*+$/g,"").trim();
  const pieces=cleaned.split(/\s+(?:\/|;|\+|&amp;)\s+/i).map(normalized).filter((v)=>v.length>=2&&v.length<=180);
  return pieces.length?[...new Set(pieces)]:cleaned?[cleaned]:[];
}
function explicitlyMultiSubjectSet(name) { const t=normalized(name).toLowerCase(); return /\b(?:dual|triple|quad|quartet|quint|sextet|six[- ]?way|octet|eight[- ]?way|multi|combo|combination|pairing|book|booklet|ensemble)\b/i.test(t); }
function parseRows(rawRows) {
  const cards=[]; const errors=[]; const warnings=[]; const exact=new Set(); const byNumber=new Map();
  for (const row of rawRows) {
    const rawSet=normalized(row.setName).replace(/\s+(?:card )?checklist$/i,"").trim();
    const setName=!rawSet||/^(?:base|base cards|base set)$/i.test(rawSet)?"Base Set":rawSet.slice(0,180);
    const cardNumber=normalized(row.cardNumber).replace(/^#\s*/,"").replace(/\.0$/,"");
    const players=splitPlayers(row.subject);
    if(!cardNumber||!players.length||cardNumber.length>60) continue;
    const subjectKey=players.map((v)=>v.toLowerCase()).sort().join("+");
    const numberKey=`${setName.toLowerCase()}::${cardNumber.toLowerCase()}`;
    const exactKey=`${numberKey}::${subjectKey}`;
    if(exact.has(exactKey)) continue; exact.add(exactKey);
    const setText=setName.toLowerCase(); const auto=truthyFlag(row.auto)||/autograph|signature|signed/.test(setText); const mem=truthyFlag(row.mem)||/relic|memorabilia|patch|swatch|jersey|stick|glove/.test(setText); const sp=normalized(row.sp);
    const card={setName,cardNumber,players,teams:normalized(row.team)?[normalized(row.team)]:[],rookieDesignation:truthyFlag(row.rookie)||/(?:\bRC\b|\brookie\b)/i.test(row.subject),firstBowmanDesignation:false,autographStatus:auto?"autograph":"non-auto",memorabiliaStatus:mem?"memorabilia":"non-memorabilia",variation:/^(?:SP|SSP)$/i.test(sp)?sp.toUpperCase():null,sourceNotes:`Leaf structured source ${row.sheet} row ${row.row}${normalized(row.serial)?`; source serial ${normalized(row.serial)}`:""}`};
    const prior=byNumber.get(numberKey);
    if(prior&&prior.subjectKey!==subjectKey){ if(explicitlyMultiSubjectSet(setName)){ prior.card.players=[...new Set([...prior.card.players,...players])]; prior.card.teams=[...new Set([...prior.card.teams,...card.teams])]; prior.subjectKey=prior.card.players.map((v)=>v.toLowerCase()).sort().join("+"); continue; } errors.push({code:"reference_card_number_subject_conflict",severity:"error",message:`${setName} #${cardNumber} maps to conflicting subjects.`}); continue; }
    byNumber.set(numberKey,{subjectKey,card}); cards.push(card);
  }
  if(cards.length<MINIMUM_CARD_ROWS) errors.push({code:"reference_checklist_insufficient_rows",severity:"error",message:`Only ${cards.length} deterministic rows parsed; ${MINIMUM_CARD_ROWS} required.`});
  warnings.push({code:"leaf_parallel_rows_not_deterministic",severity:"warning",message:"Leaf recovery preserves explicit card facts and does not invent standalone parallel rows."});
  return {cards,parallels:[],warnings,errors};
}
function workbookRows(bytes,filename){ mkdirSync(TEMP_ROOT,{recursive:true}); const path=resolve(TEMP_ROOT,`${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`); writeFileSync(path,bytes); try{return JSON.parse(execFileSync("python3",["-c",PYTHON,path],{encoding:"utf8",maxBuffer:96*1024*1024,timeout:180000}));} finally{rmSync(path,{force:true});} }
function entryFor(target){ return {id:`leaf-hockey-${target.key}`,sourceName:new URL(target.sourceUrl).hostname,sourceUrl:target.sourceUrl,authority:"approved_reference_dataset",redistributionAllowed:false,minimumCardRows:MINIMUM_CARD_ROWS,release:{exactSetKey:target.exactSetKey,canonicalName:`${target.season} Leaf ${target.product} Hockey`,manufacturer:"Leaf",brand:null,product:target.product,releaseYear:target.releaseYear,season:target.season,sport:"hockey",league:null}}; }
async function persistWithRetry(plan,bytes,key){let last=null;for(let attempt=1;attempt<=4;attempt+=1){try{return await persistPlanManagement(plan,bytes);}catch(error){last=error instanceof Error?error:new Error(String(error));console.warn(`${key} attempt ${attempt}/4 failed: ${last.message}`);if(attempt===4||!transient(last.message))break;await sleep(Math.min(60000,10000*attempt));}}throw last||new Error(`Unknown persistence failure for ${key}`);}

async function main(){
  if(!ROOT||!existsSync(ROOT)) throw new Error(`LEAF_HOCKEY_SOURCE_ROOT is missing: ${ROOT}`);
  const receipt={schema:"tcos.officialLeafHockeyProduction.v1",targetCount:TARGETS.length,results:[]};
  const save=()=>{receipt.updatedAt=new Date().toISOString();receipt.liveCount=receipt.results.filter((r)=>["already_live","persisted"].includes(r.status)).length;receipt.alreadyLiveCount=receipt.results.filter((r)=>r.status==="already_live").length;receipt.persistedCount=receipt.results.filter((r)=>r.status==="persisted").length;receipt.failedCount=receipt.results.filter((r)=>r.status==="failed"||r.status==="validation_failed").length;receipt.unresolvedCount=TARGETS.length-receipt.liveCount;writeFileSync(OUTPUT,`${JSON.stringify(receipt,null,2)}\n`);};
  for(const target of TARGETS){
    const row={key:target.key,exactSetKey:target.exactSetKey,sourceUrl:target.sourceUrl};receipt.results.push(row);
    try{
      const entry=entryFor(target); const expectedPlan=buildPlan(entry,{cards:[{setName:"Base Set",cardNumber:"PREFLIGHT",players:["Preflight Placeholder"],teams:[],rookieDesignation:false,firstBowmanDesignation:false,autographStatus:"non-auto",memorabiliaStatus:"non-memorabilia",variation:null,sourceNotes:"preflight"}],parallels:[],warnings:[],errors:[]},{bytes:Buffer.from("preflight"),filename:"preflight.txt",mimeType:"text/plain",selectedUrl:target.sourceUrl,finalUrl:target.sourceUrl},new Date().toISOString());
      row.releaseSlug=expectedPlan.release.releaseSlug;
      const before=await preflightReleaseManagement(row.releaseSlug); row.preflight=before;
      if(before.complete){row.status="already_live";save();continue;}
      const path=resolve(ROOT,target.file); if(!existsSync(path)) throw new Error(`Missing downloaded Leaf source ${target.file}`); const bytes=readFileSync(path); if(bytes.length<200) throw new Error(`Leaf source ${target.file} is too small (${bytes.length} bytes)`);
      const source={bytes,filename:target.file,mimeType:target.mimeType,selectedUrl:target.sourceUrl,finalUrl:target.sourceUrl}; const raw=workbookRows(bytes,target.file); row.rawRows=raw.length; const parsed=parseRows(raw); const plan=buildPlan(entry,parsed,source,new Date().toISOString()); row.validation=plan.validation; row.releaseSlug=plan.release.releaseSlug; assertPlanComplexity(plan);
      if(plan.validation.status!=="passed"){row.status="validation_failed";row.error=JSON.stringify(plan.validation.issues.filter((x)=>x.severity==="error").slice(0,30));save();continue;}
      row.transaction=await persistWithRetry(plan,bytes,target.key); const after=await preflightReleaseManagement(plan.release.releaseSlug); row.postflight=after; if(!after.complete) throw new Error(`Production postflight incomplete for ${plan.release.releaseSlug}`); row.status="persisted";
    }catch(error){row.status="failed";row.error=error instanceof Error?error.message:String(error);}
    save();
  }
  save();rmSync(TEMP_ROOT,{recursive:true,force:true});console.log(JSON.stringify({targetCount:receipt.targetCount,liveCount:receipt.liveCount,alreadyLiveCount:receipt.alreadyLiveCount,persistedCount:receipt.persistedCount,failedCount:receipt.failedCount,unresolvedCount:receipt.unresolvedCount},null,2));if(receipt.liveCount!==TARGETS.length||receipt.failedCount!==0||receipt.unresolvedCount!==0)process.exitCode=2;
}
main().catch((error)=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1;});
