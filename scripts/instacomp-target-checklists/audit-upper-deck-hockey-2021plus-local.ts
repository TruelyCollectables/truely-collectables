import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { importChecklistArtifact } from "../../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../../src/lib/checklist-registry/source-adapter";

const CATEGORY = "https://upperdeck.com/checklist-category/hockey/";
const START = new Date("2021-07-01T00:00:00Z");
const OUTPUT = resolve(process.env.UPPER_DECK_AUDIT_RECEIPT || ".upper-deck-recovery/audit.json");
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.UPPER_DECK_AUDIT_CONCURRENCY || 6)));

function canonical(value: string, base: string) {
  const url = new URL(value, base); url.hash = ""; url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}
function stripTags(value: string) { return value.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim(); }
function parsedDate(value: string | null | undefined) { if (!value) return null; const t=Date.parse(value); return Number.isFinite(t)?new Date(t):null; }
function publishedAtFromBlock(block: string) {
  const dt=block.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1]; const p=parsedDate(dt); if(p)return p.toISOString();
  const text=stripTags(block); const human=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i)?.[0];
  return parsedDate(human)?.toISOString() || null;
}
function yearHint(url: string) { const s=new URL(url).pathname.toLowerCase(); const m=s.match(/(?:^|[^0-9])(20\d{2})(?:-(?:20)?\d{2})?(?:[^0-9]|$)/); return m?Number(m[1]):null; }
async function fetchHtml(url: string) {
  let last: unknown = null;
  for(let attempt=1;attempt<=4;attempt++) try {
    const r=await fetch(url,{headers:{Accept:"text/html,application/xhtml+xml","User-Agent":"TCOS-InstaComp-UD-Audit/1.0"},redirect:"follow",signal:AbortSignal.timeout(60_000)});
    if(!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`); const text=await r.text(); if(text.length<1000) throw new Error(`short HTML ${text.length}`); return text;
  } catch(e){last=e; if(attempt<4) await new Promise(r=>setTimeout(r,2000*attempt));}
  throw last;
}
async function discover() {
  const found=new Map<string,{url:string,publishedAt:string|null}>();
  for(let page=1;page<=40;page++) {
    const pageUrl=page===1?CATEGORY:`${CATEGORY}page/${page}/`;
    let html:string; try{html=await fetchHtml(pageUrl);}catch(e){if(page>1 && /404/.test(String(e)))break;throw e;}
    const blocks=[...html.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map(m=>m[0]);
    const sources:string[]=[];
    if(blocks.length) {
      for(const block of blocks) for(const m of block.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) try { const u=canonical(m[1],pageUrl); if(/^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/[^/]+\/$/i.test(u)){sources.push(u); const pub=publishedAtFromBlock(block); const yh=yearHint(u); if((yh??9999)>=2021 && (!pub || new Date(pub)>=START)) found.set(u,{url:u,publishedAt:pub}); break;} } catch {}
    } else {
      for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) try { const u=canonical(m[1],pageUrl); if(!/^https:\/\/(?:www\.)?upperdeck\.com\/checklist\/[^/]+\/$/i.test(u))continue; const i=m.index||0; const near=html.slice(Math.max(0,i-3000),Math.min(html.length,i+3000)); const pub=publishedAtFromBlock(near); const yh=yearHint(u); if((yh??9999)>=2021 && (!pub || new Date(pub)>=START)) found.set(u,{url:u,publishedAt:pub}); } catch {}
    }
    if(!sources.length && page>1) break;
  }
  return [...found.values()];
}
function canonicalizePlan(plan:any){
  const norm=(v:any)=>String(v??"").trim().toLowerCase().replaceAll("&"," and ").replace(/[^\p{L}\p{N}/]+/gu," ")||null;
  const by=new Map<string,any>(), alias=new Map<string,string>(), configs=new Map<string,Set<string>>(), parallels:any[]=[];
  for(const p of plan.parallels||[]){const k=JSON.stringify([String(p.setSourceKey||""),norm(p.name),Number(p.serialRun||0)]); if(!configs.has(k))configs.set(k,new Set()); configs.get(k)!.add(String(p.configurationExclusivity||"")); if(!by.has(k)){by.set(k,p);alias.set(String(p.sourceKey),String(p.sourceKey));parallels.push({...p});} else alias.set(String(p.sourceKey),String(by.get(k).sourceKey));}
  for(const p of parallels){const k=JSON.stringify([String(p.setSourceKey||""),norm(p.name),Number(p.serialRun||0)]); if((configs.get(k)?.size||0)>1)p.configurationExclusivity=null;}
  const identities:any[]=[]; const seen=new Set<string>();
  for(const i of plan.identities||[]){const x={...i,parallelSourceKey:i.parallelSourceKey?(alias.get(String(i.parallelSourceKey))||i.parallelSourceKey):null}; const fk=`${x.fingerprint?.schema||""}|${x.fingerprint?.fingerprintSha256||""}`; if(seen.has(fk))continue; seen.add(fk); identities.push(x);}
  return {...plan,parallels,identities,validation:{...plan.validation,counts:{...plan.validation.counts,parallels:parallels.length,identities:identities.length}}};
}
async function auditOne(candidate:{url:string,publishedAt:string|null}){
  try{
    const content=await fetchHtml(candidate.url); const artifact:ChecklistSourceArtifact={sourceUrl:candidate.url,originalFilename:`${new URL(candidate.url).pathname.split('/').filter(Boolean).at(-1)}.html`,mimeType:"text/html",content,retrievedAt:new Date().toISOString(),authority:"official_manufacturer",redistributionAllowed:false};
    const parsed=await importChecklistArtifact({artifact,validateOnly:true}); const plan=canonicalizePlan(parsed.plan); const errors=plan.validation.issues.filter((x:any)=>x.severity==="error");
    return {sourceUrl:candidate.url,publishedAt:candidate.publishedAt,adapter:parsed.adapter,release:plan.release,counts:plan.validation.counts,status:errors.length?"validation_failed":"ready",errors:errors.slice(0,30),warnings:plan.validation.issues.filter((x:any)=>x.severity==="warning").slice(0,30)};
  }catch(e){return {sourceUrl:candidate.url,publishedAt:candidate.publishedAt,status:"failed",message:e instanceof Error?e.message:String(e)};}
}
async function main(){mkdirSync(dirname(OUTPUT),{recursive:true}); const candidates=await discover(); const results:any[]=[]; let next=0; async function worker(){while(true){const i=next++; if(i>=candidates.length)return; const row=await auditOne(candidates[i]); results[i]=row; console.log(`[${i+1}/${candidates.length}] ${row.status} ${candidates[i].url}`); writeFileSync(OUTPUT,JSON.stringify({updatedAt:new Date().toISOString(),candidateCount:candidates.length,completedCount:results.filter(Boolean).length,results:results.filter(Boolean)},null,2));}} await Promise.all(Array.from({length:CONCURRENCY},worker)); const counts=results.reduce((a:any,x:any)=>(a[x.status]=(a[x.status]||0)+1,a),{}); const unresolved=results.filter(x=>x.status!=="ready"); const receipt={updatedAt:new Date().toISOString(),candidateCount:candidates.length,counts,unresolvedCount:unresolved.length,unresolved,results}; writeFileSync(OUTPUT,JSON.stringify(receipt,null,2)); console.log(JSON.stringify({candidateCount:candidates.length,counts,unresolvedCount:unresolved.length},null,2)); if(candidates.length<150)throw new Error(`Expected full Upper Deck census, got ${candidates.length}`); if(unresolved.length)process.exitCode=1;}
main().catch(e=>{console.error(e);process.exitCode=1});