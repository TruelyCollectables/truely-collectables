import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), ".sportlots-public-checklists");
const PAGES = resolve(ROOT, "sets");
const STATE_FILE = resolve(ROOT, "checkpoint.json");
const MANIFEST_FILE = resolve(ROOT, "manifest.json");
const START_YEAR = Number(process.env.SPORTLOTS_START_YEAR || 2026);
const END_YEAR = Number(process.env.SPORTLOTS_END_YEAR || 2001);
const MAX_INDEX_PAGES = Number(process.env.SPORTLOTS_MAX_INDEX_PAGES || 120);
const MAX_SET_PAGES = Number(process.env.SPORTLOTS_MAX_SET_PAGES || 25000);
const DELAY_MS = Number(process.env.SPORTLOTS_DELAY_MS || 1200);
const REQUEST_TIMEOUT_MS = Number(process.env.SPORTLOTS_REQUEST_TIMEOUT_MS || 25000);
const RETRIES = Number(process.env.SPORTLOTS_RETRIES || 2);
const CHECKPOINT_EVERY = Number(process.env.SPORTLOTS_CHECKPOINT_EVERY || 25);
const SPORTS = ["Baseball","Basketball","Football","Hockey","Racing","Soccer","Golf","Wrestling","Gaming","NonSport","MultiSport"];
const UA = "TCOS-Sportlots-Public-Checklist-Audit/2.0 (+public pages only; no pricing; no login)";

mkdirSync(PAGES, { recursive: true });
const sleep = (ms:number) => new Promise((r) => setTimeout(r, ms));

