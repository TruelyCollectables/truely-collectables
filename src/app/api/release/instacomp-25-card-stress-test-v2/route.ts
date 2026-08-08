import { NextRequest } from "next/server";
import { POST as runIdentityScan } from "../../instacomp/scan/route";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getInstaCompServiceToken } from "../../../../lib/tcos-profit-hunter-secrets";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EBAY_API = "https://api.ebay.com";
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SEARCHES = [
  ["Basketball", "basketball rookie autograph numbered card"],
  ["Basketball", "WNBA rookie autograph card"],
  ["Basketball", "basketball rookie patch auto card"],
  ["Baseball", "Bowman Chrome prospect autograph card"],
  ["Baseball", "baseball rookie autograph numbered card"],
  ["Baseball", "baseball rookie patch auto card"],
  ["Football", "football rookie autograph numbered card"],
  ["Football", "football rookie patch auto card"],
  ["Football", "football rookie parallel numbered card"],
  ["Hockey", "hockey rookie autograph numbered card"],
  ["Hockey", "Upper Deck Young Guns numbered parallel"],
  ["Hockey", "hockey rookie patch auto card"],
] as const;
const QUOTAS: Record<string, number> = { Basketball: 6, Baseball: 6, Football: 6, Hockey: 7 };

type Aspect = { name?: string | null; value?: string | null };
type EImage = { imageUrl?: string | null };
type EItem = {
  itemId?: string | null;
  legacyItemId?: string | null;
  title?: string | null;
  itemWebUrl?: string | null;
  image?: EImage | null;
  additionalImages?: EImage[] | null;
  localizedAspects?: Aspect[] | null;
};
type Expected = {
  sport: string;
  player: string;
  year: string;
  brand: string;
  setName: string;
  cardNumber: string;
  parallel: string | null;
  isRookie: boolean | null;
  isAuto: boolean | null;
  isRelic: boolean | null;
  serialExact: string | null;
  serialRun: number | null;
};
type Candidate = {
  sport: string;
  itemId: string;
  title: string;
  url: string;
  imageUrls: string[];
  expected: Expected;
  complexity: number;
};
type Roles = { frontIndex: number; backIndex: number; confidence: number; method: "openai" | "fallback"; note: string };

