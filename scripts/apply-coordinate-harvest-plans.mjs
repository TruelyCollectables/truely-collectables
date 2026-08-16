import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { dbClient, persistPlan } from "./mainstream-checklist/registry-tools.mjs";

const ROOT = resolve(process.env.COORDINATE_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.COORDINATE_APPLY_RECEIPT || `${ROOT}/production-apply-receipt.json`);
const MAX_SETS = Math.max(1, Number(process.env.COORDINATE_APPLY_MAX_SETS || 100));
if (!ROOT || !existsSync(ROOT)) throw new Error(`Coordinate harvest root is missing: ${ROOT}`);

const summaryPath = resolve(ROOT, "output/summary.json");
const plansDir = resolve(ROOT, "output/plans");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(plansDir) || !existsSync(sourcesDir)) {
  throw new Error(`Coordinate harvest bundle is incomplete under ${ROOT}`);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const ready = Array.isArray(summary.ready) ? summary.ready.slice(0, MAX_SETS) : [];
if (!ready.length) throw new Error("Coordinate harvest bundle has no ready targets.");

const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const sourceFiles = readdirSync(sourcesDir);
const db = dbClient();

async function proveDatabase() {
  const maxAttempts = Math.max(1, Number(process.env.COORDINATE_DB_HEALTH_ATTEMPTS || 10));
  const delayMs = Math.max(1_000, Number(process.env.COORDINATE_DB_HEALTH_DELAY_MS || 20_000));
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      const { data, error } = await db.from("checklist_releases").select("id").limit(1);
      if (!error) {
        console.log(`Database health check passed on attempt ${attempt} in ${Date.now() - started}ms.`);
        return { attempt, sampleRows: Array.isArray(data) ? data.length : null };
      }
      last = error;
      console.warn(`Database health attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
    } catch (error) {
      last = error;
      console.warn(`Database health attempt ${attempt}/${maxAttempts} threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (attempt < maxAttempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
  throw new Error(`Production database never became healthy: ${last instanceof Error ? last.message : String(last?.message || last || "unknown")}`);
}

const health = await proveDatabase();
const results = [];
for (let index = 0; index < ready.length; index += 1) {
  const target = ready[index];
  const exactSetKey = target.exactSetKey;
  const slug = safeSlug(exactSetKey);
  const planPath = resolve(plansDir, `${slug}.json`);
  if (!existsSync(planPath)) {
    results.push({ exactSetKey, status: "failed", error: `Missing plan artifact ${basename(planPath)}` });
    continue;
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (plan?.validation?.status !== "passed") {
    results.push({ exactSetKey, status: "blocked", error: `Plan validation status is ${plan?.validation?.status || "missing"}` });
    continue;
  }
  const sourcePrefix = `${slug}__`;
  const sourceName = sourceFiles.find((name) => name.startsWith(sourcePrefix));
  if (!sourceName) {
    results.push({ exactSetKey, status: "failed", error: `Missing source artifact prefix ${sourcePrefix}` });
    continue;
  }
  const sourceBytes = readFileSync(resolve(sourcesDir, sourceName));
  const expectedSize = Number(plan?.source?.storage?.sizeBytes || 0);
  if (expectedSize && sourceBytes.byteLength !== expectedSize) {
    results.push({ exactSetKey, status: "failed", error: `Source byte mismatch ${sourceBytes.byteLength} != ${expectedSize}` });
    continue;
  }

  console.log(`=== PRODUCTION APPLY ${index + 1}/${ready.length}: ${exactSetKey} ===`);
  try {
    const transaction = await persistPlan(db, plan, sourceBytes);
    const row = {
      exactSetKey,
      status: "persisted",
      counts: plan.validation.counts,
      transaction,
      source: plan.source.storage,
    };
    results.push(row);
    console.log(JSON.stringify({ exactSetKey, status: row.status, counts: row.counts }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ exactSetKey, status: "failed", counts: plan.validation.counts, error: message });
    console.error(JSON.stringify({ exactSetKey, status: "failed", error: message }));
    if (/connection|timeout|too many connections|522|544/i.test(message)) break;
  }
}

const persisted = results.filter((row) => row.status === "persisted");
const failed = results.filter((row) => row.status !== "persisted");
const receipt = {
  schema: "tcos.checklist.coordinateProductionApply.v1",
  sourceHarvestRunId: Number(process.env.COORDINATE_SOURCE_RUN_ID || 0) || null,
  health,
  requestedCount: ready.length,
  attemptedCount: results.length,
  persistedCount: persisted.length,
  persistedCards: persisted.reduce((sum, row) => sum + Number(row.counts?.cards || 0), 0),
  persistedParallels: persisted.reduce((sum, row) => sum + Number(row.counts?.parallels || 0), 0),
  persistedIdentities: persisted.reduce((sum, row) => sum + Number(row.counts?.identities || 0), 0),
  results,
};
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ persistedCount: receipt.persistedCount, attemptedCount: receipt.attemptedCount, persistedCards: receipt.persistedCards, persistedParallels: receipt.persistedParallels, persistedIdentities: receipt.persistedIdentities }, null, 2));
if (!persisted.length || failed.length) process.exitCode = 2;
