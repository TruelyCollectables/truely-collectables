import fs from 'node:fs';
import path from 'node:path';

const envFile = process.argv[2];
const outDir = process.argv[3] || '.audit/instacomp-25-card-stress';
if (!envFile) throw new Error('Production env file path is required.');
fs.mkdirSync(outDir, { recursive: true });

function loadEnv(file) {
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    process.env[m[1]] = value;
  }
}
loadEnv(envFile);

const SITE = 'https://truelycollectables.com';
const MAC = String(process.env.INSTACOMP_AI_LOCAL_URL || '').trim().replace(/\/+$/, '');
const KEY = String(process.env.INSTACOMP_AI_LOCAL_KEY || '').trim();
const EBAY_ID = String(process.env.EBAY_CLIENT_ID || '').trim();
const EBAY_SECRET = String(process.env.EBAY_CLIENT_SECRET || '').trim();
if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(MAC)) throw new Error('Production Mac tunnel URL is missing or invalid.');
if (!KEY) throw new Error('INSTACOMP_AI_LOCAL_KEY is missing.');
if (!EBAY_ID || !EBAY_SECRET) throw new Error('Production eBay client credentials are missing.');

const feeds = [
  ['basketball','wnba',`${SITE}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=wnba`],
  ['baseball','baseball_prospects',`${SITE}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=baseball_prospects`],
  ['hockey','ivan_demidov',`${SITE}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=ivan_demidov`],
  ['hockey','matvei_michkov_young_guns',`${SITE}/api/tcos/deal-hunter-native-ebay?perQuery=20&scope=matvei_michkov_young_guns`],
  ['hockey','matvei_michkov_opc_platinum',`${SITE}/api/tcos/deal-hunter-michkov-opc-platinum?perQuery=20`],
];

function compact(s){ return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim(); }
function canonSeason(s){
  const v=String(s??'').replace(/[–—]/g,'-').trim();
  const m=v.match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2,4})\b/);
  if(!m) return compact(v);
  const end=m[2].length===2?`${m[1].slice(0,2)}${m[2]}`:m[2];
  return `${m[1]}-${end}`;
}
function normCard(s){ return compact(s).replace(/^card\s*/,'').replace(/^no\s*/,'').replace(/\s/g,''); }
function textMatch(a,b){
  const x=compact(a), y=compact(b); if(!x||!y) return false;
  if(x===y||x.includes(y)||y.includes(x)) return true;
  const xa=x.split(' ').filter(t=>t.length>1), ya=y.split(' ').filter(t=>t.length>1);
  const hit=xa.filter(t=>ya.includes(t)).length;
  return hit/Math.max(1,Math.min(xa.length,ya.length))>=0.75;
}
function serialFromText(s){
  const t=String(s??'');
  const exact=[...t.matchAll(/(?:^|\D)(\d{1,4})\s*\/\s*(\d{1,4})(?:\D|$)/g)]
    .map(m=>({exact:`${Number(m[1])}/${Number(m[2])}`,num:Number(m[1]),run:Number(m[2])}))
    .find(x=>x.num<=x.run && x.run>=2 && x.run<=9999);
  if(exact) return exact;
  const run=t.match(/(?:numbered|serial(?:ized)?|#'?d|\/)[^0-9]{0,8}\/\s*(\d{1,4})\b/i) || t.match(/\b(?:to|of)\s+(\d{1,4})\b/i);
  return run ? { exact:null, num:null, run:Number(run[1]) } : null;
}
function complexity(title){
  const t=String(title||'').toLowerCase(); let n=0;
  if(/auto|autograph|signed/.test(t)) n+=4;
  if(/patch|relic|jersey|memorabilia|swatch|rpa/.test(t)) n+=4;
  if(serialFromText(t)) n+=4;
  if(/prizm|refractor|parallel|silver|gold|red|blue|green|orange|purple|wave|ice|velocity|shimmer|scope|mojo|cracked|sparkle|x-fractor/.test(t)) n+=2;
  if(/\brc\b|rookie/.test(t)) n+=1;
  return n;
}

async function jsonFetch(url, init={}, label='request'){
  const r=await fetch(url,{...init,signal:AbortSignal.timeout(45000)});
  const text=await r.text(); let body; try{body=text?JSON.parse(text):null}catch{body={raw:text.slice(0,1000)}}
  if(!r.ok) throw new Error(`${label} HTTP ${r.status}: ${JSON.stringify(body).slice(0,800)}`);
  return body;
}

async function ebayToken(){
  const body=new URLSearchParams({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'});
  const r=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${EBAY_ID}:${EBAY_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(30000)});
  const j=await r.json(); if(!r.ok||!j.access_token) throw new Error(`eBay OAuth failed: ${JSON.stringify(j).slice(0,500)}`); return j.access_token;
}
function aspectsMap(item){
  const m=new Map();
  for(const row of item?.localizedAspects||[]){ const k=compact(row?.name); if(k&&!m.has(k)) m.set(k,String(row?.value||'').trim()); }
  return m;
}
function aspect(map,names){ for(const n of names){const v=map.get(compact(n)); if(v) return v;} return null; }
async function ebayItem(token,id){
  const headers={Authorization:`Bearer ${token}`,'X-EBAY-C-MARKETPLACE-ID':'EBAY_US',Accept:'application/json'};
  const candidates=[];
  if(String(id||'').startsWith('v1|')) candidates.push(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}`);
  else {
    candidates.push(`https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(id)}`);
    candidates.push(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(`v1|${id}|0`)}`);
  }
  for(const url of candidates){
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)}); if(r.ok) return await r.json();
  }
  return null;
}

