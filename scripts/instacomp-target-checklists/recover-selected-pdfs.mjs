import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlanComplexity, buildPlan, dbClient } from "../mainstream-checklist/registry-tools.mjs";
import { parseChecklist } from "../mainstream-checklist/source-tools.mjs";
import { normalizeCoordinateParsedChecklist, normalizeGoGtsPdfCoordinates } from "./gogts-pdf-coordinate-normalizer.mjs";
import { persistPlanStaged } from "./staged-registry-writer.mjs";

const ROOT=resolve(process.env.VERIFIED_HARVEST_ROOT||"");
const OUTPUT=resolve(process.env.PDF_RECOVERY_RECEIPT||`${ROOT}/selected-pdf-recovery-receipt.json`);
const MINIMUM_CARD_ROWS=Math.max(1,Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS||20));
const TARGET_ATTEMPTS=Math.max(1,Number(process.env.PDF_TARGET_ATTEMPTS||4));
const RETRY_DELAY_MS=Math.max(2000,Number(process.env.PDF_TARGET_RETRY_DELAY_MS||10000));
const EXACT_KEYS=new Set([
  "basketball|2024|panini|prizm-wnba",
  "hockey|2021-22|topps|sticker-collection-nhl",
  "hockey|2021-22|upper-deck|the-cup-nhl",
  "hockey|2022-23|upper-deck|o-pee-chee-nhl",
  "hockey|2022-23|upper-deck|premier-nhl",
  "hockey|2022-23|upper-deck|the-cup-nhl",
  "hockey|2023-24|upper-deck|skybox-metal-universe-nhl",
  "hockey|2024-25|upper-deck|series-two-nhl",
  "hockey|2024-25|upper-deck|sp-authentic-nhl",
]);
if(!ROOT||!existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath=resolve(ROOT,"output/summary.json"), sourcesDir=resolve(ROOT,"output/sources");
if(!existsSync(summaryPath)||!existsSync(sourcesDir)) throw new Error("Verified harvest bundle is incomplete.");

const acronyms=new Map([["ahl","AHL"],["chl","CHL"],["nba","NBA"],["nfl","NFL"],["nhl","NHL"],["pwhl","PWHL"],["wnba","WNBA"]]);
const displayToken=(value)=>String(value||"").split("-").filter(Boolean).map((part)=>acronyms.get(part.toLowerCase())||`${part.slice(0,1).toUpperCase()}${part.slice(1)}`).join(" ");
const safeSlug=(value)=>String(value||"").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^_+|_+$/g,"")||"target";
const sleep=(ms)=>new Promise((resolvePromise)=>setTimeout(resolvePromise,ms));
const transientMessage=(message)=>/timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b52[125]\b|\b544\b|fetch failed|network/i.test(String(message||""));
function buildEntry(row,sourceUrl){
  const [sportKey,seasonKey,manufacturerKey,productKey]=row.exactSetKey.split("|");
  const manufacturer=displayToken(manufacturerKey), product=displayToken(productKey);
  return {id:`selected-pdf-${safeSlug(row.exactSetKey)}`,sourceName:new URL(sourceUrl).hostname,sourceUrl,authority:"approved_reference_dataset",redistributionAllowed:false,minimumCardRows:MINIMUM_CARD_ROWS,release:{exactSetKey:row.exactSetKey,canonicalName:`${seasonKey} ${manufacturer} ${product} ${displayToken(sportKey)}`,manufacturer,brand:null,product,releaseYear:Number(String(seasonKey).match(/\d{4}/)?.[0]||0),season:seasonKey,sport:sportKey,league:null}};
}
async function persistWithRetry(db,plan,bytes,key){
  let last=null;
  for(let attempt=1;attempt<=TARGET_ATTEMPTS;attempt+=1){
    try{return await persistPlanStaged(db,plan,bytes);}catch(error){last=error instanceof Error?error:new Error(String(error));console.warn(`${key} persist attempt ${attempt}/${TARGET_ATTEMPTS} failed: ${last.message}`);if(!transientMessage(last.message)||attempt===TARGET_ATTEMPTS)break;await sleep(Math.min(60000,RETRY_DELAY_MS*attempt));}
  }
  throw last||new Error(`Unknown persistence failure for ${key}`);
}

