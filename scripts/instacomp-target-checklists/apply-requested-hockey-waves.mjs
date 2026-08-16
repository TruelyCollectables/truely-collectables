import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { persistPlanStaged } from "./staged-registry-writer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.REQUESTED_HOCKEY_RECEIPT || `${ROOT}/requested-hockey-wave-receipt.json`);
const WAVE_SIZE = Math.max(1, Number(process.env.REQUESTED_HOCKEY_WAVE_SIZE || 4));
const WAVE_DELAY_MS = Math.max(0, Number(process.env.REQUESTED_HOCKEY_WAVE_DELAY_MS || 300000));
const PREFLIGHT_ATTEMPTS = Math.max(1, Number(process.env.REQUESTED_HOCKEY_PREFLIGHT_ATTEMPTS || 6));
const PREFLIGHT_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUESTED_HOCKEY_PREFLIGHT_TIMEOUT_MS || 25000));
const PREFLIGHT_RETRY_MS = Math.max(1000, Number(process.env.REQUESTED_HOCKEY_PREFLIGHT_RETRY_MS || 5000));
const TARGET_ATTEMPTS = Math.max(1, Number(process.env.REQUESTED_HOCKEY_TARGET_ATTEMPTS || 4));
const TARGET_RETRY_MS = Math.max(2000, Number(process.env.REQUESTED_HOCKEY_TARGET_RETRY_MS || 15000));

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath = resolve(ROOT, "output/summary.json");
const plansDir = resolve(ROOT, "output/plans");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(plansDir) || !existsSync(sourcesDir)) {
  throw new Error(`Verified harvest bundle is incomplete under ${ROOT}`);
}

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Production Supabase credentials are required.");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" };
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));
const transientMessage = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b52[125]\b|\b544\b|fetch failed|network|aborted/i.test(String(message || ""));

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
if (Number(summary.targetCount) !== 122 || Number(summary.readyCount) !== 90 || Number(summary.validationFailedCount) !== 32 || Number(summary.failedCount) !== 0) {
  throw new Error(`Unexpected immutable harvest summary: ${JSON.stringify({ targetCount: summary.targetCount, readyCount: summary.readyCount, validationFailedCount: summary.validationFailedCount, failedCount: summary.failedCount })}`);
}

const requestedReady = (Array.isArray(summary.ready) ? summary.ready : [])
  .filter((row) => String(row?.release?.slug || "").endsWith("-hockey") || String(row?.exactSetKey || "").startsWith("hockey|"))
  .sort((a, b) => Number(a?.counts?.identities || 0) - Number(b?.counts?.identities || 0));
const requestedValidationFailures = (Array.isArray(summary.validationFailed) ? summary.validationFailed : [])
  .filter((row) => String(row?.release?.slug || "").endsWith("-hockey") || String(row?.exactSetKey || "").startsWith("hockey|"));
if (!requestedReady.length) throw new Error("Immutable harvest contains no validated requested Hockey catalogs.");

const sourceFiles = readdirSync(sourcesDir);
const results = [];
const receipt = {
  schema: "tcos.requestedHockeyWaveApply.v1",
  sourceHarvestRunId: Number(process.env.VERIFIED_SOURCE_RUN_ID || 0) || null,
  requestedScope: "Hockey 2021-22 through latest release; WNBA excluded because 2024/2025 are already complete",
  immutableHarvest: {
    targetCount: Number(summary.targetCount),
    readyCount: Number(summary.readyCount),
    validationFailedCount: Number(summary.validationFailedCount),
    failedCount: Number(summary.failedCount),
    requestedHockeyReadyCount: requestedReady.length,
    requestedHockeyValidationFailedCount: requestedValidationFailures.length,
  },
  wave: { size: WAVE_SIZE, delayMs: WAVE_DELAY_MS },
  preflight: { checked: 0, alreadyLive: 0, missing: 0, failed: 0 },
  apply: { attempted: 0, persisted: 0, failed: 0 },
  results,
};

