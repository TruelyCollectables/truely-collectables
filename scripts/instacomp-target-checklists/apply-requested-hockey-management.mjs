import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.REQUESTED_HOCKEY_RECEIPT || `${ROOT}/requested-hockey-management-receipt.json`);
const WAVE_SIZE = Math.max(1, Number(process.env.REQUESTED_HOCKEY_WAVE_SIZE || 4));
const WAVE_DELAY_MS = Math.max(0, Number(process.env.REQUESTED_HOCKEY_WAVE_DELAY_MS || 15000));
const TARGET_ATTEMPTS = Math.max(1, Number(process.env.REQUESTED_HOCKEY_TARGET_ATTEMPTS || 4));
const TARGET_RETRY_MS = Math.max(2000, Number(process.env.REQUESTED_HOCKEY_TARGET_RETRY_MS || 15000));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const transient = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|fetch failed|network|aborted|temporar/i.test(String(message || ""));

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath = resolve(ROOT, "output/summary.json");
const plansDir = resolve(ROOT, "output/plans");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(plansDir) || !existsSync(sourcesDir)) throw new Error("Verified harvest bundle is incomplete.");

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
if (Number(summary.targetCount) !== 122 || Number(summary.readyCount) !== 90 || Number(summary.validationFailedCount) !== 32 || Number(summary.failedCount) !== 0) {
  throw new Error(`Unexpected immutable harvest summary: ${JSON.stringify({ targetCount: summary.targetCount, readyCount: summary.readyCount, validationFailedCount: summary.validationFailedCount, failedCount: summary.failedCount })}`);
}
const requestedReady = (Array.isArray(summary.ready) ? summary.ready : [])
  .filter((row) => String(row?.exactSetKey || "").startsWith("hockey|"))
  .sort((a, b) => Number(a?.counts?.identities || 0) - Number(b?.counts?.identities || 0));
if (!requestedReady.length) throw new Error("No validated requested Hockey catalogs found.");