const discovered=[];
for(const [sport,lane,url] of feeds){
  const p=await jsonFetch(url,{},lane);
  if(p?.ok!==true || !Array.isArray(p?.results)) throw new Error(`${lane} feed contract failed.`);
  for(const c of p.results){
    const imgs=[...new Set((c.imageUrls||[]).map(String).filter(Boolean))];
    if(imgs.length<2 || !c.listingUrl || !c.listingItemId) continue;
    discovered.push({sport,lane,...c,imageUrls:imgs,complexity:complexity(c.title)});
  }
}
const dedup=[...new Map(discovered.map(x=>[String(x.listingItemId),x])).values()];
const token=await ebayToken();
const enriched=[];
for(const c of dedup.sort((a,b)=>b.complexity-a.complexity || a.imageUrls.length-b.imageUrls.length)){
  if(enriched.length>=70) break;
  const item=await ebayItem(token,c.listingItemId);
  if(!item) continue;
  const amap=aspectsMap(item);
  const imageUrls=[...new Set([item?.image?.imageUrl,...(item?.additionalImages||[]).map(x=>x?.imageUrl),...c.imageUrls].filter(Boolean))];
  if(imageUrls.length<2) continue;
  const title=String(item.title||c.title||'');
  const expected={
    sport: aspect(amap,['Sport']) || c.sport,
    player: aspect(amap,['Player/Athlete','Player']),
    year: aspect(amap,['Year Manufactured','Season']),
    manufacturer: aspect(amap,['Manufacturer','Brand']),
    setName: aspect(amap,['Set']),
    cardNumber: aspect(amap,['Card Number']),
    parallel: aspect(amap,['Parallel/Variety']),
    rookie: null,
    autograph: null,
    memorabilia: null,
    memorabiliaType: null,
    serial: serialFromText(title),
  };
  const features=[aspect(amap,['Features']),aspect(amap,['Card Attributes']),title].filter(Boolean).join(' | ');
  const autoAspect=aspect(amap,['Autographed']);
  if(autoAspect) expected.autograph=/yes|true/i.test(autoAspect);
  else if(/auto|autograph|signed/i.test(title)) expected.autograph=true;
  if(/\brookie\b|\brc\b/i.test(features)) expected.rookie=true;
  else if(aspect(amap,['Features'])) expected.rookie=false;
  if(/patch|relic|jersey|memorabilia|swatch|rpa/i.test(features)) {
    expected.memorabilia=true;
    expected.memorabiliaType=(features.match(/\b(rpa|patch|jersey|relic|memorabilia|swatch)\b/i)||[])[1]||null;
  }
  const core=[expected.player,expected.year,expected.setName,expected.cardNumber].filter(Boolean).length;
  if(core<4) continue;
  enriched.push({...c,title,listingUrl:item.itemWebUrl||c.listingUrl,imageUrls,itemSpecifics:Object.fromEntries(amap),expected,complexity:complexity(title)});
}

