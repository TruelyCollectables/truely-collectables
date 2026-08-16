import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { persistPlanStaged } from "./staged-registry-writer.mjs";

const HARVEST_ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const PLAN_ROOT = resolve(process.env.CERTIFIED_LAYOUT_PDF_PLAN_DIR || "");
const OUTPUT = resolve(process.env.CERTIFIED_LAYOUT_PDF_APPLY_RECEIPT || `${HARVEST_ROOT}/certified-layout-pdf-apply-receipt.json`);
const ATTEMPTS = Math.max(1, Number(process.env.CERTIFIED_LAYOUT_PDF_ATTEMPTS || 4));
const RETRY_MS = Math.max(2000, Number(process.env.CERTIFIED_LAYOUT_PDF_RETRY_MS || 15000));
const PREFLIGHT_ATTEMPTS = Math.max(1, Number(process.env.CERTIFIED_LAYOUT_PDF_PREFLIGHT_ATTEMPTS || 5));

const EXACT_KEYS = [
  "hockey|2021-22|topps|sticker-collection-nhl",
  "hockey|2022-23|upper-deck|o-pee-chee-nhl",
  "hockey|2022|leaf|art-of",
];

if (!HARVEST_ROOT || !existsSync(HARVEST_ROOT)) throw new Error(`Verified harvest root is missing: ${HARVEST_ROOT}`);
if (!PLAN_ROOT || !existsSync(PLAN_ROOT)) throw new Error(`Certified layout PDF plan directory is missing: ${PLAN_ROOT}`);
const sourcesDir = resolve(HARVEST_ROOT, "output/sources");
if (!existsSync(sourcesDir)) throw new Error(`Immutable source directory is missing: ${sourcesDir}`);

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Production Supabase credentials are required.");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" };
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const transient = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|fetch failed|network|aborted|\b52[125]\b|\b544\b/i.test(String(message || ""));

async function fetchJson(url, label) {
  let last = null;
  for (let attempt = 1; attempt <= PREFLIGHT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : [];
      last = new Error(`${label} HTTP ${response.status}: ${text.slice(0, 300)}`);
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
    if (attempt < PREFLIGHT_ATTEMPTS && transient(last?.message)) await sleep(Math.min(30_000, attempt * 5000));
    else break;
  }
  throw last || new Error(`${label} failed`);
}

async function preflight(slug) {
  const releaseUrl = new URL(`${supabaseUrl}/rest/v1/checklist_releases`);
  releaseUrl.searchParams.set("select", "id,slug");
  releaseUrl.searchParams.set("slug", `eq.${slug}`);
  releaseUrl.searchParams.set("limit", "1");
  const releases = await fetchJson(releaseUrl, `release preflight ${slug}`);
  if (!Array.isArray(releases) || !releases.length) return { complete: false, reason: "release_missing" };
  const versionUrl = new URL(`${supabaseUrl}/rest/v1/checklist_versions`);
  versionUrl.searchParams.set("select", "id,status,is_active,normalized_card_count,normalized_identity_count");
  versionUrl.searchParams.set("release_id", `eq.${releases[0].id}`);
  versionUrl.searchParams.set("is_active", "eq.true");
  versionUrl.searchParams.set("status", "in.(live,revised)");
  const versions = await fetchJson(versionUrl, `version preflight ${slug}`);
  const ready = (Array.isArray(versions) ? versions : []).find((row) => Number(row.normalized_card_count || 0) > 0 && Number(row.normalized_identity_count || 0) > 0);
  return ready ? { complete: true, versionId: ready.id, cards: Number(ready.normalized_card_count || 0), identities: Number(ready.normalized_identity_count || 0) } : { complete: false, reason: "no_complete_active_version" };
}

