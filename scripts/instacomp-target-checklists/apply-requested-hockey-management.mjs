import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { managementQuery, persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

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
  schema: "tcos.requestedHockeyManagementApply.v2",
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
        console.warn(`${exactSetKey} recovery preflight failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
      }
    }
  }
  throw last || new Error(`Unknown persistence failure for ${exactSetKey}`);
}

const prepared = [];
for (const target of requestedReady) {
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
    prepared.push({ target, plan, row });
  } catch (error) {
    row.preflightStatus = "failed";
    row.status = "failed";
    row.error = error instanceof Error ? error.message : String(error);
  }
}
save();

const slugList = prepared.map(({ plan }) => `'${plan.release.releaseSlug.replace(/'/g, "''")}'`).join(",");
const batchSql = `
select r.slug,
       v.id as "versionId",
       v.status,
       v.normalized_card_count as cards,
       v.normalized_identity_count as identities
from public.checklist_releases r
join lateral (
  select id,status,normalized_card_count,normalized_identity_count,version_number
  from public.checklist_versions
  where release_id=r.id
    and is_active=true
    and status in ('live','revised')
    and coalesce(normalized_card_count,0)>0
    and coalesce(normalized_identity_count,0)>0
  order by version_number desc
  limit 1
) v on true
where r.slug in (${slugList});`;
console.log(`Batch-preflighting ${prepared.length} validated Hockey catalogs in one management SQL query.`);
const liveRows = await managementQuery(batchSql, "batch Hockey management preflight");
const liveBySlug = new Map((Array.isArray(liveRows) ? liveRows : []).map((row) => [String(row.slug), row]));
const missing = [];
for (const item of prepared) {
  const live = liveBySlug.get(item.plan.release.releaseSlug);
  if (live) {
    item.row.preflightStatus = "already_live";
    item.row.status = "already_live";
    item.row.preflight = { complete: true, ...live };
  } else {
    item.row.preflightStatus = "missing";
    missing.push(item);
  }
}
save();
console.log(`Batch preflight complete: live=${receipt.alreadyLiveCount}, missing=${missing.length}, failed=${receipt.failedCount}.`);

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
  console.log(`Wave ${waveIndex + 1} complete. persisted=${wave.filter(({ row }) => row.status === "persisted").length} failed=${wave.filter(({ row }) => row.status === "failed").length}`);
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