function clean(v: unknown) { return String(v ?? "").replace(/\s+/g, " ").trim(); }
function norm(v: unknown) { return clean(v).toLowerCase().normalize("NFKD").replace(/[^a-z0-9/]+/g, " ").replace(/\s+/g, " ").trim(); }
function compactCard(v: unknown) { return norm(v).replace(/[^a-z0-9]/g, ""); }
function phrase(actual: unknown, expected: unknown) {
  const a = norm(actual), e = norm(expected);
  if (!a || !e) return false;
  if (a === e || a.includes(e) || e.includes(a)) return true;
  const at = a.split(" ").filter(t => t.length > 1), et = e.split(" ").filter(t => t.length > 1);
  const overlap = at.filter(t => et.includes(t)).length;
  return overlap / Math.max(1, Math.min(at.length, et.length)) >= 0.75;
}
function season(v: unknown) {
  const raw = clean(v).replace(/[–—]/g, "-");
  const m = raw.match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2,4})\b/);
  if (!m) return norm(raw);
  return `${m[1]}-${m[2].length === 2 ? `${m[1].slice(0,2)}${m[2]}` : m[2]}`;
}
function exactSerial(v: unknown) {
  const m = clean(v).match(/(?:^|\D)(\d{1,4})\s*\/\s*(\d{1,5})(?:\D|$)/);
  if (!m) return null;
  const n = Number(m[1]), d = Number(m[2]);
  return d >= 1 && n <= d ? `${n}/${d}` : null;
}
function serialRun(v: unknown) {
  const matches = Array.from(clean(v).matchAll(/\/\s*(\d{1,5})\b/g));
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : null;
}
function images(item: EItem) {
  return Array.from(new Set([
    clean(item.image?.imageUrl),
    ...(item.additionalImages || []).map(x => clean(x?.imageUrl)),
  ].filter(Boolean))).map(url => url.replace(/\/s-l\d+(?=\.(?:jpe?g|png|webp)(?:\?|$))/i, "/s-l1600"));
}
function mapAspects(item: EItem) {
  const m = new Map<string,string>();
  for (const row of item.localizedAspects || []) {
    const k = norm(row?.name), v = clean(row?.value);
    if (k && v && !m.has(k)) m.set(k,v);
  }
  return m;
}
function getAspect(m: Map<string,string>, names: string[]) {
  for (const name of names) { const v = m.get(norm(name)); if (v) return v; }
  return null;
}
function rejectTitle(title: string) {
  return /\b(?:lot|team set|complete set|reprint|custom|digital|nft|break|you pick|choose your card|psa|bgs|sgc|cgc|graded|gem mint|box|case|pack)\b/i.test(title);
}
function expectedFrom(item: EItem, fallbackSport: string): Expected | null {
  const m = mapAspects(item), title = clean(item.title);
  const player = getAspect(m,["Player/Athlete","Player"]);
  const year = getAspect(m,["Season","Year Manufactured"]);
  const brand = getAspect(m,["Manufacturer","Brand"]);
  const setName = getAspect(m,["Set"]);
  const cardNumber = getAspect(m,["Card Number"]);
  if (!player || !year || !brand || !setName || !cardNumber) return null;
  if (!phrase(title, player)) return null;
  const parallel = getAspect(m,["Parallel/Variety"]);
  const features = [getAspect(m,["Features"]), getAspect(m,["Card Attributes"]), title].filter(Boolean).join(" | ");
  const auto = getAspect(m,["Autographed"]);
  const relic = getAspect(m,["Memorabilia","Relic"]);
  const serialText = [getAspect(m,["Card Serial Number","Serial Number","Print Run"]), title].filter(Boolean).join(" | ");
  let isRookie: boolean | null = null;
  if (/\brookie\b|\brc\b/i.test(features)) isRookie = true;
  else if (getAspect(m,["Features"])) isRookie = false;
  let isAuto: boolean | null = null;
  if (auto) isAuto = /yes|true/i.test(auto); else if (/\bauto(?:graph)?\b|signed/i.test(title)) isAuto = true;
  let isRelic: boolean | null = null;
  if (relic) isRelic = /yes|true|patch|relic|jersey|memorabilia|swatch/i.test(relic);
  else if (/patch|relic|jersey|memorabilia|swatch|rpa/i.test(features)) isRelic = true;
  return {
    sport: getAspect(m,["Sport"]) || fallbackSport,
    player, year, brand, setName, cardNumber, parallel,
    isRookie, isAuto, isRelic,
    serialExact: exactSerial(serialText), serialRun: serialRun(serialText),
  };
}
function complexity(e: Expected, title: string, count: number) {
  let score = count === 2 ? 4 : 0;
  if (e.isAuto === true) score += 6;
  if (e.isRelic === true) score += 6;
  if (e.serialRun) score += 6;
  if (e.parallel) score += 3;
  if (e.isRookie === true) score += 2;
  if (/1\/1|one of one/i.test(title)) score += 4;
  return score;
}
function bearer(req: Request) { const a=req.headers.get("authorization")||""; return a.startsWith("Bearer ")?a.slice(7).trim():""; }
async function authorized(req: Request) {
  const token=bearer(req); if(!token) return false;
  try {
    const r=await fetch("https://api.vercel.com/v2/teams?limit=100",{headers:{Authorization:`Bearer ${token}`},cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!r.ok) return false;
    const p=(await r.json()) as {teams?:unknown}; return releaseRuntimeTeamIsAllowed(p.teams);
  } catch { return false; }
}

let tokenCache:{token:string;expires:number}|null=null;
async function ebayToken() {
  if(tokenCache && tokenCache.expires>Date.now()+60000) return tokenCache.token;
  const id=clean(process.env.EBAY_CLIENT_ID), secret=clean(process.env.EBAY_CLIENT_SECRET);
  if(!id||!secret) throw new Error("Production eBay credentials are missing.");
  const r=await fetch(`${EBAY_API}/identity/v1/oauth2/token`,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"client_credentials",scope:"https://api.ebay.com/oauth/api_scope"}),cache:"no-store",signal:AbortSignal.timeout(30000)});
  const p=await r.json().catch(()=>({})); if(!r.ok||!p?.access_token) throw new Error("eBay OAuth failed.");
  tokenCache={token:String(p.access_token),expires:Date.now()+Math.max(300,Number(p.expires_in)||7200)*1000}; return tokenCache.token;
}
async function hydrate(token:string,itemId:string):Promise<EItem|null>{
  const r=await fetch(`${EBAY_API}/buy/browse/v1/item/${encodeURIComponent(itemId)}`,{headers:{Authorization:`Bearer ${token}`,"X-EBAY-C-MARKETPLACE-ID":"EBAY_US","X-EBAY-C-ENDUSERCTX":"contextualLocation=country=US,zip=80014"},cache:"no-store",signal:AbortSignal.timeout(30000)});
  return r.ok ? (await r.json()) as EItem : null;
}
async function search(sport:string,query:string):Promise<Candidate[]> {
  const token=await ebayToken();
  const u=new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`); u.searchParams.set("q",query);u.searchParams.set("category_ids","261328");u.searchParams.set("limit","50");
  const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`,"X-EBAY-C-MARKETPLACE-ID":"EBAY_US","X-EBAY-C-ENDUSERCTX":"contextualLocation=country=US,zip=80014"},cache:"no-store",signal:AbortSignal.timeout(30000)});
  const p=await r.json().catch(()=>({})); if(!r.ok) throw new Error(`eBay search failed for ${sport}.`);
  const summaries=(Array.isArray(p?.itemSummaries)?p.itemSummaries:[]) as EItem[];
  const shortlist=summaries.filter(x=>clean(x.itemId)&&clean(x.title)&&!rejectTitle(clean(x.title))).slice(0,14);
  const detailed=await Promise.all(shortlist.map(x=>hydrate(token,clean(x.itemId))));
  const out:Candidate[]=[];
  for(const item of detailed){
    if(!item) continue; const itemId=clean(item.itemId), title=clean(item.title), url=clean(item.itemWebUrl), urls=images(item);
    if(!itemId||!title||!url||urls.length<2||rejectTitle(title)) continue;
    const expected=expectedFrom(item,sport); if(!expected) continue;
    out.push({sport,itemId,title,url,imageUrls:urls,expected,complexity:complexity(expected,title,urls.length)});
  }
  return out;
}
function choose25(rows:Candidate[]) {
  const dedup=Array.from(new Map(rows.map(x=>[x.itemId,x])).values()), selected:Candidate[]=[]; const used=new Set<string>();
  for(const [sport,quota] of Object.entries(QUOTAS)){
    const pool=dedup.filter(x=>phrase(x.expected.sport,sport)||x.sport===sport).sort((a,b)=>b.complexity-a.complexity||a.imageUrls.length-b.imageUrls.length);
    for(const x of pool.slice(0,quota)){if(!used.has(x.itemId)){selected.push(x);used.add(x.itemId)}}
  }
  for(const x of dedup.sort((a,b)=>b.complexity-a.complexity)){if(selected.length>=25)break;if(!used.has(x.itemId)){selected.push(x);used.add(x.itemId)}}
  if(selected.length<25) throw new Error(`Only ${selected.length} suitable hydrated live two-image listings were found.`);
  return selected.slice(0,25);
}