const quotas={basketball:8,baseball:8,hockey:9};
const selected=[];
for(const sport of Object.keys(quotas)){
  const pool=enriched.filter(x=>x.sport===sport).sort((a,b)=>b.complexity-a.complexity || a.imageUrls.length-b.imageUrls.length);
  selected.push(...pool.slice(0,quotas[sport]));
}
if(selected.length<25){
  const used=new Set(selected.map(x=>String(x.listingItemId)));
  for(const c of enriched.sort((a,b)=>b.complexity-a.complexity)){
    if(selected.length>=25) break;
    if(!used.has(String(c.listingItemId))){ selected.push(c); used.add(String(c.listingItemId)); }
  }
}
if(selected.length<25) throw new Error(`Only ${selected.length} independently-grounded front/back listings were available; need 25.`);

async function image(url){
  const r=await fetch(url,{headers:{Accept:'image/jpeg,image/png,image/webp','User-Agent':'InstaComp-AI-25-Card-Stress/1.0'},signal:AbortSignal.timeout(45000)});
  if(!r.ok) throw new Error(`image HTTP ${r.status}`);
  const type=String(r.headers.get('content-type')||'').split(';')[0].toLowerCase();
  const buf=Buffer.from(await r.arrayBuffer());
  if(!['image/jpeg','image/png','image/webp'].includes(type)||!buf.length||buf.length>12*1024*1024) throw new Error(`invalid image ${type} ${buf.length}`);
  return {buf,type};
}
function predicted(scan){ return scan?.trusted_identity || scan?.local_suggestion?.identity || scan?.local_vision?.identity_hints || {}; }
function grade(c,scan){
  const ai=predicted(scan), ev=scan?.local_vision?.serial||{};
  const checks=[];
  const add=(field,expected,actual,pass)=>{ if(expected!==null&&expected!==undefined&&String(expected)!=='') checks.push({field,expected,actual:actual??null,pass:Boolean(pass)}); };
  add('sport',c.expected.sport,ai.sport,textMatch(c.expected.sport,ai.sport));
  add('player',c.expected.player,ai.player,textMatch(c.expected.player,ai.player));
  add('year',c.expected.year,ai.year,canonSeason(c.expected.year)===canonSeason(ai.year) || textMatch(c.expected.year,ai.year));
  const maker=ai.manufacturer||ai.brand;
  add('manufacturer',c.expected.manufacturer,maker,textMatch(c.expected.manufacturer,maker));
  add('setName',c.expected.setName,ai.set_name,textMatch(c.expected.setName,ai.set_name));
  add('cardNumber',c.expected.cardNumber,ai.card_number,normCard(c.expected.cardNumber)===normCard(ai.card_number));
  add('parallel',c.expected.parallel,ai.parallel,textMatch(c.expected.parallel,ai.parallel));
  if(c.expected.rookie!==null) add('rookie',c.expected.rookie,ai.rookie,Boolean(ai.rookie)===c.expected.rookie);
  if(c.expected.autograph!==null) add('autograph',c.expected.autograph,ai.autograph,Boolean(ai.autograph)===c.expected.autograph);
  if(c.expected.memorabilia!==null) add('memorabilia',c.expected.memorabilia,ai.memorabilia,Boolean(ai.memorabilia)===c.expected.memorabilia);
  if(c.expected.memorabiliaType) add('memorabiliaType',c.expected.memorabiliaType,ai.memorabilia_type,textMatch(c.expected.memorabiliaType,ai.memorabilia_type));
  if(c.expected.serial?.run){
    const actualExact=ai.serial_number||ev.exact_stamp||null;
    const actualRun=Number(ai.serial_run||ev.visible_denominator||0)||null;
    if(c.expected.serial.exact) add('serialExact',c.expected.serial.exact,actualExact,compact(c.expected.serial.exact)===compact(actualExact));
    add('serialRun',c.expected.serial.run,actualRun,Number(c.expected.serial.run)===Number(actualRun));
  }
  if(ai.autograph===true && c.expected.autograph!==true && !/auto|autograph|signed/i.test(c.title)) checks.push({field:'unsupportedAutoClaim',expected:false,actual:true,pass:false});
  if(ai.memorabilia===true && c.expected.memorabilia!==true && !/patch|relic|jersey|memorabilia|swatch|rpa/i.test(c.title)) checks.push({field:'unsupportedMemorabiliaClaim',expected:false,actual:true,pass:false});
  const passed=checks.filter(x=>x.pass).length;
  return {pass:checks.length>0 && passed===checks.length,passed,total:checks.length,checks,ai,trusted:Boolean(scan?.trusted_identity),status:scan?.status||null,matchSource:scan?.match_source||null,pricingAllowed:Boolean(scan?.pricing_allowed)};
}