async function persistWithRetry(plan, bytes, exactSetKey) {
  let last = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await persistPlanStaged(db, plan, bytes);
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      console.error(`${exactSetKey} persistence attempt ${attempt}/${ATTEMPTS}: ${last.message}`);
      if (attempt >= ATTEMPTS || !transient(last.message)) break;
      await sleep(Math.min(60_000, RETRY_MS * attempt));
      try {
        const state = await preflight(plan.release.releaseSlug);
        if (state.complete) return { recoveredByPreflight: true, ...state };
      } catch (checkError) {
        console.warn(`${exactSetKey} recovery preflight failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
      }
    }
  }
  throw last || new Error(`Unknown persistence failure for ${exactSetKey}`);
}

const sourceFiles = readdirSync(sourcesDir);
const receipt = { schema: "tcos.requestedHockeyCertifiedLayoutPdfApply.v1", targetCount: EXACT_KEYS.length, results: [] };
function save() {
  receipt.updatedAt = new Date().toISOString();
  receipt.persistedCount = receipt.results.filter((row) => row.status === "persisted").length;
  receipt.alreadyLiveCount = receipt.results.filter((row) => row.status === "already_live").length;
  receipt.failedCount = receipt.results.filter((row) => row.status === "failed").length;
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

const tasks = EXACT_KEYS.map(async (exactSetKey) => {
  const row = { exactSetKey };
  receipt.results.push(row);
  try {
    const planPath = resolve(PLAN_ROOT, `${safeSlug(exactSetKey)}.json`);
    if (!existsSync(planPath)) throw new Error(`Certified plan missing: ${planPath}`);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    if (plan?.validation?.status !== "passed") throw new Error(`Certified plan validation is ${plan?.validation?.status || "missing"}`);
    if (!String(plan?.release?.releaseSlug || "").endsWith("-hockey")) throw new Error(`Refusing non-Hockey plan ${plan?.release?.releaseSlug || "missing"}`);
    row.releaseSlug = plan.release.releaseSlug;
    row.counts = plan.validation.counts;

    const before = await preflight(plan.release.releaseSlug);
    if (before.complete) {
      row.status = "already_live";
      row.live = before;
      console.log(`ALREADY LIVE ${plan.release.releaseSlug}`);
      return;
    }

    const sourcePrefix = `${safeSlug(exactSetKey)}__`;
    const original = String(plan?.source?.storage?.originalFilename || "").toLowerCase();
    const sourceName = sourceFiles.find((name) => name.startsWith(sourcePrefix) && name.slice(name.indexOf("__") + 2).toLowerCase() === original);
    if (!sourceName) throw new Error(`Immutable source not found for ${exactSetKey}: ${original}`);
    const bytes = readFileSync(resolve(sourcesDir, sourceName));
    const expectedSize = Number(plan.source.storage.sizeBytes || 0);
    const expectedSha = String(plan.source.storage.sha256 || "");
    if (expectedSize && bytes.byteLength !== expectedSize) throw new Error(`Source byte mismatch ${bytes.byteLength} != ${expectedSize}`);
    if (expectedSha && sha256(bytes) !== expectedSha) throw new Error(`Source SHA-256 mismatch for ${sourceName}`);

    const guard = await preflight(plan.release.releaseSlug);
    if (guard.complete) {
      row.status = "already_live";
      row.live = guard;
      return;
    }
    row.transaction = await persistWithRetry(plan, bytes, exactSetKey);
    row.status = "persisted";
    console.log(`PERSISTED ${plan.release.releaseSlug} ${JSON.stringify(plan.validation.counts)}`);
  } catch (error) {
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
    console.error(`FAILED ${exactSetKey}: ${row.error}`);
  } finally {
    save();
  }
});

await Promise.all(tasks);
save();
console.log(JSON.stringify({ targetCount: receipt.targetCount, persistedCount: receipt.persistedCount, alreadyLiveCount: receipt.alreadyLiveCount, failedCount: receipt.failedCount }, null, 2));
if (receipt.failedCount) process.exitCode = 2;