function outputText(p:any){return (Array.isArray(p?.choices)?p.choices:[]).map((c:any)=>clean(c?.message?.content)).filter(Boolean).join("\n")}
async function selectRoles(urls:string[]):Promise<Roles>{
  const fallback:Roles={frontIndex:0,backIndex:1,confidence:0,method:"fallback",note:"Image-role model unavailable."}; const key=clean(process.env.OPENAI_API_KEY); if(!key)return fallback;
  const content:any[]=[{type:"text",text:"Choose one clear FRONT and one clear BACK image of the same physical sports card. Reject duplicate fronts, closeups, slabs, shipping photos, or unrelated cards. Return indices and confidence."}];
  urls.slice(0,6).forEach((url,i)=>{content.push({type:"text",text:`IMAGE ${i}`});content.push({type:"image_url",image_url:{url,detail:"low"}})});
  try{
    const r=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:clean(process.env.INSTACOMP_OPENAI_FALLBACK_MODEL)||"gpt-4.1-mini",temperature:0,response_format:{type:"json_schema",json_schema:{name:"front_back_selection",strict:true,schema:{type:"object",additionalProperties:false,properties:{frontIndex:{type:["integer","null"]},backIndex:{type:["integer","null"]},confidence:{type:"number"},note:{type:"string"}},required:["frontIndex","backIndex","confidence","note"]}}},messages:[{role:"user",content}]}),signal:AbortSignal.timeout(45000)});
    const p=await r.json().catch(()=>({})); if(!r.ok)return fallback; const x=JSON.parse(outputText(p)); const f=Number(x.frontIndex),b=Number(x.backIndex),c=Number(x.confidence);
    if(!Number.isInteger(f)||!Number.isInteger(b)||f<0||b<0||f>=urls.length||b>=urls.length||f===b)return fallback;
    return{frontIndex:f,backIndex:b,confidence:Number.isFinite(c)?Math.max(0,Math.min(1,c)):0,method:"openai",note:clean(x.note)};
  }catch{return fallback}
}
function magic(bytes:Uint8Array){if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return"image/jpeg";if(bytes.length>=8&&bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return"image/png";if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")return"image/webp";return null}
async function download(url:string,name:string){const r=await fetch(url,{cache:"no-store",headers:{"User-Agent":"TCOS-InstaComp-25-Stress/2.0"},signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error(`${name} download failed (${r.status}).`);const buf=await r.arrayBuffer();if(!buf.byteLength||buf.byteLength>MAX_IMAGE_BYTES)throw new Error(`${name} size invalid.`);const type=magic(new Uint8Array(buf));if(!type||!ALLOWED_IMAGE_TYPES.has(type))throw new Error(`${name} type invalid.`);return new File([buf],name,{type})}
function grade(e:Expected,scan:any,roles:Roles){const ai=scan?.ai||{},checks:Array<{field:string;expected:unknown;actual:unknown;pass:boolean}>=[];const add=(field:string,expected:unknown,actual:unknown,pass:boolean)=>checks.push({field,expected,actual:actual??null,pass});
  add("front/back verified","front + back same card",roles.note,roles.method==="openai"&&roles.confidence>=0.7);add("sport",e.sport,ai.sport,phrase(ai.sport,e.sport));add("player",e.player,ai.player,phrase(ai.player,e.player));add("year",e.year,ai.year,season(ai.year)===season(e.year));add("manufacturer",e.brand,ai.brand,phrase(ai.brand,e.brand));add("set",e.setName,ai.setName,phrase(ai.setName,e.setName));add("card number",e.cardNumber,ai.cardNumber,compactCard(ai.cardNumber)===compactCard(e.cardNumber));
  if(e.parallel)add("parallel",e.parallel,ai.parallel,phrase(ai.parallel,e.parallel)||phrase(ai.setName,e.parallel));if(e.isRookie!==null)add("rookie",e.isRookie,Boolean(ai.isRookie),Boolean(ai.isRookie)===e.isRookie);if(e.isAuto!==null)add("autograph",e.isAuto,Boolean(ai.isAuto),Boolean(ai.isAuto)===e.isAuto);if(e.isRelic!==null)add("memorabilia/relic",e.isRelic,Boolean(ai.isRelic),Boolean(ai.isRelic)===e.isRelic);if(e.serialExact)add("serial number",e.serialExact,ai.serialNumber,exactSerial(ai.serialNumber)===e.serialExact);else if(e.serialRun)add("serial print run",e.serialRun,ai.serialNumber,serialRun(ai.serialNumber)===e.serialRun);
  const passed=checks.filter(x=>x.pass).length;return{pass:passed===checks.length,passed,total:checks.length,checks,confidence:Number(ai.confidence)||0};}
async function cleanup(id:unknown){const scanId=clean(id);if(!scanId)return;try{const sb=createSupabaseServerClient({admin:true});await sb.from("instacomp_scans").delete().eq("id",scanId)}catch{}}
async function runOne(c:Candidate,req:NextRequest,index:number){const roles=await selectRoles(c.imageUrls),fu=c.imageUrls[roles.frontIndex],bu=c.imageUrls[roles.backIndex];const [front,back]=await Promise.all([download(fu,`${index+1}-front.jpg`),download(bu,`${index+1}-back.jpg`)]);const form=new FormData();form.set("frontImage",front);form.set("backImage",back);form.set("aiCouncilTier","basic");const headers=new Headers({Accept:"application/json"});headers.set("x-tcos-instacomp-service-token",getInstaCompServiceToken());const internal=new NextRequest(new URL("/api/instacomp/scan",req.url),{method:"POST",headers,body:form});const resp=await runIdentityScan(internal);const scan=await resp.json().catch(()=>null);if(!resp.ok||!scan?.ok||!scan?.ai)return{index:index+1,...c,frontImageUrl:fu,backImageUrl:bu,imageRoles:roles,scanOk:false,error:clean(scan?.error)||`InstaComp scan HTTP ${resp.status}`,grade:{pass:false,passed:0,total:1,checks:[{field:"scan",expected:"recognized",actual:"failed",pass:false}],confidence:0}};const result={index:index+1,sport:c.sport,itemId:c.itemId,title:c.title,url:c.url,frontImageUrl:fu,backImageUrl:bu,imageRoles:roles,expected:c.expected,ai:scan.ai,scanOk:true,grade:grade(c.expected,scan,roles)};await cleanup(scan.scanId);return result;}

export async function POST(request:NextRequest){if(!(await authorized(request)))return Response.json({success:false,error:"Unauthorized"},{status:401});try{const pools=await Promise.all(SEARCHES.map(([sport,query])=>search(sport,query)));const selected=choose25(pools.flat());const results:any[]=new Array(selected.length);let cursor=0;async function worker(){while(cursor<selected.length){const i=cursor++,c=selected[i];try{results[i]=await runOne(c,request,i)}catch(error){results[i]={index:i+1,sport:c.sport,itemId:c.itemId,title:c.title,url:c.url,expected:c.expected,scanOk:false,error:error instanceof Error?error.message:String(error),grade:{pass:false,passed:0,total:1,checks:[{field:"execution",expected:"completed",actual:"failed",pass:false}],confidence:0}}}}}await Promise.all([worker(),worker(),worker()]);const cardsPassed=results.filter(x=>x.grade?.pass).length,fieldTotal=results.reduce((s,x)=>s+Number(x.grade?.total||0),0),fieldPassed=results.reduce((s,x)=>s+Number(x.grade?.passed||0),0);const summary={selectedListings:results.length,sports:Object.fromEntries(Object.keys(QUOTAS).map(s=>[s,results.filter(x=>phrase(x.expected?.sport,s)||x.sport===s).length])),autographCards:results.filter(x=>x.expected?.isAuto===true).length,memorabiliaCards:results.filter(x=>x.expected?.isRelic===true).length,serialNumberedCards:results.filter(x=>x.expected?.serialRun).length,parallelCards:results.filter(x=>x.expected?.parallel).length,rookieCards:results.filter(x=>x.expected?.isRookie===true).length,frontBackVerified:results.filter(x=>x.imageRoles?.method==="openai"&&Number(x.imageRoles?.confidence)>=0.7).length,cardsPassed,cardsFailed:results.length-cardsPassed,cardAccuracyPercent:Number((cardsPassed/Math.max(1,results.length)*100).toFixed(1)),fieldChecksPassed:fieldPassed,fieldChecksTotal:fieldTotal,fieldAccuracyPercent:fieldTotal?Number((fieldPassed/fieldTotal*100).toFixed(1)):0,perfect:results.length===25&&cardsPassed===25};return Response.json({success:true,schema:"truelycollectables.instacomp.25-card-recognition-stress.v2",completedAt:new Date().toISOString(),summary,failures:results.filter(x=>!x.grade?.pass).map(x=>({index:x.index,title:x.title,url:x.url,error:x.error||null,failedChecks:(x.grade?.checks||[]).filter((c:any)=>!c.pass)})),results},{headers:{"Cache-Control":"no-store"}})}catch(error){return Response.json({success:false,error:error instanceof Error?error.message:String(error)},{status:500,headers:{"Cache-Control":"no-store"}})}}