const results=[];
for(let i=0;i<25;i++){
  const c=selected[i];
  const row={index:i+1,sport:c.sport,lane:c.lane,title:c.title,listingItemId:c.listingItemId,listingUrl:c.listingUrl,imageUrls:c.imageUrls.slice(0,2),expected:c.expected,complexity:c.complexity};
  try{
    const [front,back]=await Promise.all([image(c.imageUrls[0]),image(c.imageUrls[1])]);
    const form=new FormData();
    form.set('front',new Blob([front.buf],{type:front.type}),'front.jpg');
    form.set('back',new Blob([back.buf],{type:back.type}),'back.jpg');
    const r=await fetch(`${MAC}/v1/scans/analyze`,{method:'POST',headers:{'X-InstaComp-AI-Key':KEY,Accept:'application/json'},body:form,signal:AbortSignal.timeout(180000)});
    const body=await r.json().catch(()=>null);
    row.scanHttpStatus=r.status;
    row.scan=body;
    row.grade=r.ok&&body?grade(c,body):{pass:false,passed:0,total:1,checks:[{field:'scan',expected:'HTTP 200',actual:r.status,pass:false}]};
  }catch(e){
    row.error=String(e?.message||e); row.grade={pass:false,passed:0,total:1,checks:[{field:'exception',expected:'none',actual:row.error,pass:false}]};
  }
  results.push(row);
  console.log(`${String(i+1).padStart(2,'0')}/25 ${row.grade.pass?'PASS':'FAIL'} ${row.sport} ${row.title.slice(0,100)}`);
}

const totalChecks=results.reduce((n,r)=>n+(r.grade?.total||0),0);
const passedChecks=results.reduce((n,r)=>n+(r.grade?.passed||0),0);
const cardsPassed=results.filter(r=>r.grade?.pass).length;
const trustedLocked=results.filter(r=>r.grade?.trusted).length;
const statusCounts=Object.fromEntries([...new Set(results.map(r=>r.grade?.status||'error'))].map(s=>[s,results.filter(r=>(r.grade?.status||'error')===s).length]));
const complexCounts={
  autograph:results.filter(r=>r.expected?.autograph===true).length,
  memorabilia:results.filter(r=>r.expected?.memorabilia===true).length,
  serialized:results.filter(r=>r.expected?.serial?.run).length,
  parallel:results.filter(r=>r.expected?.parallel).length,
  rookie:results.filter(r=>r.expected?.rookie===true).length,
};
const summary={
  schema:'truelycollectables.instacomp.25-card-stress.v1',
  completedAt:new Date().toISOString(),
  selectedListings:25,
  sports:Object.fromEntries(['basketball','baseball','hockey'].map(s=>[s,results.filter(r=>r.sport===s).length])),
  complexCounts,
  cardsPassed,cardsFailed:25-cardsPassed,cardAccuracyPercent:Number((cardsPassed/25*100).toFixed(1)),
  fieldChecksPassed:passedChecks,fieldChecksTotal:totalChecks,fieldAccuracyPercent:totalChecks?Number((passedChecks/totalChecks*100).toFixed(1)):0,
  trustedRegistryLocks:trustedLocked,
  statusCounts,
  perfect:cardsPassed===25,
  failures:results.filter(r=>!r.grade?.pass).map(r=>({index:r.index,title:r.title,listingUrl:r.listingUrl,status:r.grade?.status||null,failedChecks:(r.grade?.checks||[]).filter(x=>!x.pass)})),
};
fs.writeFileSync(path.join(outDir,'summary.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(outDir,'results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify(summary,null,2));