const sourceFiles = readdirSync(sourcesDir);
const receipt = {
  schema: "tcos.requestedHockeyManagementApply.v1",
  sourceHarvestRunId: Number(process.env.VERIFIED_SOURCE_RUN_ID || 0) || null,
  transport: "supabase_management_database_query",
  requestedHockeyReadyCount: requestedReady.length,
  wave: { size: WAVE_SIZE, delayMs: WAVE_DELAY_MS },
  results: [],
};
function save() {
  receipt.updatedAt = new Date().toISOString();
  receipt.alreadyLiveCount = receipt.results.filter((row) => row.status === "already_live").length;
  receipt.missingCount = receipt.results.filter((row) => row.preflightStatus === "missing").length;
  receipt.persistedCount = receipt.results.filter((row) => row.status === "persisted").length;
  receipt.failedCount = receipt.results.filter((row) => row.status === "failed").length;
  receipt.persistedCards = receipt.results.filter((row) => row.status === "persisted").reduce((sum, row) => sum + Number(row.counts?.cards || 0), 0);
  receipt.persistedIdentities = receipt.results.filter((row) => row.status === "persisted").reduce((sum, row) => sum + Number(row.counts?.identities || 0), 0);
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function persistWithRetry(plan, bytes, exactSetKey) {
  let last = null;
  for (let attempt = 1; attempt <= TARGET_ATTEMPTS; attempt += 1) {
    try {
      return await persistPlanManagement(plan, bytes);
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      console.warn(`${exactSetKey} management persistence attempt ${attempt}/${TARGET_ATTEMPTS} failed: ${last.message}`);
      if (attempt >= TARGET_ATTEMPTS || !transient(last.message)) break;
      await sleep(Math.min(60_000, TARGET_RETRY_MS * attempt));
      try {
        const state = await preflightReleaseManagement(plan.release.releaseSlug);
        if (state.complete) return { recoveredByPreflight: true, ...state };
      } catch (checkError) {
        console.warn(`${exactSetKey} management recovery preflight failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
      }
    }
  }
  throw last || new Error(`Unknown persistence failure for ${exactSetKey}`);
}

const missing = [];
console.log(`Management-preflighting ${requestedReady.length} validated Hockey catalogs.`);
for (let index = 0; index < requestedReady.length; index += 1) {
  const target = requestedReady[index];
  const exactSetKey = target.exactSetKey;
  const row = { exactSetKey, sourceCounts: target.counts || null };
  receipt.results.push(row);
  try {
    const planPath = resolve(plansDir, `${safeSlug(exactSetKey)}.json`);
    if (!existsSync(planPath)) throw new Error(`Missing plan ${planPath}`);
    const plan = JSON.parse(readFileSync(planPath, "utf8"));
    if (plan?.validation?.status !== "passed") throw new Error(`Plan validation is ${plan?.validation?.status || "missing"}`);
    const releaseSlug = String(plan?.release?.releaseSlug || "");
    if (!releaseSlug.endsWith("-hockey")) throw new Error(`Refusing non-Hockey release ${releaseSlug || exactSetKey}`);
    row.releaseSlug = releaseSlug;
    row.counts = plan.validation.counts;
    const state = await preflightReleaseManagement(releaseSlug);
    row.preflight = state;
    if (state.complete) {
      row.preflightStatus = "already_live";
      row.status = "already_live";
      console.log(`[${index + 1}/${requestedReady.length}] LIVE ${releaseSlug}`);
    } else {
      row.preflightStatus = "missing";
      missing.push({ target, plan, row });
      console.log(`[${index + 1}/${requestedReady.length}] MISSING ${releaseSlug}`);
    }
  } catch (error) {
    row.preflightStatus = "failed";
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
    console.error(`[${index + 1}/${requestedReady.length}] BLOCKED ${exactSetKey}: ${row.error}`);
  }
  save();
}

console.log(`Management preflight complete: live=${receipt.alreadyLiveCount}, missing=${missing.length}, failed=${receipt.failedCount}.`);
const waves = chunks(missing, WAVE_SIZE);
for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
  const wave = waves[waveIndex];
  console.log(`=== MANAGEMENT HOCKEY WAVE ${waveIndex + 1}/${waves.length}: ${wave.length} catalogs ===`);
  await Promise.all(wave.map(async ({ target, plan, row }) => {
    try {
      const exactSetKey = target.exactSetKey;
      const prefix = `${safeSlug(exactSetKey)}__`;
      const sourceName = sourceFiles.find((name) => name.startsWith(prefix));
      if (!sourceName) throw new Error(`Missing immutable source prefix ${prefix}`);
      const bytes = readFileSync(resolve(sourcesDir, sourceName));
      const expectedSize = Number(plan?.source?.storage?.sizeBytes || 0);
      if (expectedSize && bytes.byteLength !== expectedSize) throw new Error(`Source byte mismatch ${bytes.byteLength} != ${expectedSize}`);
      const finalGuard = await preflightReleaseManagement(plan.release.releaseSlug);
      if (finalGuard.complete) {
        row.status = "already_live";
        row.finalGuard = finalGuard;
        return;
      }
      row.transaction = await persistWithRetry(plan, bytes, exactSetKey);
      row.status = "persisted";
      console.log(`PERSISTED ${plan.release.releaseSlug} ${JSON.stringify(plan.validation.counts)}`);
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
      console.error(`FAILED ${plan?.release?.releaseSlug || target.exactSetKey}: ${row.error}`);
    } finally {
      save();
    }
  }));
  save();
  if (waveIndex < waves.length - 1 && WAVE_DELAY_MS) await sleep(WAVE_DELAY_MS);
}

save();
console.log(JSON.stringify({
  requestedHockeyReadyCount: receipt.requestedHockeyReadyCount,
  alreadyLiveCount: receipt.alreadyLiveCount,
  missingCount: receipt.missingCount,
  persistedCount: receipt.persistedCount,
  failedCount: receipt.failedCount,
  persistedCards: receipt.persistedCards,
  persistedIdentities: receipt.persistedIdentities,
}, null, 2));
if (receipt.failedCount) process.exitCode = 2;
