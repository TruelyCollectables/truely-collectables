import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { filterStrictExactMarketMatches } from "./instacomp-exact-market-provider";
import { buildExactIdentityTitle, isInstaCompPricingEligibleComp } from "./instacomp-live-pipeline";
import { persistExactCardMarketHistory } from "./instacomp-market-history";
import type { InstaCompAiResult, InstaCompComp } from "./instacomp";

const PROVIDER = "130point_manual_verification_v1";
const OPENAI_MODEL = String(process.env.INSTACOMP_130POINT_VISION_MODEL || "gpt-4.1-mini").trim();
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

type QueueStatus = "pending" | "completed" | "not_needed" | "error";

export type Point130ExtractedSale = {
  title: string;
  price: number;
  currency: string;
  marketplace: string;
  saleType: string | null;
  soldAt: string;
  bids: number | null;
  exactIdentity: boolean;
  notes: string | null;
};

export type Point130QueuePayload = {
  schemaVersion: "tcos.instacomp.130point-verification.v1";
  status: QueueStatus;
  registryIdentityId: string;
  registryFingerprintSha256: string;
  query: string;
  searchUrl: string;
  reasons: string[];
  pricingEligibleSoldCount: number;
  newestSoldAt: string | null;
  requestedAt: string;
  updatedAt: string;
  completedAt?: string | null;
  evidence?: Record<string, unknown> | null;
};
function env() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new Error("130point verification requires Supabase service-role access.");
  return { url, key };
}

