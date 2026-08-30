import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import * as XLSX from "xlsx";

const OUTPUT_ROOT = resolve(process.cwd(), ".checklist-work/six-release-validation");
const PRIVATE_ROOT = resolve(OUTPUT_ROOT, "private");
const RECEIPT_PATH = resolve(OUTPUT_ROOT, "validation.json");
const ADAPTER_ID = "expanded-checklist-spreadsheet";
const ADAPTER_VERSION = "1.0.0";
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SOURCES = [
  {
    id: "2024-bowman-chrome-baseball",
    url: "https://www.checklistcenter.com/wp-content/uploads/2024/08/2024-Bowman-Chrome-Baseball.xlsx",
    landingUrl: "https://www.checklistcenter.com/2024-bowman-chrome-baseball-card-checklist/",
    officialUrl: "https://www.topps.com/pages/education/2024-bowman-chrome-baseball",
    expectedSha256: "c566d41e0aad20bad7c865245846901f05d3b3035dd71ac9e4acb0699ced32bc",
    expected: { rows: 9414, sets: 28, cards: 818, parallels: 124, identities: 9414 },
    release: { manufacturer: "Topps", brand: "Bowman Chrome", product: "2024 Bowman Chrome Baseball", releaseYear: "2024", season: null, sport: "Baseball", league: "MLB", releaseSlug: "2024-bowman-chrome-baseball" },
    checks: [
      { label: "Dylan Crews base", setName: "Chrome Prospects", cardNumber: "BCP-193", player: "Dylan Crews", parallel: "Base", serialRun: "" },
      { label: "Dylan Crews Gold /50", setName: "Chrome Prospects", cardNumber: "BCP-193", player: "Dylan Crews", parallel: "Gold Refractor", serialRun: "/50" },
    ],
  },
  {
    id: "2025-bowman-baseball",
    url: "https://www.checklistcenter.com/wp-content/uploads/2025/04/2025-Bowman-Baseball.xlsx",
    landingUrl: "https://www.checklistcenter.com/2025-bowman-baseball-card-checklist/",
    officialUrl: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2507-2025BowmanBaseballChecklist2.pdf?v=1746543006",
    expectedSha256: null,
    expected: null,
    release: { manufacturer: "Topps", brand: "Bowman", product: "2025 Bowman Baseball", releaseYear: "2025", season: null, sport: "Baseball", league: "MLB", releaseSlug: "2025-bowman-baseball" },
    checks: [
      { label: "Jesus Made Chrome Prospect base", setName: "Chrome Prospects", cardNumber: "BCP-66", player: "Jesus Made", parallel: "Base", serialRun: "" },
      { label: "Jesus Made numbered Chrome Prospect", setName: "Chrome Prospects", cardNumber: "BCP-66", player: "Jesus Made", requireNumberedNonBase: true },
    ],
  },
  {
    id: "2024-panini-prizm-wnba",
    url: "https://www.checklistcenter.com/wp-content/uploads/2025/02/2024-Panini-WNBA-Prizm-Basketball.xlsx",
    landingUrl: "https://www.checklistcenter.com/2024-panini-prizm-wnba-basketball-card-checklist/",
    officialUrl: "https://www.paniniamerica.net/2024-panini-prizm-wnba-trading-card-box-hobby.html",
    expectedSha256: "7caae8b8591a5aa4c9127789e47a3c56fc8d3a1c164efb13081e259fb40e859c",
    expected: { rows: 6702, sets: 12, cards: 337, parallels: 121, identities: 6702 },
    release: { manufacturer: "Panini", brand: "Prizm", product: "2024 Panini Prizm WNBA", releaseYear: "2024", season: "2024", sport: "Basketball", league: "WNBA", releaseSlug: "2024-panini-prizm-wnba" },
    checks: [
      { label: "Caitlin Clark base #22", setName: "Base", cardNumber: "22", player: "Caitlin Clark", parallel: "Base", serialRun: "" },
      { label: "Caitlin Clark Gold /10 #22", setName: "Base", cardNumber: "22", player: "Caitlin Clark", parallel: "Prizms Gold", serialRun: "/10" },
    ],
  },
  {
    id: "2025-panini-prizm-wnba",
    url: "https://www.checklistcenter.com/wp-content/uploads/2026/03/2025-Panini-Prizm-WNBA.xlsx",
    landingUrl: "https://www.checklistcenter.com/2025-panini-prizm-wnba-basketball-card-checklist/",
    officialUrl: "https://www.paniniamerica.net/2025-panini-prizm-wnba-trading-card-box-hobby",
    expectedSha256: "adb74290ba74803c335b424c399212f7c0f90d7110281c0733ca662dee1f4c8a",
    expected: { rows: 8883, sets: 14, cards: 350, parallels: 146, identities: 8883 },
    release: { manufacturer: "Panini", brand: "Prizm", product: "2025 Panini Prizm WNBA", releaseYear: "2025", season: "2025", sport: "Basketball", league: "WNBA", releaseSlug: "2025-panini-prizm-wnba" },
    checks: [
      { label: "Paige Bueckers base #5", setName: "Base", cardNumber: "5", player: "Paige Bueckers", parallel: "Base", serialRun: "" },
      { label: "Paige Bueckers Gold /10 #5", setName: "Base", cardNumber: "5", player: "Paige Bueckers", parallel: "Prizms Gold", serialRun: "/10" },
    ],
  },
  {
    id: "2024-panini-select-wnba",
    url: "https://www.checklistcenter.com/wp-content/uploads/2024/10/2024-Panini-Select-WNBA.xlsx",
    landingUrl: "https://www.checklistcenter.com/2024-panini-select-wnba-basketball-card-checklist/",
    officialUrl: "https://www.paniniamerica.net/2024-panini-select-wnba-trading-card-box-hobby.html",
    expectedSha256: "55d4c49492e9a373d5411ff4bcf0e8f0f15bae745dd7471542267fe9cbc68691",
    expected: { rows: 8480, sets: 17, cards: 560, parallels: 174, identities: 8480 },
    release: { manufacturer: "Panini", brand: "Select", product: "2024 Panini Select WNBA", releaseYear: "2024", season: "2024", sport: "Basketball", league: "WNBA", releaseSlug: "2024-panini-select-wnba" },
    checks: [
      { label: "Caitlin Clark Concourse base #72", setName: "Base Set - Concourse", cardNumber: "72", player: "Caitlin Clark", parallel: "Base", serialRun: "" },
      { label: "Caitlin Clark Concourse Gold /10", setName: "Base Set - Concourse", cardNumber: "72", player: "Caitlin Clark", parallel: "Gold Prizms", serialRun: "/10" },
    ],
  },
  {
    id: "2025-panini-select-wnba",
    url: "https://www.checklistcenter.com/wp-content/uploads/2026/05/2025-Panini-WNBA-Select-Basketball.xlsx",
    landingUrl: "https://www.checklistcenter.com/2025-panini-select-wnba-basketball-card-checklist/",
    officialUrl: "https://www.paniniamerica.net/2025-panini-select-wnba-trading-card-box-hobby",
    expectedSha256: "1fb2b53413b03917705f0ec82ab358c156473e305d043b9134419b87dc583a66",
    expected: { rows: 11744, sets: 17, cards: 553, parallels: 232, identities: 11744 },
    release: { manufacturer: "Panini", brand: "Select", product: "2025 Panini Select WNBA", releaseYear: "2025", season: "2025", sport: "Basketball", league: "WNBA", releaseSlug: "2025-panini-select-wnba" },
    setOverrides: { "All-Star White Disco Prizms": { root: "All-Stars", parallel: "White Disco Prizms" } },
    checks: [
      { label: "Paige Bueckers Concourse base #25", setName: "Base Set - Concourse", cardNumber: "25", player: "Paige Bueckers", parallel: "Base", serialRun: "" },
      { label: "Paige Bueckers Concourse Gold /10", setName: "Base Set - Concourse", cardNumber: "25", player: "Paige Bueckers", parallel: "Gold Prizms", serialRun: "/10" },
    ],
  },
];

