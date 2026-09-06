import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getOpenAiExactEbayMarketProviders } from "../src/lib/instacomp-openai-web-market-provider";
import { verifyInstaCompCompetitionImages } from "../src/lib/instacomp-comp-visual-verification";

const INPUT = "audits/km252-pricing-input-20260906.json";
const DIR = "artifacts/km252-openai-discovery";
const OUT = `${DIR}/results.json`;
const ONLY = new Set(String(process.env.KM252_ONLY_N || "").split(",").map(Number).filter(Number.isFinite));
const REVIEW = new Set([169,174,181,234]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
type Obj = Record<string, any>;
function obj(v: unknown): Obj { return v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {}; }
async function frontFile(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "TCOS-KM252-OpenAI-Discovery/1.0" } });
  if (!res.ok) throw new Error(`target_image_http_${res.status}`);
  const bytes = await res.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("target_image_invalid_size");
  const type = String(res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  return new File([bytes], "target-card.jpg", { type });
}
async function one(item: Obj) {
  const n = Number(item.n);
  if (REVIEW.has(n)) return { n, id:item.id, title:item.title, outcome:"review_blocked" };
  const ai = obj(item.ai);
  const [market, target] = await Promise.all([
    getOpenAiExactEbayMarketProviders({ exactTitle: item.title, ai: ai as any, bypassCache: true }),
    frontFile(String(item.frontImageUrl || "")),
  ]);
  const soldReview = await verifyInstaCompCompetitionImages({ targetFrontImage: target, targetAi: ai as any, candidates: market.sold.results as any });
  const activeReview = await verifyInstaCompCompetitionImages({ targetFrontImage: target, targetAi: ai as any, candidates: market.active.results as any });
  return {
    n,id:item.id,title:item.title,outcome:"discovery_complete",
    model:market.model,responseId:market.responseId,citedItemIds:market.citedItemIds,notes:market.notes,
    soldProvider:{status:market.sold.status,message:market.sold.message,rawCount:market.sold.results.length},
    activeProvider:{status:market.active.status,message:market.active.message,rawCount:market.active.results.length},
    soldAccepted:soldReview.accepted,soldRejected:soldReview.rejected,
    activeAccepted:activeReview.accepted,activeRejected:activeReview.rejected,
    visual:{configured:soldReview.configured,model:soldReview.model,soldReviewed:soldReview.reviewedCount,activeReviewed:activeReview.reviewedCount},
  };
}
async function main(){
  if(!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
  await mkdir(DIR,{recursive:true});
  const all:Obj[]=JSON.parse(await readFile(INPUT,"utf8"));
  const selected=ONLY.size?all.filter(x=>ONLY.has(Number(x.n))):all;
  const results=[] as Obj[];
  for(const item of selected){
    try{ const r=await one(item); results.push(r); console.log("KM252_OPENAI",r.n,r.outcome,r.soldAccepted?.length??0,r.soldProvider?.status??""); }
    catch(e){ const r={n:Number(item.n),id:item.id,title:item.title,outcome:"failure",error:e instanceof Error?e.message:String(e)}; results.push(r); console.log("KM252_OPENAI",r.n,"failure",r.error); }
  }
  await writeFile(OUT,JSON.stringify({generatedAt:new Date().toISOString(),selected:selected.length,results},null,2));
  const failures=results.filter(r=>r.outcome==="failure").length;
  console.log("KM252_OPENAI_DONE",JSON.stringify({selected:selected.length,failures,soldAccepted:results.reduce((s,r)=>s+(r.soldAccepted?.length||0),0)}));
  if(failures) process.exitCode=2;
}
main().catch(e=>{console.error("KM252_OPENAI_FATAL",e instanceof Error?e.message:e);process.exit(1)});