function saveReceipt() {
  receipt.updatedAt = new Date().toISOString();
  receipt.preflight.checked = results.filter((row) => row.preflightStatus).length;
  receipt.preflight.alreadyLive = results.filter((row) => row.preflightStatus === "already_live").length;
  receipt.preflight.missing = results.filter((row) => row.preflightStatus === "missing").length;
  receipt.preflight.failed = results.filter((row) => row.preflightStatus === "failed").length;
  receipt.apply.attempted = results.filter((row) => row.applyStatus === "persisted" || row.applyStatus === "failed").length;
  receipt.apply.persisted = results.filter((row) => row.applyStatus === "persisted").length;
  receipt.apply.failed = results.filter((row) => row.applyStatus === "failed").length;
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function fetchJson(url, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= PREFLIGHT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : [];
      lastError = new Error(`${label} HTTP ${response.status}: ${text.slice(0, 300)}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    console.warn(`${label} attempt ${attempt}/${PREFLIGHT_ATTEMPTS} failed: ${lastError.message}`);
    if (attempt >= PREFLIGHT_ATTEMPTS || !transientMessage(lastError.message)) break;
    await sleep(Math.min(30000, PREFLIGHT_RETRY_MS * attempt));
  }
  throw lastError || new Error(`${label} failed without an error`);
}

async function preflightRelease(slug) {
  if (!slug || !slug.endsWith("-hockey")) throw new Error(`Refusing non-requested Hockey slug: ${slug || "missing"}`);
  const releaseUrl = new URL(`${supabaseUrl}/rest/v1/checklist_releases`);
  releaseUrl.searchParams.set("select", "id,slug");
  releaseUrl.searchParams.set("slug", `eq.${slug}`);
  releaseUrl.searchParams.set("limit", "1");
  const releases = await fetchJson(releaseUrl, `release preflight ${slug}`);
  if (!Array.isArray(releases) || !releases.length) return { complete: false, reason: "release_missing" };
  const releaseId = releases[0].id;
  const versionUrl = new URL(`${supabaseUrl}/rest/v1/checklist_versions`);
  versionUrl.searchParams.set("select", "id,status,is_active,normalized_card_count,normalized_identity_count");
  versionUrl.searchParams.set("release_id", `eq.${releaseId}`);
  versionUrl.searchParams.set("is_active", "eq.true");
  versionUrl.searchParams.set("status", "in.(live,revised)");
  versionUrl.searchParams.set("limit", "10");
  const versions = await fetchJson(versionUrl, `version preflight ${slug}`);
  const completeVersion = (Array.isArray(versions) ? versions : []).find((row) => Number(row.normalized_card_count || 0) > 0 && Number(row.normalized_identity_count || 0) > 0);
  if (!completeVersion) return { complete: false, reason: "no_complete_active_version", releaseId };
  return {
    complete: true,
    reason: "active_live_or_revised",
    releaseId,
    versionId: completeVersion.id,
    status: completeVersion.status,
    cards: Number(completeVersion.normalized_card_count || 0),
    identities: Number(completeVersion.normalized_identity_count || 0),
  };
}

async function persistWithRecovery(plan, sourceBytes, exactSetKey) {
  let lastError = null;
  for (let attempt = 1; attempt <= TARGET_ATTEMPTS; attempt += 1) {
    try {
      return await persistPlanStaged(db, plan, sourceBytes);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`${exactSetKey} write attempt ${attempt}/${TARGET_ATTEMPTS} failed: ${lastError.message}`);
      if (attempt >= TARGET_ATTEMPTS || !transientMessage(lastError.message)) break;
      await sleep(Math.min(60000, TARGET_RETRY_MS * attempt));
      try {
        const recheck = await preflightRelease(plan.release.slug);
        if (recheck.complete) return { recoveredByPreflight: true, ...recheck };
      } catch (preflightError) {
        console.warn(`${exactSetKey} recovery preflight failed: ${preflightError instanceof Error ? preflightError.message : String(preflightError)}`);
      }
    }
  }
  throw lastError || new Error(`Unknown persistence failure for ${exactSetKey}`);
}

console.log(`Preflighting ${requestedReady.length} validated requested Hockey catalogs; no writes occur during this phase.`);
const missingTargets = [];
for (let index = 0; index < requestedReady.length; index += 1) {
  const target = requestedReady[index];
  const exactSetKey = target.exactSetKey;
  const planPath = resolve(plansDir, `${safeSlug(exactSetKey)}.json`);
  const row = { exactSetKey, sourceCounts: target.counts || null };
  results.push(row);
  try {
    if (!existsSync(planPath)) throw new Error(`Missing plan artifact ${basename(planPath)}`);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    if (plan?.validation?.status !== "passed") throw new Error(`Plan validation status is ${plan?.validation?.status || "missing"}`);
    const releaseSlug = String(plan?.release?.slug || "");
    if (!releaseSlug.endsWith("-hockey")) throw new Error(`Refusing plan outside requested Hockey scope: ${releaseSlug || exactSetKey}`);
    row.releaseSlug = releaseSlug;
    const state = await preflightRelease(releaseSlug);
    row.preflight = state;
    if (state.complete) {
      row.preflightStatus = "already_live";
      row.applyStatus = "skipped_already_live";
      console.log(`[${index + 1}/${requestedReady.length}] LIVE ${releaseSlug} cards=${state.cards} identities=${state.identities}`);
    } else {
      row.preflightStatus = "missing";
      missingTargets.push({ target, plan, planPath, row });
      console.log(`[${index + 1}/${requestedReady.length}] MISSING ${releaseSlug} (${state.reason})`);
    }
  } catch (error) {
    row.preflightStatus = "failed";
    row.applyStatus = "blocked_preflight";
    row.error = error instanceof Error ? error.message : String(error);
    console.error(`[${index + 1}/${requestedReady.length}] BLOCKED ${exactSetKey}: ${row.error}`);
  }
  saveReceipt();
}

console.log(`Preflight complete: ${receipt.preflight.alreadyLive} already live, ${receipt.preflight.missing} missing, ${receipt.preflight.failed} blocked.`);
const waves = chunks(missingTargets, WAVE_SIZE);
for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
  const wave = waves[waveIndex];
  console.log(`=== REQUESTED HOCKEY WAVE ${waveIndex + 1}/${waves.length}: ${wave.length} catalogs ===`);
  await Promise.all(wave.map(async ({ target, plan, row }) => {
    const exactSetKey = target.exactSetKey;
    try {
      const slug = safeSlug(exactSetKey);
      const sourcePrefix = `${slug}__`;
      const sourceName = sourceFiles.find((name) => name.startsWith(sourcePrefix));
      if (!sourceName) throw new Error(`Missing source artifact prefix ${sourcePrefix}`);
      const sourceBytes = readFileSync(resolve(sourcesDir, sourceName));
      const expectedSize = Number(plan?.source?.storage?.sizeBytes || 0);
      if (expectedSize && sourceBytes.byteLength !== expectedSize) throw new Error(`Source byte mismatch ${sourceBytes.byteLength} != ${expectedSize}`);
      const finalGuard = await preflightRelease(plan.release.slug);
      if (finalGuard.complete) {
        row.applyStatus = "skipped_became_live";
        row.finalGuard = finalGuard;
        console.log(`SKIP ${plan.release.slug}: became live before write.`);
        return;
      }
      const transaction = await persistWithRecovery(plan, sourceBytes, exactSetKey);
      row.applyStatus = "persisted";
      row.transaction = transaction;
      row.persistedCounts = plan.validation.counts;
      console.log(`PERSISTED ${plan.release.slug} ${JSON.stringify(plan.validation.counts)}`);
    } catch (error) {
      row.applyStatus = "failed";
      row.error = error instanceof Error ? error.message : String(error);
      console.error(`FAILED ${plan?.release?.slug || exactSetKey}: ${row.error}`);
    }
  }));
  saveReceipt();
  const persistedThisWave = wave.filter(({ row }) => row.applyStatus === "persisted").length;
  const failedThisWave = wave.filter(({ row }) => row.applyStatus === "failed").length;
  console.log(`Wave ${waveIndex + 1} complete: persisted=${persistedThisWave}, failed=${failedThisWave}.`);
  if (waveIndex < waves.length - 1 && WAVE_DELAY_MS) {
    console.log(`Wave gap: ${WAVE_DELAY_MS}ms before next group of up to ${WAVE_SIZE}.`);
    await sleep(WAVE_DELAY_MS);
  }
}

saveReceipt();
console.log(JSON.stringify({
  requestedHockeyReadyCount: receipt.immutableHarvest.requestedHockeyReadyCount,
  requestedHockeyValidationFailedCount: receipt.immutableHarvest.requestedHockeyValidationFailedCount,
  alreadyLive: receipt.preflight.alreadyLive,
  missingValidated: receipt.preflight.missing,
  preflightFailed: receipt.preflight.failed,
  persisted: receipt.apply.persisted,
  applyFailed: receipt.apply.failed,
}, null, 2));
if (receipt.preflight.failed || receipt.apply.failed) process.exitCode = 2;