const EMPTY_VALUE = "∅";
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function normalizeText(value) { return String(value ?? "").normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/&/g, " and ").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase(); }
function normalizeList(value) { const values = Array.isArray(value) ? value : value ? [value] : []; return [...new Set(values.map(normalizeText).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); }
function normalizeCardNumber(value) { return normalizeText(value).replace(/^#\s*/, "").replace(/\s+/g, ""); }
function normalizeSerialRun(value) { const normalized = normalizeText(value); if (!normalized) return ""; const slash = normalized.match(/(?:^|\D)(\d{1,7})\s*\/\s*(\d{1,7})(?:\D|$)/); if (slash) return `/${Number(slash[2])}`; const denominator = normalized.match(/^\/?\s*(\d{1,7})(?:\.0)?$/); if (denominator) return `/${Number(denominator[1])}`; return normalized; }
function normalizeAutographStatus(value) { const normalized = normalizeText(value); if (!normalized || /^(non[- ]?auto|no auto|none|false)$/.test(normalized)) return "non-auto"; if (/^(auto|autograph|autographed|true)$/.test(normalized)) return "autograph"; return normalized; }
function normalizeMemorabiliaStatus(value) { const normalized = normalizeText(value); if (!normalized || /^(non[- ]?(memorabilia|relic)|no (memorabilia|relic)|none|false)$/.test(normalized)) return "non-memorabilia"; if (/^(memorabilia|relic|patch|jersey|true)$/.test(normalized)) return "memorabilia"; return normalized; }
function field(name, value) { const encoded = Array.isArray(value) ? (value.length ? value.join("+") : EMPTY_VALUE) : (value || EMPTY_VALUE); return `${name}=${encoded}`; }
function fingerprintIdentity(input) {
  const normalized = {
    schema: "tcos.checklist.identity.v1",
    releaseYear: normalizeText(input.releaseYear), season: normalizeText(input.season), manufacturer: normalizeText(input.manufacturer), brand: normalizeText(input.brand), product: normalizeText(input.product), sport: normalizeText(input.sport), league: normalizeText(input.league), setName: normalizeText(input.setName), subset: normalizeText(input.subset), cardNumber: normalizeCardNumber(input.cardNumber), players: normalizeList(input.players), teams: normalizeList(input.teams), parallel: normalizeText(input.parallel) || "base", variation: normalizeText(input.variation), serialRun: normalizeSerialRun(input.serialRun), autographStatus: normalizeAutographStatus(input.autographStatus), memorabiliaStatus: normalizeMemorabiliaStatus(input.memorabiliaStatus), configurationExclusivity: normalizeText(input.configurationExclusivity),
  };
  for (const key of ["manufacturer","product","setName","cardNumber"]) if (!normalized[key]) throw new Error(`${key} is required`);
  if (!normalized.players.length) throw new Error("at least one player is required");
  if (!normalized.releaseYear && !normalized.season) throw new Error("releaseYear or season is required");
  const canonicalKey = [field("schema", normalized.schema),field("release_year", normalized.releaseYear),field("season", normalized.season),field("manufacturer", normalized.manufacturer),field("brand", normalized.brand),field("product", normalized.product),field("sport", normalized.sport),field("league", normalized.league),field("set", normalized.setName),field("subset", normalized.subset),field("card_number", normalized.cardNumber),field("players", normalized.players),field("teams", normalized.teams),field("parallel", normalized.parallel),field("variation", normalized.variation),field("serial_run", normalized.serialRun),field("autograph", normalized.autographStatus),field("memorabilia", normalized.memorabiliaStatus),field("configuration", normalized.configurationExclusivity)].join("|");
  return { schema: normalized.schema, normalized, canonicalKey, fingerprintSha256: sha256(canonicalKey) };
}
function clean(value) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function cleanNumber(value) { const text = clean(value); return /^-?\d+\.0$/.test(text) ? text.slice(0,-2) : text; }
function slug(value) { return clean(value).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"") || "unknown"; }
function splitValues(value) { return clean(value).split(/\s+\/\s+|\s*;\s*/).map(clean).filter(Boolean); }
function inferSetType(name) { const n=normalizeText(name); if (/autograph|signature|auto\b/.test(n)) return "autograph"; if (/memorabilia|relic|swatch|patch|jersey/.test(n)) return "memorabilia"; if (n === "base" || n.startsWith("base set")) return "base"; if (/prospect|rookie|veteran/.test(n)) return "subset"; return "insert"; }
function autographStatus(name) { return /autograph|signature|auto\b/i.test(name) ? "autograph" : "non-auto"; }
function memorabiliaStatus(name) { return /memorabilia|relic|swatch|patch|jersey/i.test(name) ? "memorabilia" : "non-memorabilia"; }
function configuration(name) { const matches=[]; for (const [pattern,label] of [[/\bFOTL\b/i,"FOTL"],[/Premium Box Set/i,"Premium Box Set"],[/\bRetail\b/i,"Retail"],[/\bHobby\b/i,"Hobby"],[/\bChoice\b/i,"Choice"],[/\bBreaker\b/i,"Breaker"]]) if (pattern.test(name)) matches.push(label); return matches.join(" + ") || null; }
function variation(name) { return /variation/i.test(name) ? clean(name) : null; }
function sourceKey(prefix, ...parts) { return `${prefix}:${parts.map(slug).join(":")}`; }
function storageReceipt(source, bytes) { const originalFilename=basename(new URL(source.url).pathname).toLowerCase(); const digest=sha256(bytes); return { schema:"tcos.checklist.sourcePath.v1", bucket:"tcos-checklist-source-files", objectPath:["tcos/checklist/sourcePath/v1",slug(source.release.manufacturer),source.release.releaseSlug,digest.slice(0,2),`${digest}-${originalFilename}`].join("/"), sha256:digest, sizeBytes:bytes.length, mimeType:MIME_XLSX, originalFilename, isPublic:false }; }
function rowCardKey(row) { return [normalizeCardNumber(row.number),normalizeText(row.name),normalizeText(row.team)].join("|"); }
function overlapSize(left,right) { let n=0; for (const value of left) if (right.has(value)) n+=1; return n; }

function deriveRoots(source, rows) {
  const sets = new Map();
  for (const row of rows) { if (!sets.has(row.physicalSet)) sets.set(row.physicalSet,new Set()); sets.get(row.physicalSet).add(rowCardKey(row)); }
  const labels=[...sets.keys()]; const roots=new Map();
  for (const label of labels) {
    const override=source.setOverrides?.[label]; if (override) { roots.set(label,override.root); continue; }
    const candidates=[];
    for (const candidate of labels) {
      if (candidate===label || !label.toLowerCase().startsWith(candidate.toLowerCase())) continue;
      const rest=label.slice(candidate.length); if (!rest || !/^[\s:-]/.test(rest)) continue;
      const denominator=Math.min(sets.get(label).size,sets.get(candidate).size); const overlap=overlapSize(sets.get(label),sets.get(candidate)); const ratio=denominator ? overlap/denominator : 0;
      if (ratio>=0.90 && overlap>=Math.min(3,denominator)) candidates.push({candidate,length:candidate.length,ratio,overlap});
    }
    candidates.sort((a,b)=>a.length-b.length || b.ratio-a.ratio || b.overlap-a.overlap || a.candidate.localeCompare(b.candidate));
    roots.set(label,candidates[0]?.candidate || label);
  }
  for (const label of labels) { let root=roots.get(label); const seen=new Set(); while (roots.has(root) && roots.get(root)!==root && !seen.has(root)) { seen.add(root); root=roots.get(root); } roots.set(label,root); }
  return roots;
}

function parseWorkbook(source, bytes, retrievedAt) {
  const workbook=XLSX.read(bytes,{type:"buffer",raw:false,cellDates:false});
  if (workbook.SheetNames.length!==1) throw new Error(`${source.id} expected one worksheet, found ${workbook.SheetNames.length}`);
  const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:"",raw:false,blankrows:false});
  if (!matrix.length) throw new Error(`${source.id} worksheet is empty`);
  const headers=matrix[0].map(clean); const index=Object.fromEntries(headers.map((name,i)=>[name,i]));
  for (const required of ["Set","Number","Name","Team","Print Run"]) if (!(required in index)) throw new Error(`${source.id} missing ${required} column`);
  const rows=[]; const malformed=[];
  for (let i=1;i<matrix.length;i+=1) {
    const raw=matrix[i]; const physicalSet=clean(raw[index.Set]); const number=cleanNumber(raw[index.Number]); const name=clean(raw[index.Name]); const team=clean(raw[index.Team]); const printRun=cleanNumber(raw[index["Print Run"]]); const odds="Odds" in index ? clean(raw[index.Odds]) : "";
    if (!physicalSet && !number && !name && !team && !printRun && !odds) continue;
    if (!physicalSet || !number || !name) { malformed.push({row:i+1,physicalSet,number,name,team,printRun}); continue; }
    rows.push({sourceRow:i+1,physicalSet,number,name,team,printRun,odds});
  }
  if (malformed.length) throw new Error(`${source.id} has ${malformed.length} malformed populated rows`);
  const roots=deriveRoots(source,rows); const setMap=new Map(); const cardMap=new Map(); const parallelMap=new Map(); const identities=[]; const fingerprintSet=new Set();
  for (const row of rows) {
    const override=source.setOverrides?.[row.physicalSet]; const root=roots.get(row.physicalSet); const parallel=override?.parallel || (row.physicalSet===root ? "Base" : row.physicalSet.slice(root.length).replace(/^[\s:-]+/,"").trim() || "Base"); const serialRun=normalizeSerialRun(row.printRun); const config=configuration(row.physicalSet); const setSourceKey=sourceKey("set",root); if (!setMap.has(setSourceKey)) setMap.set(setSourceKey,{sourceKey:setSourceKey,name:root,normalizedName:normalizeText(root),setType:inferSetType(root)});
    const players=splitValues(row.name); const teams=splitValues(row.team); const cardDiscriminator=sha256([normalizeText(root),normalizeCardNumber(row.number),...players.map(normalizeText),...teams.map(normalizeText)].join("|")).slice(0,16); const cardSourceKey=`card:${slug(root)}:${slug(row.number)}:${cardDiscriminator}`;
    if (!cardMap.has(cardSourceKey)) cardMap.set(cardSourceKey,{sourceKey:cardSourceKey,setSourceKey,cardNumber:row.number,players,teams,rookieDesignation:/\brookie\b/i.test(root) ? true : null,firstBowmanDesignation:/1st bowman/i.test(root) ? true : null,autographStatus:autographStatus(root),memorabiliaStatus:memorabiliaStatus(root),variation:variation(root),sourceNotes:`row_source_authority=third_party_verified; physical_set=${row.physicalSet}; odds=${row.odds || "not_stated"}; official_corroboration=${source.officialUrl}`});
    let parallelSourceKey=null; if (normalizeText(parallel)!=="base") { parallelSourceKey=`parallel:${slug(root)}:${slug(parallel)}:${serialRun || "unnum"}:${slug(config || "none")}`; if (!parallelMap.has(parallelSourceKey)) parallelMap.set(parallelSourceKey,{sourceKey:parallelSourceKey,setSourceKey,name:parallel,serialRun:serialRun ? Number(serialRun.slice(1)) : null,configurationExclusivity:config}); }
    const fingerprint=fingerprintIdentity({...source.release,setName:root,subset:null,cardNumber:row.number,players,teams,parallel,variation:variation(root),serialRun,autographStatus:autographStatus(root),memorabiliaStatus:memorabiliaStatus(root),configurationExclusivity:config});
    if (fingerprintSet.has(fingerprint.fingerprintSha256)) throw new Error(`${source.id} duplicate identity fingerprint at row ${row.sourceRow}: ${fingerprint.fingerprintSha256}`); fingerprintSet.add(fingerprint.fingerprintSha256); identities.push({cardSourceKey,parallelSourceKey,fingerprint});
  }
  const sets=[...setMap.values()].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)); const cards=[...cardMap.values()].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)); const parallels=[...parallelMap.values()].sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey)); identities.sort((a,b)=>`${a.cardSourceKey}|${a.parallelSourceKey||""}|${a.fingerprint.fingerprintSha256}`.localeCompare(`${b.cardSourceKey}|${b.parallelSourceKey||""}|${b.fingerprint.fingerprintSha256}`));
  const issues=[]; const actualSha=sha256(bytes); if (!source.expectedSha256) issues.push({code:"source_hash_not_yet_pinned",severity:"error",message:`Pin ${actualSha} for ${source.id}`}); else if (actualSha!==source.expectedSha256) issues.push({code:"source_hash_mismatch",severity:"error",message:`${actualSha} != ${source.expectedSha256}`});
  const counts={sets:sets.length,cards:cards.length,parallels:parallels.length,identities:identities.length};
  if (rows.length!==identities.length) issues.push({code:"row_identity_mismatch",severity:"error",message:`rows=${rows.length}, identities=${identities.length}`});
  if (source.expected) for (const key of ["rows","sets","cards","parallels","identities"]) { const actual=key==="rows"?rows.length:counts[key]; if (actual!==source.expected[key]) issues.push({code:`expected_${key}_mismatch`,severity:"error",message:`${key}=${actual}, expected=${source.expected[key]}`}); }
  const checkResults=[];
  for (const check of source.checks) {
    const match=identities.find((entry)=>{ const n=entry.fingerprint.normalized; const base=n.setName===normalizeText(check.setName)&&n.cardNumber===normalizeCardNumber(check.cardNumber)&&n.players.includes(normalizeText(check.player)); if (!base) return false; if (check.requireNumberedNonBase) return n.parallel!=="base" && /^\/\d+$/.test(n.serialRun); return n.parallel===normalizeText(check.parallel) && n.serialRun===normalizeSerialRun(check.serialRun); });
    checkResults.push({label:check.label,found:Boolean(match),fingerprintSha256:match?.fingerprint.fingerprintSha256||null}); if (!match) issues.push({code:"known_identity_missing",severity:"error",message:check.label});
  }
  const storage=storageReceipt(source,bytes);
  const plan={schema:"tcos.checklist.importPlan.v1",adapterId:ADAPTER_ID,adapterVersion:ADAPTER_VERSION,source:{sourceUrl:source.url,retrievedAt,authority:"approved_reference_dataset",redistributionAllowed:false,privateArchiveRequired:true,normalizedFactsInternalOnly:true,storage},release:source.release,sets,cards,parallels,identities,validation:{status:issues.some((issue)=>issue.severity==="error")?"validation_required":"passed",issues,counts}};
  const normalizedPlanSha256=sha256(JSON.stringify({schema:"tcos.checklist.normalizedDigest.v1",adapterId:plan.adapterId,adapterVersion:plan.adapterVersion,release:plan.release,sets,cards,parallels,identities}));
  return {plan,rows:rows.length,physicalSetLabels:new Set(rows.map((row)=>row.physicalSet)).size,actualSha,normalizedPlanSha256,checkResults,rootMappings:[...new Set(rows.map((row)=>row.physicalSet))].sort().map((label)=>({physicalSet:label,rootSet:roots.get(label),parallel:source.setOverrides?.[label]?.parallel || (label===roots.get(label)?"Base":label.slice(roots.get(label).length).replace(/^[\s:-]+/,"").trim() || "Base")}))};
}