function clean(html:string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|h1|h2|h3|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#39;|&#039;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function slug(s:string) { return s.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,180) || "set"; }

async function get(url:string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (error) {
      lastError = error;
      console.log(JSON.stringify({ phase: "retry", url, attempt, error: error instanceof Error ? error.message : String(error) }));
      if (attempt <= RETRIES) await sleep(Math.min(5000, attempt * 1500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function setLinks(html:string, sport:string, year:number) {
  const out = new Map<string,string>();
  const re = new RegExp(`href=["']([^"']*\\/${sport}\\/sets\\/${year}-[^"']+\\.tpl)["'][^>]*>([\\s\\S]*?)<\\/a>`,"gi");
  for(const m of html.matchAll(re)) {
    const url = new URL(m[1],"https://www.sportlots.com").toString();
    out.set(url, clean(m[2]));
  }
  return [...out.entries()].map(([url,title])=>({url,title}));
}
function titleFrom(html:string,url:string) {
  return clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url).slice(0,300);
}
function cardRows(text:string) {
  const rows:string[]=[];
  for(const line of text.split(/\n+/)) {
    const v=line.trim();
    if(/(?:^|\s)#(?:[A-Z0-9-]+)\s+/i.test(v) && v.length < 500) rows.push(v);
  }
  return [...new Set(rows)];
}

type Candidate = { sport:string; year:number; title:string; indexUrl:string };
type State = {
  schema:string;
  updatedAt:string;
  indexDone:string[];
  candidates:[string,Candidate][];
  sets:any[];
  pageFailures:any[];
  indexFailures:any[];
  processedSetUrls:string[];
};

function loadState(): State {
  if (!existsSync(STATE_FILE)) return { schema:"tcos.sportlotsCheckpoint.v1", updatedAt:new Date().toISOString(), indexDone:[], candidates:[], sets:[], pageFailures:[], indexFailures:[], processedSetUrls:[] };
  try { return JSON.parse(readFileSync(STATE_FILE,"utf8")); }
  catch { return { schema:"tcos.sportlotsCheckpoint.v1", updatedAt:new Date().toISOString(), indexDone:[], candidates:[], sets:[], pageFailures:[], indexFailures:[], processedSetUrls:[] }; }
}

function summarize(candidates:Map<string,Candidate>, sets:any[], pageFailures:any[], indexFailures:any[]) {
  const byYear:Record<string,any>={};
  for(let year=START_YEAR;year>=END_YEAR;year--) byYear[String(year)]={candidates:0,saved:0,withPublicCardRows:0,setIdentityOnly:0,failed:0};
  for(const row of candidates.values()) byYear[String(row.year)].candidates++;
  for(const row of sets){ const y=byYear[String(row.year)]; y.saved++; row.publicCardRows?y.withPublicCardRows++:y.setIdentityOnly++; }
  for(const row of pageFailures) if (byYear[String(row.year)]) byYear[String(row.year)].failed++;
  return { byYear, totals:{discoveredSets:candidates.size,savedSetPages:sets.length,withPublicCardRows:sets.filter(r=>r.publicCardRows>0).length,setIdentityOnly:sets.filter(r=>!r.publicCardRows).length,failedSetPages:pageFailures.length,indexFailures:indexFailures.length} };
}

function saveCheckpoint(state:State, candidates:Map<string,Candidate>) {
  state.updatedAt = new Date().toISOString();
  state.candidates = [...candidates.entries()];
  writeFileSync(STATE_FILE, JSON.stringify(state,null,2)+"\n");
  const summary = summarize(candidates,state.sets,state.pageFailures,state.indexFailures);
  const manifest={schema:"tcos.sportlotsPublicChecklistAudit.v2",generatedAt:new Date().toISOString(),partial:true,scope:{startYear:START_YEAR,endYear:END_YEAR,deferredVintage:"2000 and earlier",sports:SPORTS,publicPagesOnly:true,pricingCollected:false,loginUsed:false},...summary,sets:state.sets,pageFailures:state.pageFailures,indexFailures:state.indexFailures};
  writeFileSync(MANIFEST_FILE,JSON.stringify(manifest,null,2)+"\n");
  console.log(JSON.stringify({phase:"checkpoint",updatedAt:state.updatedAt,...summary.totals,indexPagesCompleted:state.indexDone.length,processedSetUrls:state.processedSetUrls.length}));
}

async function main(){
  const state = loadState();
  const candidates = new Map<string,Candidate>(state.candidates || []);
  const indexDone = new Set(state.indexDone || []);
  const processedSetUrls = new Set(state.processedSetUrls || []);
  let operations = 0;

  saveCheckpoint(state,candidates);

  for(let year=START_YEAR;year>=END_YEAR;year--){
    for(const sport of SPORTS){
      let empty=0;
      for(let page=1;page<=MAX_INDEX_PAGES;page++){
        const key=`${year}|${sport}|${page}`;
        if(indexDone.has(key)) continue;
        const url=page===1?`https://www.sportlots.com/${sport}/sets/${year}.tpl`:`https://www.sportlots.com/${sport}/sets/${year}-${page}.tpl`;
        try{
          const html=await get(url); const found=setLinks(html,sport,year); let added=0;
          for(const row of found){ if(!candidates.has(row.url)){candidates.set(row.url,{sport,year,title:row.title,indexUrl:url});added++;} }
          console.log(JSON.stringify({phase:"index",year,sport,page,found:found.length,added,total:candidates.size}));
          empty=found.length?0:empty+1;
          indexDone.add(key); state.indexDone=[...indexDone];
          if(page>2&&empty>=2) break;
        }catch(error){
          state.indexFailures.push({url,error:error instanceof Error?error.message:String(error)});
          indexDone.add(key); state.indexDone=[...indexDone];
          empty++;
          if(page>2&&empty>=2) break;
        }
        operations++;
        if(operations % CHECKPOINT_EVERY===0) saveCheckpoint(state,candidates);
        await sleep(DELAY_MS);
      }
      saveCheckpoint(state,candidates);
    }
  }

  let ordinal=state.sets.length;
  for(const [url,meta] of [...candidates.entries()].slice(0,MAX_SET_PAGES)){
    if(processedSetUrls.has(url)) continue;
    ordinal++;
    try{
      const html=await get(url); const text=clean(html); const title=titleFrom(html,url); const rows=cardRows(text);
      const filename=`${String(ordinal).padStart(6,"0")}-${meta.year}-${slug(meta.sport)}-${slug(title)}.txt`;
      writeFileSync(resolve(PAGES,filename),`SOURCE: ${url}\nINDEX: ${meta.indexUrl}\nSPORT: ${meta.sport}\nYEAR: ${meta.year}\nTITLE: ${title}\nPUBLIC_CARD_ROWS: ${rows.length}\n\n${text}\n`);
      state.sets.push({url,...meta,title,filename,textBytes:Buffer.byteLength(text),publicCardRows:rows.length,coverage:rows.length?"card_rows_public":"set_identity_only"});
    }catch(error){ state.pageFailures.push({url,...meta,error:error instanceof Error?error.message:String(error)}); }
    processedSetUrls.add(url); state.processedSetUrls=[...processedSetUrls];
    if(ordinal%25===0) saveCheckpoint(state,candidates);
    await sleep(DELAY_MS);
  }

  saveCheckpoint(state,candidates);
  const summary=summarize(candidates,state.sets,state.pageFailures,state.indexFailures);
  const manifest={schema:"tcos.sportlotsPublicChecklistAudit.v2",generatedAt:new Date().toISOString(),partial:false,scope:{startYear:START_YEAR,endYear:END_YEAR,deferredVintage:"2000 and earlier",sports:SPORTS,publicPagesOnly:true,pricingCollected:false,loginUsed:false},...summary,sets:state.sets,pageFailures:state.pageFailures,indexFailures:state.indexFailures};
  writeFileSync(MANIFEST_FILE,JSON.stringify(manifest,null,2)+"\n");
  console.log(JSON.stringify(manifest.totals));
  if(!state.sets.length) process.exitCode=1;
}
main().catch((e)=>{console.error(e instanceof Error?e.stack||e.message:String(e));process.exitCode=1;});
