import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan, dbClient } from "../mainstream-checklist/registry-tools.mjs";
import { normalized } from "../mainstream-checklist/source-tools.mjs";
import { persistPlanStaged } from "./staged-registry-writer.mjs";

const ROOT=resolve(process.env.VERIFIED_HARVEST_ROOT||"");
const OUTPUT=resolve(process.env.GROUPED_WORKBOOK_RECEIPT||`${ROOT}/grouped-workbook-recovery-receipt.json`);
const TEMP_ROOT=resolve(process.cwd(),".checklist-discovery/grouped-workbook-tmp");
const MINIMUM_CARD_ROWS=20;
const EXACT_KEYS=new Set([
  "hockey|2021-22|upper-deck|black-diamond-nhl",
  "hockey|2021-22|upper-deck|sp-game-used-nhl",
]);
if(!ROOT||!existsSync(ROOT))throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath=resolve(ROOT,"output/summary.json"),sourcesDir=resolve(ROOT,"output/sources");
const safeSlug=(value)=>String(value||"").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^_+|_+$/g,"")||"target";
const displayToken=(value)=>String(value||"").split("-").filter(Boolean).map((part)=>({nhl:"NHL",wnba:"WNBA"}[part.toLowerCase()]||`${part.slice(0,1).toUpperCase()}${part.slice(1)}`)).join(" ");
function buildEntry(row,sourceUrl){const [sport,season,manufacturerKey,productKey]=row.exactSetKey.split("|");const manufacturer=displayToken(manufacturerKey),product=displayToken(productKey);return{id:`grouped-workbook-${safeSlug(row.exactSetKey)}`,sourceName:new URL(sourceUrl).hostname,sourceUrl,authority:"official_manufacturer",redistributionAllowed:false,minimumCardRows:MINIMUM_CARD_ROWS,release:{exactSetKey:row.exactSetKey,canonicalName:`${season} ${manufacturer} ${product} ${displayToken(sport)}`,manufacturer,brand:null,product,releaseYear:Number(season.slice(0,4)),season,sport,league:null}};}

