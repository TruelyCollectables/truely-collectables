import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.REQUESTED_HOCKEY_RESIDUAL_RECEIPT || `${ROOT}/requested-hockey-residual-receipt.json`);
const WAVE_SIZE = Math.max(1, Number(process.env.REQUESTED_HOCKEY_WAVE_SIZE || 2));
const WAVE_DELAY_MS = Math.max(0, Number(process.env.REQUESTED_HOCKEY_WAVE_DELAY_MS || 5000));
const TARGET_ATTEMPTS = Math.max(1, Number(process.env.REQUESTED_HOCKEY_TARGET_ATTEMPTS || 4));
const TARGET_RETRY_MS = Math.max(2000, Number(process.env.REQUESTED_HOCKEY_TARGET_RETRY_MS || 10000));
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, index * size + size));
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const transient = (message) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b50[0234]\b|\b52[125]\b|\b544\b|fetch failed|network|aborted|temporar/i.test(String(message || ""));

const RESIDUAL_KEYS = [
  "hockey|2021-22|upper-deck|skybox-metal-universe-nhl",
  "hockey|2022-23|upper-deck|synergy-nhl",
  "hockey|2025-26|upper-deck|new-york-rangers-centennial",
  "hockey|2023-24|upper-deck|synergy-nhl",
  "hockey|2024-25|upper-deck|the-cup-nhl",
  "hockey|2024-25|upper-deck|ultimate-collection-nhl",
  "hockey|2022-23|upper-deck|ultimate-collection-nhl",
  "hockey|2024-25|upper-deck|premier-nhl",
  "hockey|2023-24|upper-deck|engrained-nhl",
  "hockey|2022-23|upper-deck|spx-nhl",
  "hockey|2023-24|upper-deck|spx-nhl",
  "hockey|2024-25|upper-deck|spx-nhl",
  "hockey|2024-25|upper-deck|credentials-nhl",
  "hockey|2023-24|upper-deck|premier-nhl",
  "hockey|2022-23|upper-deck|trilogy-nhl",
  "hockey|2025-26|upper-deck|sp-game-used-nhl",
  "hockey|2024-25|upper-deck|artifacts-nhl",
  "hockey|2021-22|upper-deck|o-pee-chee-platinum-nhl",
  "hockey|2025-26|upper-deck|allure-nhl",
  "hockey|2024-25|upper-deck|o-pee-chee-platinum-nhl",
  "hockey|2023-24|upper-deck|o-pee-chee-platinum-nhl",
  "hockey|2023-24|upper-deck|artifacts-nhl",
  "hockey|2022-23|upper-deck|o-pee-chee-platinum-nhl"
];

if (!ROOT || !existsSync(ROOT)) throw new Error(`Verified harvest root is missing: ${ROOT}`);
const summaryPath = resolve(ROOT, "output/summary.json");
const plansDir = resolve(ROOT, "output/plans");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(plansDir) || !existsSync(sourcesDir)) throw new Error("Verified harvest bundle is incomplete.");
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const readyByKey = new Map((Array.isArray(summary.ready) ? summary.ready : []).map((row) => [String(row?.exactSetKey || ""), row]));
for (const key of RESIDUAL_KEYS) if (!readyByKey.has(key)) throw new Error(`Residual key is not validated-ready in immutable harvest: ${key}`);
if (RESIDUAL_KEYS.length !== 23 || new Set(RESIDUAL_KEYS).size !== 23) throw new Error("Residual key census must contain exactly 23 unique catalogs.");

const sourceFiles = readdirSync(sourcesDir);
const receipt = {
  schema: "tcos.requestedHockeyResidualApply.v1",
  sourceHarvestRunId: Number(process.env.VERIFIED_SOURCE_RUN_ID || 0) || null,
  transport: "supabase_management_database_query_individual_preflight",
  residualCount: RESIDUAL_KEYS.length,
  wave: { size: WAVE_SIZE, delayMs: WAVE_DELAY_MS },
  results: [],
};
function save() {
  receipt.updatedAt = new Date().toISOString();
  receipt.alreadyLiveCount = receipt.results.filter((row) => row.status === "already_live").length;
  receipt.persistedCount = receipt.results.filter((row) => row.status === "persisted").length;
  receipt.failedCount = receipt.results.filter((row) => row.status === "failed").length;
  receipt.resolvedCount = receipt.alreadyLiveCount + receipt.persistedCount;
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
      console.warn(`${exactSetKey} persistence attempt ${attempt}/${TARGET_ATTEMPTS} failed: ${last.message}`);
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

const prepared = RESIDUAL_KEYS.map((exactSetKey) => {
  const target = readyByKey.get(exactSetKey);
  const planPath = resolve(plansDir, `${safeSlug(exactSetKey)}.json`);
  if (!existsSync(planPath)) throw new Error(`Missing plan ${planPath}`);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (plan?.validation?.status !== "passed") throw new Error(`${exactSetKey}: plan validation is ${plan?.validation?.status || "missing"}`);
  const releaseSlug = String(plan?.release?.releaseSlug || "");
  if (!releaseSlug.endsWith("-hockey")) throw new Error(`Refusing non-Hockey release ${releaseSlug || exactSetKey}`);
  const prefix = `${safeSlug(exactSetKey)}__`;
  const sourceName = sourceFiles.find((name) => name.startsWith(prefix));
  if (!sourceName) throw new Error(`Missing immutable source prefix ${prefix}`);
  return { exactSetKey, target, plan, sourceName };
});

const waves = chunks(prepared, WAVE_SIZE);
for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
  const wave = waves[waveIndex];
  console.log(`=== RESIDUAL HOCKEY WAVE ${waveIndex + 1}/${waves.length}: ${wave.length} catalogs ===`);
  await Promise.all(wave.map(async ({ exactSetKey, target, plan, sourceName }) => {
    const row = { exactSetKey, releaseSlug: plan.release.releaseSlug, counts: plan.validation.counts, sourceCounts: target.counts || null };
    receipt.results.push(row);
    try {
      const before = await preflightReleaseManagement(plan.release.releaseSlug);
      row.preflight = before;
      if (before.complete) {
        row.status = "already_live";
        console.log(`ALREADY LIVE ${plan.release.releaseSlug}`);
        return;
      }
      const bytes = readFileSync(resolve(sourcesDir, sourceName));
      const expectedSize = Number(plan?.source?.storage?.sizeBytes || 0);
      if (expectedSize && bytes.byteLength !== expectedSize) throw new Error(`Source byte mismatch ${bytes.byteLength} != ${expectedSize}`);
      row.transaction = await persistWithRetry(plan, bytes, exactSetKey);
      const after = await preflightReleaseManagement(plan.release.releaseSlug);
      row.postflight = after;
      if (!after.complete) throw new Error(`Postflight still incomplete for ${plan.release.releaseSlug}`);
      row.status = "persisted";
      console.log(`PERSISTED ${plan.release.releaseSlug} ${JSON.stringify(plan.validation.counts)}`);
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
      console.error(`FAILED ${plan.release.releaseSlug}: ${row.error}`);
    } finally {
      save();
    }
  }));
  save();
  if (waveIndex < waves.length - 1 && WAVE_DELAY_MS) await sleep(WAVE_DELAY_MS);
}

save();
console.log(JSON.stringify({ residualCount: receipt.residualCount, alreadyLiveCount: receipt.alreadyLiveCount, persistedCount: receipt.persistedCount, resolvedCount: receipt.resolvedCount, failedCount: receipt.failedCount }, null, 2));
if (receipt.failedCount || receipt.resolvedCount !== 23) process.exitCode = 2;
