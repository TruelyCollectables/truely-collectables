import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { buildInstaCompQueries } from "../src/lib/instacomp";
import { verifyInstaCompCompetitionImages } from "../src/lib/instacomp-comp-visual-verification";
import { getUniversalEbaySerpProviders } from "../src/lib/instacomp-ebay-serp-provider";
import { calculateInstaCompSweetSpot } from "../src/lib/instacomp-sweet-spot";

const INPUT = "audits/km252-pricing-input-20260906.json";
const DIR = "artifacts/km252-pricing";
const OUT = `${DIR}/results.jsonl`;
const SUMMARY = `${DIR}/summary.json`;
const REVIEW = new Set([169, 174, 181, 234]);
const ONLY = new Set(String(process.env.KM252_ONLY_N || "").split(",").map(Number).filter(Number.isFinite));
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.KM252_PRICE_CONCURRENCY || 3)));
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

type Obj = Record<string, any>;
type Evidence = Obj & { price: number; url: string; flags: string[]; sourceCategory: string };
function obj(v: unknown): Obj { return v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {}; }
function strings(v: unknown) { return Array.isArray(v) ? v.map(x => String(x || "").trim()).filter(Boolean) : []; }
function normEvidence(v: unknown): Evidence | null {
  const r = obj(v); const price = Number(r.price); const url = String(r.url || "").trim();
  if (!Number.isFinite(price) || price <= 0 || !url) return null;
  return { ...r, title: String(r.title || "Untitled listing"), price: Math.round(price * 100) / 100,
    currency: String(r.currency || "USD"), url, imageUrl: typeof r.imageUrl === "string" ? r.imageUrl : null,
    source: String(r.source || "unknown"), sourceLabel: String(r.sourceLabel || "Unknown source"),
    sourceCategory: String(r.sourceCategory || "broad"), matchScore: Number.isFinite(Number(r.matchScore)) ? Number(r.matchScore) : null,
    flags: strings(r.flags).slice(0, 20), soldAt: typeof r.soldAt === "string" ? r.soldAt : null,
    listedAt: typeof r.listedAt === "string" ? r.listedAt : null, observedAt: typeof r.observedAt === "string" ? r.observedAt : null } as Evidence;
}
function evidenceList(v: unknown, limit: number) {
  return (Array.isArray(v) ? v : []).map(normEvidence).filter(Boolean).slice(0, limit) as Evidence[];
}
function excluded(r: Evidence) {
  return r.flags.some(f => /excluded|guidance comp|not used for pricing|parallel mismatch|not exact parallel|visual mismatch|inconclusive/i.test(f));
}
function dedupe(values: Evidence[], limit: number) {
  const seen = new Set<string>();
  return values.filter(r => { const key = r.url || `${r.title}|${r.price}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, limit);
}
async function frontFile(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000), headers: { "User-Agent": "TCOS-KM252-GHA/1.0" } });
  if (!res.ok) throw new Error(`target_image_http_${res.status}`);
  const bytes = await res.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("target_image_invalid_size");
  const type = String(res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  return new File([bytes], "target-card.jpg", { type });
}
function coverage(p: Obj) {
  return { source: p.source, label: p.label, status: p.status, resultCount: Array.isArray(p.results) ? p.results.length : 0,
    message: p.message || null, searchUrl: p.searchUrl || null };
}
async function priceOne(item: Obj) {
  const n = Number(item.n); const ai = obj(item.ai);
  if (REVIEW.has(n) || obj(item.proof).category === "STILL NEEDS REVIEW") {
    return { n, id: item.id, title: item.title, outcome: "review_blocked", suggestedPrice: 0, soldCount: 0 };
  }
  if (!["PERFECT", "FIXED → PERFECT"].includes(String(obj(item.proof).category || ""))) throw new Error(`final_proof_not_ready:${obj(item.proof).category}`);
  if (!ai.player || !ai.year || !ai.cardNumber || !(ai.setName || ai.brand)) throw new Error("trusted_ai_identity_incomplete");
  const frontUrl = String(item.frontImageUrl || "").trim(); if (!frontUrl) throw new Error("front_image_missing");
  const fallbackQuery = buildInstaCompQueries(ai as any).primary;
  const [universal, targetFront] = await Promise.all([getUniversalEbaySerpProviders({ exactTitle: item.title, fallbackQuery, ai: ai as any }), frontFile(frontUrl)]);
  const soldCandidates = evidenceList(universal.sold.results, 50); const activeCandidates = evidenceList(universal.active.results, 30);
  const [soldReview, activeReview] = await Promise.all([
    verifyInstaCompCompetitionImages({ targetFrontImage: targetFront, targetAi: ai as any, candidates: soldCandidates as any }),
    verifyInstaCompCompetitionImages({ targetFrontImage: targetFront, targetAi: ai as any, candidates: activeCandidates as any }),
  ]);
  const sold = dedupe(evidenceList(soldReview.accepted, 50).filter(r => r.sourceCategory === "sold" && !excluded(r)), 50);
  const active = dedupe(evidenceList(activeReview.accepted, 30).filter(r => ["marketplace", "auction"].includes(r.sourceCategory) && !excluded(r)), 30);
  const rejected = dedupe([...evidenceList(soldReview.rejected, 30), ...evidenceList(activeReview.rejected, 30)], 60);
  const raw = calculateInstaCompSweetSpot({ sold: sold as any, active: active as any });
  const reliable = raw.soldCount > 0; const suggestedPrice = reliable ? raw.suggestedPrice : 0;
  const pricingStatus = reliable ? "suggested_from_reliable_sold_comps" : "seller_price_required";
  const pricingReason = reliable ? raw.explanation : `${raw.explanation} InstaComp will not issue a suggested price without at least one image-verified exact sold listing.`;
  return { n, id: item.id, title: item.title, outcome: reliable ? "priced" : "manual_required", suggestedPrice,
    pricingStatus, pricingReason, pricingAnalysis: { ...raw, suggestedPrice }, reliableSoldCompCount: reliable ? raw.soldCount : 0,
    soldCount: reliable ? raw.soldCount : 0, activeCount: active.length, soldCompEvidence: sold, activeCompetition: active,
    rejectedCandidates: rejected, providerCoverage: [coverage(universal.sold), coverage(universal.active)],
    sourceLinks: { ebaySoldUrl: universal.sold.searchUrl || null, ebayActiveUrl: universal.active.searchUrl || null },
    universalEbayReview: { soldReviewed: soldReview.reviewedCount, activeReviewed: activeReview.reviewedCount,
      soldTitleOverrides: soldReview.titleOverrides, activeTitleOverrides: activeReview.titleOverrides, model: soldReview.model },
    soldQueries: universal.soldQueries, activeQueries: universal.activeQueries };
}
async function main() {
  if (!process.env.SERPAPI_API_KEY) throw new Error("SERPAPI_API_KEY_missing");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
  await mkdir(DIR, { recursive: true }); await writeFile(OUT, "");
  const all: Obj[] = JSON.parse(await readFile(INPUT, "utf8"));
  if (!Array.isArray(all) || all.length !== 252) throw new Error(`input_not_252:${all?.length}`);
  const selected = ONLY.size ? all.filter(x => ONLY.has(Number(x.n))) : all;
  console.log("KM252_ACTION_START", { selected: selected.length, concurrency: CONCURRENCY, only: [...ONLY] });
  let next = 0, done = 0; const results: Obj[] = [];
  async function worker(workerId: number) {
    while (true) {
      const i = next++; if (i >= selected.length) return; const item = selected[i]; let result: Obj;
      try { result = await priceOne(item); }
      catch (e) { result = { n: Number(item.n), id: item.id, title: item.title, outcome: "failure", error: e instanceof Error ? e.message : String(e) }; }
      result.checkedAt = new Date().toISOString(); result.worker = workerId; results.push(result);
      await appendFile(OUT, JSON.stringify(result) + "\n"); done += 1;
      console.log("KM252_ACTION", done, "/", selected.length, "card", result.n, result.outcome, result.suggestedPrice ?? "", "sold", result.soldCount ?? "", result.error || "");
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));
  results.sort((a,b) => Number(a.n) - Number(b.n));
  const count = (name:string) => results.filter(r => r.outcome === name).length;
  const summary = { generatedAt: new Date().toISOString(), selected: selected.length, completed: results.length,
    priced: count("priced"), manualRequired: count("manual_required"), reviewBlocked: count("review_blocked"), failures: count("failure"),
    suggestedValue: Math.round(results.reduce((s,r) => s + (r.outcome === "priced" ? Number(r.suggestedPrice || 0) : 0), 0) * 100) / 100,
    providerSecretsPresent: { serpapi: Boolean(process.env.SERPAPI_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY) }, results };
  await writeFile(SUMMARY, JSON.stringify(summary, null, 2));
  console.log("KM252_ACTION_DONE", JSON.stringify({ selected: summary.selected, priced: summary.priced, manualRequired: summary.manualRequired,
    reviewBlocked: summary.reviewBlocked, failures: summary.failures, suggestedValue: summary.suggestedValue }));
  if (summary.failures) process.exitCode = 2;
}
main().catch(e => { console.error("KM252_ACTION_FATAL", e instanceof Error ? e.message : e); process.exit(1); });
