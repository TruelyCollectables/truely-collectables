import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, 'scripts/fixtures/instacomp-supervised-203');
const FIXTURE_FILES = [
  'cards-001-025.json','cards-026-050.json','cards-051-075.json','cards-076-100.json',
  'cards-101-125.json','cards-126-150.json','cards-151-175.json','cards-176-200.json','cards-201-203.json',
];
const args = new Set(process.argv.slice(2));
const contractOnly = args.has('--contract-only');
const receiptArg = process.argv.find((v) => v.startsWith('--receipt='));
const receiptPath = receiptArg ? receiptArg.slice('--receipt='.length) : null;

function n(v) {
  return String(v ?? '').normalize('NFKC').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function eq(a,b) { return n(a) === n(b); }
function boolOrNull(v) { return v === true ? true : v === false ? false : null; }
function compactToIdentity(c) {
  return {
    sport: c.sp ?? null,
    league: c.lg ?? null,
    year: c.y ?? null,
    manufacturer: c.m ?? null,
    brand: c.b ?? null,
    set_name: c.n ?? null,
    subset: null,
    player: c.p ?? null,
    team: null,
    card_number: c.c ?? null,
    parallel: c.q ?? null,
    variation: null,
    serial_number: c.sn ?? null,
    serial_run: Number.isInteger(c.sr) ? c.sr : null,
    rookie: null,
    autograph: boolOrNull(c.a),
    inscription: null,
    inscription_text: null,
    memorabilia: null,
    memorabilia_type: null,
  };
}
function sameTruth(identity, c) {
  if (!identity || typeof identity !== 'object') return false;
  const checks = [
    ['year', c.y], ['manufacturer', c.m], ['brand', c.b], ['set_name', c.n],
    ['player', c.p], ['card_number', c.c], ['parallel', c.q],
  ];
  for (const [k,v] of checks) if (!eq(identity[k], v)) return false;
  if (c.sn != null && !eq(identity.serial_number, c.sn)) return false;
  if (c.sr != null && Number(identity.serial_run || 0) !== Number(c.sr)) return false;
  if (c.a != null && Boolean(identity.autograph) !== Boolean(c.a)) return false;
  return true;
}
function loadCards() {
  const cards = [];
  for (const file of FIXTURE_FILES) {
    const p = path.join(FIXTURE_DIR, file);
    const payload = JSON.parse(fs.readFileSync(p,'utf8'));
    if (!Array.isArray(payload.cards)) throw new Error(`${file} has no cards array`);
    cards.push(...payload.cards);
  }
  cards.sort((a,b)=>a.o-b.o);
  if (cards.length !== 203) throw new Error(`Expected 203 cards, got ${cards.length}`);
  for (let i=0;i<203;i++) {
    const expected = i+1;
    const scan = `SCAN-${String(expected).padStart(4,'0')}`;
    if (cards[i].o !== expected || cards[i].s !== scan) throw new Error(`Sequence mismatch at ${expected}`);
  }
  const critical = new Map([
    [3,'Blue Velocity Prizm'],[57,'Holo'],[64,'Blue Velocity Prizm'],[77,'Blue Velocity Prizm'],
    [88,'Holo'],[116,'Holo'],[147,'Holo'],[150,'Pink Flash Prizm'],[159,'Silver Flash Prizm'],
    [174,'White Seismic Prizm'],[177,'Silver Flash Prizm'],[180,'White Seismic Prizm'],
    [192,'Pink Flash Prizm'],[193,'Pink Ice Prizm'],[197,'White Seismic Prizm'],
  ]);
  for (const [ordinal, parallel] of critical) {
    const c = cards[ordinal-1];
    if (c.q !== parallel) throw new Error(`Critical truth mismatch ${ordinal}: ${c.q} != ${parallel}`);
  }
  if (cards[198].q !== null) throw new Error('SCAN-0199 must be plain Concourse (no parallel).');
  return cards;
}
function valueFromEnvFile(file, key) {
  const envText = fs.readFileSync(file, 'utf8');
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = envText.match(new RegExp(`^${escaped}=(?:"([^"]*)"|'([^']*)'|([^\\r\\n]*))`, 'm'));
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}
async function api(base,key,route,options={}) {
  const response = await fetch(base + route, {
    ...options,
    headers: {
      'X-InstaComp-AI-Key': key,
      Accept: 'application/json',
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...(options.headers || {}),
    },
    cache:'no-store',
    signal: AbortSignal.timeout(options.timeoutMs || 30000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = {raw:text.slice(0,800)}; }
  return {ok:response.ok,status:response.status,payload};
}
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length); let cursor=0;
  async function worker() { while (true) { const i=cursor++; if (i>=items.length) return; results[i]=await fn(items[i],i); } }
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, worker));
  return results;
}
function writeReceipt(receipt) {
  if (receiptPath) fs.writeFileSync(receiptPath, JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt.summary ?? receipt,null,2));
}

const cards = loadCards();
if (contractOnly) {
  writeReceipt({summary:{ok:true,contract:'supervised-203',cards:cards.length,first:cards[0].s,last:cards.at(-1).s,baseStoredInternally:cards.filter(c=>n(c.n)==='base').length}});
  process.exit(0);
}