function client() {
  const { url, key } = env();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function queueHash(registryIdentityId: string) {
  return createHash("sha256").update(`${PROVIDER}:${registryIdentityId}`).digest("hex");
}

function normalizedQuery(value: string) {
  return clean(value).toLowerCase().replace(/[^a-z0-9/#.+-]+/g, " ").trim();
}

export function build130PointVerificationQuery(ai: InstaCompAiResult, fallback?: string | null) {
  return buildExactIdentityTitle(ai, fallback)
    .replace(/\braw\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function build130PointVerificationUrl(query: string) {
  return `https://130point.com/sales/?search=${encodeURIComponent(clean(query) || "sports card")}`;
}

function validDate(value: unknown) {
  const parsed = new Date(clean(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
export function assess130PointVerificationNeed(params: {
  sold: Array<Pick<InstaCompComp, "price" | "soldAt">>;
  now?: Date;
}) {
  const now = params.now || new Date();
  const dated = params.sold
    .map((row) => ({ price: Number(row.price), soldAt: validDate(row.soldAt) }))
    .filter((row) => Number.isFinite(row.price) && row.price > 0 && row.soldAt)
    .sort((a, b) => String(b.soldAt).localeCompare(String(a.soldAt)));
  const reasons: string[] = [];
  if (dated.length < 3) reasons.push(`Only ${dated.length} trusted exact sold comp${dated.length === 1 ? "" : "s"} available.`);
  const newestSoldAt = dated[0]?.soldAt || null;
  if (!newestSoldAt) reasons.push("No dated trusted exact sold comp is available.");
  else {
    const ageDays = Math.floor((now.getTime() - new Date(newestSoldAt).getTime()) / 86_400_000);
    if (ageDays > 45) reasons.push(`Newest trusted exact sold comp is ${ageDays} days old.`);
  }
  if (dated.length >= 3) {
    const prices = dated.map((row) => row.price).sort((a, b) => a - b);
    const median = prices.length % 2
      ? prices[Math.floor(prices.length / 2)]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    const newestTwoAverage = (dated[0].price + dated[1].price) / 2;
    if (median > 0 && Math.abs(newestTwoAverage - median) / median >= 0.3) {
      reasons.push("Newest two sales differ from the broader sold median by at least 30%.");
    }
    const low = prices[0];
    const high = prices[prices.length - 1];
    if (low > 0 && high / low >= 1.75) reasons.push("Trusted sold prices are unusually dispersed.");
  }
  return { needed: reasons.length > 0, reasons, newestSoldAt, pricingEligibleSoldCount: dated.length };
}

export async function upsert130PointVerificationQueue(params: {
  registryIdentityId: string;
  registryFingerprintSha256: string;
  ai: InstaCompAiResult;
  sold: InstaCompComp[];
  fallbackQuery?: string | null;
}) {
  const trustedSold = params.sold.filter(isInstaCompPricingEligibleComp);
  const assessment = assess130PointVerificationNeed({ sold: trustedSold });
  const query = build130PointVerificationQuery(params.ai, params.fallbackQuery);
  const now = new Date();
  const payload: Point130QueuePayload = {
    schemaVersion: "tcos.instacomp.130point-verification.v1",
    status: assessment.needed ? "pending" : "not_needed",
    registryIdentityId: params.registryIdentityId,
    registryFingerprintSha256: params.registryFingerprintSha256,
    query,
    searchUrl: build130PointVerificationUrl(query),
    reasons: assessment.reasons,
    pricingEligibleSoldCount: assessment.pricingEligibleSoldCount,
    newestSoldAt: assessment.newestSoldAt,
    requestedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const supabase = client();
  const hash = queueHash(params.registryIdentityId);
  const { data: existing } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload")
    .eq("query_hash", hash)
    .maybeSingle();
  const existingPayload = existing?.result_payload as Point130QueuePayload | null;
  if (existingPayload?.status === "completed" && assessment.needed) {
    const completedMs = existingPayload.completedAt ? new Date(existingPayload.completedAt).getTime() : NaN;
    const newestMs = assessment.newestSoldAt ? new Date(assessment.newestSoldAt).getTime() : NaN;
    const stillFresh = Number.isFinite(completedMs) && now.getTime() - completedMs < 30 * 86_400_000;
    const noNewerSale = !Number.isFinite(newestMs) || !Number.isFinite(completedMs) || newestMs <= completedMs;
    if (stillFresh && noNewerSale) {
      payload.status = "completed";
      payload.completedAt = existingPayload.completedAt || null;
      payload.evidence = existingPayload.evidence || null;
    }
  }
  const { error } = await supabase.from("instacomp_search_cache").upsert(
    {
      query_hash: hash,
      provider: PROVIDER,
      normalized_query: normalizedQuery(query),
      result_payload: payload,
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TEN_YEARS_MS).toISOString(),
      hit_count: 0,
    },
    { onConflict: "query_hash" },
  );
  if (error) throw new Error(`130point verification queue write failed: ${error.message}`);
  return payload;
}

export async function list130PointVerificationQueue(status?: QueueStatus | "all") {
  const supabase = client();
  const { data, error } = await supabase
    .from("instacomp_search_cache")
    .select("id,result_payload,updated_at")
    .eq("provider", PROVIDER)
    .order("updated_at", { ascending: false })
    .limit(250);
  if (error) throw new Error(`130point verification queue read failed: ${error.message}`);
  return (data || [])
    .map((row) => ({ id: String(row.id), ...(row.result_payload as Point130QueuePayload) }))
    .filter((row) => !status || status === "all" || row.status === status);
}
function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("130point screenshot verifier returned no JSON object.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function normalize130PointExtractedRows(value: unknown): Point130ExtractedSale[] {
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rows = Array.isArray(root.sales) ? root.sales : [];
  return rows
    .map((raw): Point130ExtractedSale | null => {
      const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const title = clean(row.title);
      const price = Number(row.price);
      const soldAt = validDate(row.soldAt);
      if (!title || !Number.isFinite(price) || price <= 0 || !soldAt) return null;
      const bids = row.bids === null || row.bids === undefined ? null : Number(row.bids);
      return {
        title,
        price: Number(price.toFixed(2)),
        currency: clean(row.currency) || "USD",
        marketplace: clean(row.marketplace) || "Unknown",
        saleType: clean(row.saleType) || null,
        soldAt,
        bids: bids !== null && Number.isFinite(bids) && bids >= 0 ? Math.floor(bids) : null,
        exactIdentity: row.exactIdentity === true,
        notes: clean(row.notes) || null,
      };
    })
    .filter((row): row is Point130ExtractedSale => Boolean(row));
}

async function screenshotData(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Upload a screenshot image file.");
  const raw = Buffer.from(await file.arrayBuffer());
  if (!raw.length || raw.length > MAX_SCREENSHOT_BYTES) throw new Error("130point screenshot must be 12MB or smaller.");
  // Keep Sharp out of the Cloudflare evaluator bundle. 130point evidence is already
  // capped at 12 MB, so the vision endpoint can consume the original screenshot.
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const contentType = file.type || "image/jpeg";
  return { sha256, dataUrl: `data:${contentType};base64,${raw.toString("base64")}`, bytes: raw.length };
}
async function extractScreenshotSales(params: {
  ai: InstaCompAiResult;
  query: string;
  screenshotDataUrl: string;
}) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured for 130point screenshot reading.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: [
          "Read this 130point.com sales-results screenshot as evidence. Do not browse 130point and do not invent hidden rows.",
          "Extract every clearly visible sold result. Return JSON only as {sales:[...]}",
          "Each sale must contain title, price, currency, marketplace, saleType, soldAt, bids, exactIdentity, notes.",
          "soldAt must be ISO-8601 when a visible date/time exists. price is the visible realized sale price.",
          "Mark exactIdentity=true only when the visible title matches the canonical target including player, year/product, card number, parallel, serial print run, autograph/relic state, and raw/graded state when applicable.",
          "A PSA/BGS/SGC graded copy is not an exact raw comp. A different parallel is not exact. If uncertain, exactIdentity=false.",
          `SEARCH QUERY: ${params.query}`,
          `CANONICAL TARGET: ${JSON.stringify(params.ai)}`,
        ].join("\n") },
        { type: "image_url", image_url: { url: params.screenshotDataUrl, detail: "high" } },
      ] }],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`130point screenshot reader failed (${response.status}): ${text.slice(0, 400)}`);
  const payload = JSON.parse(text);
  return normalize130PointExtractedRows(parseJsonObject(clean(payload?.choices?.[0]?.message?.content)));
}

function saleToComp(sale: Point130ExtractedSale, searchUrl: string, evidenceSha256: string, index: number) {
  const marketplaceKey = clean(sale.marketplace).toLowerCase().replace(/[^a-z0-9]+/g, "_") || "unknown";
  return {
    title: sale.title,
    price: sale.price,
    itemPrice: sale.price,
    shippingPrice: null,
    priceIncludesShipping: false,
    currency: sale.currency || "USD",
    url: `${searchUrl}#manual-evidence-${evidenceSha256.slice(0, 12)}-${index + 1}`,
    imageUrl: null,
    source: `130point_manual_screenshot_${marketplaceKey}`,
    sourceLabel: `130point Manual Verified Sold (${sale.marketplace})`,
    sourceCategory: "sold" as const,
    soldAt: sale.soldAt,
    listedAt: null,
    observedAt: new Date().toISOString(),
  };
}
export async function ingest130PointVerificationScreenshot(params: {
  registryIdentityId: string;
  screenshot: File;
}) {
  const supabase = client();
  const hash = queueHash(params.registryIdentityId);
  const { data: queueRow, error: queueError } = await supabase
    .from("instacomp_search_cache")
    .select("result_payload")
    .eq("query_hash", hash)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (queueError) throw new Error(`130point queue lookup failed: ${queueError.message}`);
  const queue = queueRow?.result_payload as Point130QueuePayload | null;
  if (!queue?.registryIdentityId) throw new Error("No 130point verification queue item exists for this card.");

  const { data: identity, error: identityError } = await supabase
    .from("tcos_card_market_identities")
    .select("registry_fingerprint_sha256,identity_json")
    .eq("registry_identity_id", params.registryIdentityId)
    .maybeSingle();
  if (identityError) throw new Error(`Exact-card identity lookup failed: ${identityError.message}`);
  if (!identity?.identity_json) throw new Error("Canonical exact-card identity is missing.");
  if (String(identity.registry_fingerprint_sha256 || "") !== queue.registryFingerprintSha256) {
    throw new Error("Registry fingerprint changed; screenshot verification was blocked.");
  }
  const ai = identity.identity_json as InstaCompAiResult;
  const screenshot = await screenshotData(params.screenshot);
  const extracted = await extractScreenshotSales({ ai, query: queue.query, screenshotDataUrl: screenshot.dataUrl });
  const modelExact = extracted.filter((sale) => sale.exactIdentity);
  const candidates = modelExact.map((sale, index) => saleToComp(sale, queue.searchUrl, screenshot.sha256, index));
  const accepted = filterStrictExactMarketMatches(candidates, ai, 50).map((comp) => ({
    ...comp,
    flags: Array.from(new Set([
      ...comp.flags,
      "130point manual screenshot evidence",
      `evidence sha256 ${screenshot.sha256}`,
      "accepted offer/realized price visible in screenshot",
      "130point realized item price; shipping not represented",
    ])).slice(0, 20),
  }));

  const history = await persistExactCardMarketHistory({
    registry: {
      matched: true,
      identityId: params.registryIdentityId,
      fingerprintSha256: queue.registryFingerprintSha256,
      sourceTier: "manual_130point_screenshot",
    },
    ai,
    sold: accepted,
    active: [],
    observedAt: new Date().toISOString(),
  });
  const now = new Date().toISOString();
  const evidence = {
    screenshotSha256: screenshot.sha256,
    screenshotBytes: screenshot.bytes,
    screenshotDataUrl: screenshot.dataUrl,
    model: OPENAI_MODEL,
    extractedSales: extracted,
    acceptedExactSales: accepted,
    rejectedSales: extracted.filter((sale) => !sale.exactIdentity || !accepted.some((comp) => comp.title === sale.title && comp.price === sale.price)),
    history,
  };
  const updated: Point130QueuePayload = {
    ...queue,
    status: accepted.length ? "completed" : "error",
    updatedAt: now,
    completedAt: accepted.length ? now : null,
    evidence,
  };
  const { error: updateError } = await supabase.from("instacomp_search_cache").update({
    result_payload: updated,
    updated_at: now,
    expires_at: new Date(Date.now() + TEN_YEARS_MS).toISOString(),
  }).eq("query_hash", hash);
  if (updateError) throw new Error(`130point verification result save failed: ${updateError.message}`);

  return {
    queue: updated,
    extractedCount: extracted.length,
    acceptedCount: accepted.length,
    accepted,
    history,
    screenshotSha256: screenshot.sha256,
  };
}