async function fetchSource(source) {
  const response=await fetch(source.url,{headers:{Accept:MIME_XLSX,Referer:source.landingUrl,"Cache-Control":"no-cache","User-Agent":"TCOS-Checklist-Registry/1.0 (+private validation)"},redirect:"follow",signal:AbortSignal.timeout(90000)}); const bytes=Buffer.from(await response.arrayBuffer()); if (!response.ok) throw new Error(`${source.id} HTTP ${response.status}`); if (bytes.length<10000 || bytes[0]!==0x50 || bytes[1]!==0x4b) throw new Error(`${source.id} did not return a complete XLSX (${bytes.length} bytes)`); return {bytes,finalUrl:response.url,contentType:response.headers.get("content-type")||""};
}

async function main() {
  mkdirSync(PRIVATE_ROOT,{recursive:true}); const retrievedAt=new Date().toISOString(); const results=[]; const failures=[];
  for (const source of SOURCES) {
    try {
      console.log(`Validating ${source.id}`); const fetched=await fetchSource(source); const parsed=parseWorkbook(source,fetched.bytes,retrievedAt); const sourceDir=resolve(PRIVATE_ROOT,source.id); mkdirSync(sourceDir,{recursive:true}); writeFileSync(resolve(sourceDir,`${source.id}.xlsx`),fetched.bytes); writeFileSync(resolve(sourceDir,`${source.id}.plan.json`),`${JSON.stringify(parsed.plan)}\n`);
      const result={id:source.id,rowSourceAuthority:"third_party_verified",registrySourceAuthority:"approved_reference_dataset",rowSourceUrl:source.url,rowSourceFinalUrl:fetched.finalUrl,officialCorroborationUrl:source.officialUrl,rawSourceSha256:parsed.actualSha,rawSourceSizeBytes:fetched.bytes.length,normalizedPlanSha256:parsed.normalizedPlanSha256,adapter:{id:ADAPTER_ID,version:ADAPTER_VERSION},counts:{rows:parsed.rows,physicalSetLabels:parsed.physicalSetLabels,...parsed.plan.validation.counts},knownIdentities:parsed.checkResults,rootMappings:parsed.rootMappings,validationStatus:parsed.plan.validation.status,issues:parsed.plan.validation.issues}; results.push(result); if (parsed.plan.validation.status!=="passed") failures.push(...parsed.plan.validation.issues.filter((issue)=>issue.severity==="error").map((issue)=>`${source.id}: ${issue.code}: ${issue.message}`));
    } catch (error) { const message=error instanceof Error?error.stack||error.message:String(error); results.push({id:source.id,validationStatus:"failed",error:message}); failures.push(`${source.id}: ${message}`); }
  }
  const totals=results.reduce((sum,result)=>({rows:sum.rows+Number(result.counts?.rows||0),sets:sum.sets+Number(result.counts?.sets||0),cards:sum.cards+Number(result.counts?.cards||0),parallels:sum.parallels+Number(result.counts?.parallels||0),identities:sum.identities+Number(result.counts?.identities||0)}),{rows:0,sets:0,cards:0,parallels:0,identities:0});
  const receipt={schema:"tcos.checklist.sixReleaseValidation.v1",generatedAt:new Date().toISOString(),status:failures.length?"failed":"passed",releaseCount:results.length,results,totals,failures,safety:{productionDatabaseWrites:false,migrationsApplied:false,deploymentPerformed:false,rawSourcesStoredOnlyInPrivateArtifact:true,rowSourcesNeverRepresentedAsOfficialManufacturer:true,officialCorroborationRecorded:true}}; mkdirSync(dirname(RECEIPT_PATH),{recursive:true}); writeFileSync(RECEIPT_PATH,`${JSON.stringify(receipt,null,2)}\n`); console.log(JSON.stringify({status:receipt.status,totals,results:results.map((r)=>({id:r.id,status:r.validationStatus,sha:r.rawSourceSha256,counts:r.counts,issues:r.issues})),failures},null,2)); if (failures.length) process.exitCode=1;
}
main().catch((error)=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exitCode=1;});