const summary=JSON.parse(readFileSync(summaryPath,"utf8"));
const candidates=(summary.validationFailed||[]).filter((row)=>EXACT_KEYS.has(row.exactSetKey));
if(candidates.length!==EXACT_KEYS.size) throw new Error(`Expected ${EXACT_KEYS.size} selected PDF failures, found ${candidates.length}.`);
const sourceFiles=readdirSync(sourcesDir), db=dbClient(), results=[];
for(let index=0;index<candidates.length;index+=1){
  const row=candidates[index], slug=safeSlug(row.exactSetKey), sourceName=sourceFiles.find((name)=>name.startsWith(`${slug}__`));
  if(!sourceName){results.push({exactSetKey:row.exactSetKey,status:"failed",error:"Immutable source file missing."});continue;}
  const bytes=readFileSync(resolve(sourcesDir,sourceName));
  const filename=sourceName.slice(sourceName.indexOf("__")+2), sourceUrl=row.selectedUrl||row.finalUrl||row.sourceUrl;
  const source={bytes,filename,mimeType:"application/pdf",selectedUrl:sourceUrl,finalUrl:row.finalUrl||sourceUrl};
  const entry=buildEntry(row,sourceUrl);
  console.log(`=== PDF COORDINATE REPAIR ${index+1}/${candidates.length}: ${row.exactSetKey} ===`);
  try{
    const coordinate=normalizeGoGtsPdfCoordinates(bytes);
    if(!coordinate.detected||coordinate.rows.length<MINIMUM_CARD_ROWS){results.push({exactSetKey:row.exactSetKey,status:"validation_failed",coordinateRows:coordinate.rows.length,error:"Coordinate extractor did not produce enough deterministic rows."});continue;}
    const parsed=normalizeCoordinateParsedChecklist(parseChecklist(entry,coordinate.text));
    const plan=buildPlan(entry,parsed,source,new Date().toISOString());
    const complexity=assertPlanComplexity(plan);
    const errors=plan.validation.issues.filter((issue)=>issue.severity==="error");
    if(plan.validation.status!=="passed"){results.push({exactSetKey:row.exactSetKey,status:"validation_failed",coordinateRows:coordinate.rows.length,coordinateBuckets:coordinate.buckets.length,counts:plan.validation.counts,errors:errors.slice(0,30)});continue;}
    const transaction=await persistWithRetry(db,plan,bytes,row.exactSetKey);
    results.push({exactSetKey:row.exactSetKey,status:"persisted",coordinateRows:coordinate.rows.length,coordinateBuckets:coordinate.buckets.length,counts:plan.validation.counts,serializedBytes:complexity.serializedBytes,transaction});
  }catch(error){results.push({exactSetKey:row.exactSetKey,status:"failed",error:error instanceof Error?error.message:String(error)});}
}
const persisted=results.filter((row)=>row.status==="persisted"), unresolved=results.filter((row)=>row.status!=="persisted");
const receipt={schema:"tcos.checklist.selectedPdfRecovery.v1",targetCount:EXACT_KEYS.size,attemptedCount:results.length,persistedCount:persisted.length,unresolvedCount:unresolved.length,persistedCards:persisted.reduce((sum,row)=>sum+Number(row.counts?.cards||0),0),persistedParallels:persisted.reduce((sum,row)=>sum+Number(row.counts?.parallels||0),0),persistedIdentities:persisted.reduce((sum,row)=>sum+Number(row.counts?.identities||0),0),results};
writeFileSync(OUTPUT,`${JSON.stringify(receipt,null,2)}\n`);
console.log(JSON.stringify({targetCount:receipt.targetCount,attemptedCount:receipt.attemptedCount,persistedCount:receipt.persistedCount,unresolvedCount:receipt.unresolvedCount,persistedCards:receipt.persistedCards,persistedParallels:receipt.persistedParallels,persistedIdentities:receipt.persistedIdentities},null,2));
if(results.length!==EXACT_KEYS.size||!persisted.length) process.exitCode=2;