const PYTHON=String.raw`
import json,re,sys
path=sys.argv[1]
def text(v):
    if v is None:return ''
    if isinstance(v,float) and v.is_integer():return str(int(v))
    return str(v).strip()
def key(v):return re.sub(r'[^a-z0-9]+',' ',text(v).lower()).strip()
if path.lower().endswith('.xlsx'):
    import openpyxl
    wb=openpyxl.load_workbook(path,read_only=True,data_only=True)
    sheets=[(ws.title,[list(r) for r in ws.iter_rows(values_only=True)]) for ws in wb.worksheets]
else:
    import xlrd
    wb=xlrd.open_workbook(path); sheets=[]
    for ws in wb.sheets():sheets.append((ws.name,[[ws.cell_value(r,c) for c in range(ws.ncols)] for r in range(ws.nrows)]))
CARD={'card','card number','card no','card num','checklist'};SET={'set','set name','card set','subset','insert set'};SUBJECT={'description','player','athlete','subject','name'};TEAM={'team','team name','teamname'};CITY={'team city','teamcity'};ROOKIE={'rookie','rc'};AUTO={'auto','autograph','autographs'};MEM={'mem','mem tech','memorabilia','relic'};SERIAL={'serial d','serial','d','d to'}
out=[]
for sheet,rows in sheets:
    header=None;cols={}
    for ridx,row in enumerate(rows[:40]):
        h=[key(v) for v in row]
        def find(names):
            for i,v in enumerate(h):
                if v in names:return i
            return None
        c=find(CARD);s=find(SET);sub=find(SUBJECT)
        if c is not None and sub is not None:
            header=ridx;cols={'card':c,'set':s,'subject':sub,'team':find(TEAM),'city':find(CITY),'rookie':find(ROOKIE),'auto':find(AUTO),'mem':find(MEM),'serial':find(SERIAL)};break
    if header is None:continue
    last_set=''
    for ridx,row in enumerate(rows[header+1:],header+2):
        def at(name):
            i=cols.get(name);return text(row[i]) if i is not None and i<len(row) else ''
        card=at('card').lstrip('#').strip()
        if not card or key(card) in CARD:continue
        set_name=at('set') or last_set or 'Base Set'
        if at('set'):last_set=at('set')
        subject=at('subject')
        if not subject:continue
        team=' '.join(x for x in [at('city'),at('team')] if x).strip()
        out.append({'sheet':sheet,'row':ridx,'setName':set_name,'cardNumber':card,'subject':subject,'team':team,'rookie':at('rookie'),'auto':at('auto'),'mem':at('mem'),'serial':at('serial')})
print(json.dumps(out,ensure_ascii=False))
`;
function rowsFromWorkbook(bytes,filename){mkdirSync(TEMP_ROOT,{recursive:true});const path=resolve(TEMP_ROOT,`${Date.now()}-${filename}`);writeFileSync(path,bytes);try{return JSON.parse(execFileSync("python3",["-c",PYTHON,path],{encoding:"utf8",maxBuffer:64*1024*1024,timeout:180000}));}finally{rmSync(path,{force:true});}}
const truthy=(value)=>{const v=normalized(value).toLowerCase();return Boolean(v)&&!/^(?:0|n|no|false|none|-)$/.test(v);};
const splitPlayers=(subject)=>{const cleaned=normalized(subject).replace(/\s+-\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/," ").replace(/\s+(?:RC|ROOKIE CARD|ROOKIE)$/i,"").trim();return cleaned?[cleaned]:[];};
function mergeAllowed(key,setName,prior,card){
  if(key==="hockey|2021-22|upper-deck|sp-game-used-nhl"&&/^Tonight's Lineup$/i.test(setName))return true;
  if(key==="hockey|2021-22|upper-deck|black-diamond-nhl"&&/^Team Logo Jumbo/i.test(setName)&&normalized(prior.teams?.[0]).toLowerCase()===normalized(card.teams?.[0]).toLowerCase())return true;
  return false;
}
function parseRows(entry,rawRows){
  const cards=[],errors=[],warnings=[],byNumber=new Map(),exact=new Set(),key=entry.release.exactSetKey;
  for(const row of rawRows){
    const setName=normalized(row.setName).slice(0,160)||"Base Set";let cardNumber=normalized(row.cardNumber).replace(/\.0$/,"");
    if(key==="hockey|2021-22|upper-deck|black-diamond-nhl"&&setName==="Band of Color Rookies"&&cardNumber==="BCR-MM"&&normalized(row.subject).toLowerCase()==="david farrance")cardNumber="BCR-DF";
    const players=splitPlayers(row.subject);if(!cardNumber||!players.length)continue;
    const subjectKey=players.map((v)=>v.toLowerCase()).sort().join("+");const numberKey=`${setName.toLowerCase()}::${cardNumber.toLowerCase()}`;const exactKey=`${numberKey}::${subjectKey}`;if(exact.has(exactKey))continue;exact.add(exactKey);
    const setText=setName.toLowerCase();const auto=truthy(row.auto)||/autograph|signature|signed/.test(setText);const mem=truthy(row.mem)||/relic|memorabilia|patch|swatch|jersey/.test(setText);
    const card={setName,cardNumber,players,teams:normalized(row.team)?[normalized(row.team)]:[],rookieDesignation:truthy(row.rookie)||/\brookie\b/i.test(setText),firstBowmanDesignation:false,autographStatus:auto?"autograph":"non-auto",memorabiliaStatus:mem?"memorabilia":"non-memorabilia",variation:null,sourceNotes:`Official workbook ${row.sheet} row ${row.row}${normalized(row.serial)?`; source serial ${normalized(row.serial)}`:""}`};
    const prior=byNumber.get(numberKey);
    if(prior&&prior.subjectKey!==subjectKey){
      if(mergeAllowed(key,setName,prior.card,card)){prior.card.players=[...new Set([...prior.card.players,...card.players])];prior.card.teams=[...new Set([...prior.card.teams,...card.teams])];prior.subjectKey=prior.card.players.map((v)=>v.toLowerCase()).sort().join("+");prior.card.sourceNotes=normalized(`${prior.card.sourceNotes}; ${card.sourceNotes}; source-proven grouped physical card`);continue;}
      errors.push({code:"reference_card_number_subject_conflict",severity:"error",message:`${setName} #${cardNumber} maps to conflicting subjects.`});continue;
    }
    byNumber.set(numberKey,{subjectKey,card});cards.push(card);
  }
  if(cards.length<MINIMUM_CARD_ROWS)errors.push({code:"reference_checklist_insufficient_rows",severity:"error",message:`Only ${cards.length} deterministic card rows were parsed.`});
  warnings.push({code:"reference_parallel_rows_not_deterministic",severity:"warning",message:"Grouped workbook recovery preserves explicit source facts without inventing standalone parallel mappings."});
  return{cards,parallels:[],warnings,errors};
}
async function persist(db,plan,bytes,key){let last;for(let i=1;i<=4;i+=1){try{return await persistPlanStaged(db,plan,bytes);}catch(error){last=error instanceof Error?error:new Error(String(error));console.warn(`${key} persist attempt ${i}/4 failed: ${last.message}`);if(!/timeout|too many connections|connection terminated|fetch failed|network/i.test(last.message)||i===4)break;await new Promise((r)=>setTimeout(r,10000*i));}}throw last;}

const summary=JSON.parse(readFileSync(summaryPath,"utf8")),sourceFiles=readdirSync(sourcesDir),candidates=(summary.validationFailed||[]).filter((row)=>EXACT_KEYS.has(row.exactSetKey));
if(candidates.length!==2)throw new Error(`Expected 2 grouped workbook targets, found ${candidates.length}.`);
const db=dbClient(),results=[];
for(const row of candidates){const slug=safeSlug(row.exactSetKey),sourceName=sourceFiles.find((name)=>name.startsWith(`${slug}__`));if(!sourceName){results.push({exactSetKey:row.exactSetKey,status:"failed",error:"Source missing"});continue;}const bytes=readFileSync(resolve(sourcesDir,sourceName)),filename=sourceName.slice(sourceName.indexOf("__")+2),sourceUrl=row.selectedUrl||row.finalUrl||row.sourceUrl,source={bytes,filename,mimeType:filename.endsWith(".xlsx")?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"application/vnd.ms-excel",selectedUrl:sourceUrl,finalUrl:row.finalUrl||sourceUrl},entry=buildEntry(row,sourceUrl);try{const raw=rowsFromWorkbook(bytes,filename),parsed=parseRows(entry,raw),plan=buildPlan(entry,parsed,source,new Date().toISOString()),complexity=assertPlanComplexity(plan);if(plan.validation.status!=="passed"){results.push({exactSetKey:row.exactSetKey,status:"validation_failed",counts:plan.validation.counts,errors:plan.validation.issues.filter((x)=>x.severity==="error")});continue;}const transaction=await persist(db,plan,bytes,row.exactSetKey);results.push({exactSetKey:row.exactSetKey,status:"persisted",counts:plan.validation.counts,serializedBytes:complexity.serializedBytes,transaction});}catch(error){results.push({exactSetKey:row.exactSetKey,status:"failed",error:error instanceof Error?error.message:String(error)});}}
rmSync(TEMP_ROOT,{recursive:true,force:true});const persisted=results.filter((r)=>r.status==="persisted"),failed=results.filter((r)=>r.status!=="persisted");const receipt={schema:"tcos.checklist.groupedWorkbookRecovery.v1",targetCount:2,attemptedCount:results.length,persistedCount:persisted.length,failedCount:failed.length,persistedCards:persisted.reduce((s,r)=>s+Number(r.counts?.cards||0),0),persistedIdentities:persisted.reduce((s,r)=>s+Number(r.counts?.identities||0),0),results};writeFileSync(OUTPUT,`${JSON.stringify(receipt,null,2)}\n`);console.log(JSON.stringify({targetCount:2,attemptedCount:results.length,persistedCount:persisted.length,failedCount:failed.length,persistedCards:receipt.persistedCards,persistedIdentities:receipt.persistedIdentities},null,2));if(failed.length||results.length!==2)process.exitCode=2;