const envFile = process.env.PRODUCTION_ENV_FILE;
if (!envFile || !fs.existsSync(envFile)) throw new Error('PRODUCTION_ENV_FILE is required.');
const base = valueFromEnvFile(envFile, 'INSTACOMP_AI_LOCAL_URL').replace(/\/+$/,'');
const key = valueFromEnvFile(envFile, 'INSTACOMP_AI_LOCAL_KEY');
const safePublicHttps = /^https:\/\//i.test(base) && !/^https:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(base);
if (!safePublicHttps || !key) {
  console.error(JSON.stringify({coordinateDiagnostic:{urlPresent:Boolean(base),keyPresent:Boolean(key),https:/^https:\/\//i.test(base),localhost:/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(base),urlLength:base.length,keyLength:key.length}}));
  throw new Error('Protected physical Mac coordinates unavailable.');
}

const receipt = {
  schema:'tcos.instacomp-ai.supervised-203-import-receipt.v1',
  startedAt:new Date().toISOString(), total:cards.length,
  scanPresence:null, alreadyTrusted:[], inserted:[], failed:[], finalMissing:[],
  export:null, readiness:null, summary:null,
};

const presence = await mapLimit(cards, 12, async (c) => {
  const r = await api(base,key,`/v1/scans/${encodeURIComponent(c.s)}/archive`);
  return {scanId:c.s, ok:r.ok, status:r.status, hasFront:r.payload?.has_front_image===true, hasBack:r.payload?.has_back_image===true};
});
const missing = presence.filter(r=>!r.ok || !r.hasFront || !r.hasBack);
receipt.scanPresence = {present:presence.length-missing.length,missingOrIncomplete:missing.map(r=>r.scanId)};
if (missing.length) {
  receipt.summary={ok:false,stage:'presence',total:cards.length,present:presence.length-missing.length,missingOrIncomplete:missing.length};
  writeReceipt(receipt);
  process.exit(2);
}

let examplesResponse = await api(base,key,'/v1/training/examples?trusted_only=false&limit=2000');
if (!examplesResponse.ok) throw new Error(`Training examples read failed HTTP ${examplesResponse.status}`);
let examples = Array.isArray(examplesResponse.payload?.examples) ? examplesResponse.payload.examples : [];

for (const c of cards) {
  const existing = examples.filter(e=>e?.scan_id===c.s);
  const trustedExact = existing.find(e=>e?.trusted===true && sameTruth(e.confirmed_identity,c));
  if (trustedExact) { receipt.alreadyTrusted.push(c.s); continue; }
  const prior = existing[0]?.confirmed_identity && !sameTruth(existing[0].confirmed_identity,c) ? existing[0].confirmed_identity : null;
  const body = {
    scan_id:c.s,
    state:'operator_confirmed',
    identity:compactToIdentity(c),
    verification_source:'supervised_203_2026-08-08',
    operator_id:'truely-collectables-owner',
    notes:[`Operator-supervised physical card ${c.o}/203.`, c.note || null, 'Structural Base is retained internally but never displayed in titles.'].filter(Boolean).join(' '),
    rejected_identity:prior,
  };
  const r = await api(base,key,'/v1/lessons',{method:'POST',body:JSON.stringify(body),timeoutMs:45000});
  if (!r.ok) { receipt.failed.push({scanId:c.s,status:r.status,detail:String(r.payload?.detail||r.payload?.error||'lesson insert failed').slice(0,300)}); continue; }
  receipt.inserted.push(c.s);
  examples.unshift({scan_id:c.s,trusted:true,confirmed_identity:body.identity});
}

const verify = await api(base,key,'/v1/training/examples?trusted_only=true&limit=2000');
if (!verify.ok) throw new Error(`Final trusted read failed HTTP ${verify.status}`);
const trusted = Array.isArray(verify.payload?.examples) ? verify.payload.examples : [];
receipt.finalMissing = cards.filter(c=>!trusted.some(e=>e?.scan_id===c.s && e?.trusted===true && sameTruth(e.confirmed_identity,c))).map(c=>c.s);

if (!receipt.finalMissing.length && !receipt.failed.length) {
  const exported = await api(base,key,'/v1/training/export?validation_percent=15',{method:'POST',timeoutMs:120000});
  receipt.export = exported.ok ? exported.payload : {ok:false,status:exported.status,detail:exported.payload?.detail||null};
  const ready = await api(base,key,'/v1/training/readiness');
  receipt.readiness = ready.ok ? ready.payload : {ok:false,status:ready.status};
}
receipt.completedAt=new Date().toISOString();
receipt.summary={
  ok:receipt.failed.length===0 && receipt.finalMissing.length===0,
  total:cards.length,
  physicalScanPairs:receipt.scanPresence.present,
  alreadyTrusted:receipt.alreadyTrusted.length,
  inserted:receipt.inserted.length,
  failed:receipt.failed.length,
  finalVerified:cards.length-receipt.finalMissing.length,
  finalMissing:receipt.finalMissing.length,
  trustedExamples:receipt.readiness?.trusted_examples ?? null,
  withPatternLabels:receipt.readiness?.with_pattern_labels ?? null,
  readyForTrialLora:receipt.readiness?.ready_for_trial_lora ?? null,
  datasetExported:Boolean(receipt.export?.destination || receipt.export?.train_examples),
};
writeReceipt(receipt);
if (!receipt.summary.ok) process.exit(3);
