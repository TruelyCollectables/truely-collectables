import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { dbClient } from "./mainstream-checklist/registry-tools.mjs";
import { persistPlanStaged } from "./mainstream-checklist/staged-registry-writer.mjs";

const ROOT = resolve(process.env.COORDINATE_HARVEST_ROOT || "");
const OUTPUT = resolve(process.env.COORDINATE_APPLY_RECEIPT || `${ROOT}/production-staged-apply-receipt.json`);
const MAX_SETS = Math.max(1, Number(process.env.COORDINATE_APPLY_MAX_SETS || 250));
if (!ROOT || !existsSync(ROOT)) throw new Error(`Exhaustive harvest root is missing: ${ROOT}`);

const summaryPath = resolve(ROOT, "output/summary.json");
const plansDir = resolve(ROOT, "output/plans");
const sourcesDir = resolve(ROOT, "output/sources");
if (!existsSync(summaryPath) || !existsSync(plansDir) || !existsSync(sourcesDir)) {
  throw new Error(`Exhaustive harvest bundle is incomplete under ${ROOT}`);
}

const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const knownPersisted = new Set(["basketball|2025|panini|one-and-one-wnba"]);
const ready = (Array.isArray(summary.ready) ? summary.ready : [])
  .filter((row) => !knownPersisted.has(row.exactSetKey))
  .sort((a, b) => Number(a?.counts?.identities || 0) - Number(b?.counts?.identities || 0))
  .slice(0, MAX_SETS);
if (!ready.length) throw new Error("Exhaustive harvest bundle has no remaining ready targets.");

const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";
const sourceFiles = readdirSync(sourcesDir);
const db = dbClient();

async function proveDatabase() {
  const maxAttempts = Math.max(1, Number(process.env.COORDINATE_DB_HEALTH_ATTEMPTS || 12));
  const delayMs = Math.max(1_000, Number(process.env.COORDINATE_DB_HEALTH_DELAY_MS || 5_000));
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

  console.log(`=== STAGED PRODUCTION APPLY ${index + 1}/${ready.length}: ${exactSetKey} ===`);
  try {
    const transaction = await persistPlanStaged(db, plan, sourceBytes);
    const row = { exactSetKey, status: "persisted", counts: plan.validation.counts, transaction, source: plan.source.storage };
    results.push(row);
    console.log(JSON.stringify({ exactSetKey, status: row.status, counts: row.counts, transactionCounts: transaction?.counts }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ exactSetKey, status: "failed", counts: plan.validation.counts, error: message });
    console.error(JSON.stringify({ exactSetKey, status: "failed", error: message }));
    if (/too many connections|connection terminated|connection timed out|could not query the database|web server is down|ssl handshake|\b52[125]\b|\b544\b/i.test(message)) break;
  }
}

const persisted = results.filter((row) => row.status === "persisted");
const receipt = {
  schema: "tcos.checklist.exhaustiveStagedProductionApply.v1",
  sourceHarvestRunId: Number(process.env.COORDINATE_SOURCE_RUN_ID || 0) || null,
  health,
  summaryCounts: {
    targetCount: summary.targetCount,
    readyCount: summary.readyCount,
    validationFailedCount: summary.validationFailedCount,
    failedCount: summary.failedCount,
    totalCards: summary.totalCards,
    totalParallels: summary.totalParallels,
    totalIdentities: summary.totalIdentities,
  },
  requestedCount: ready.length,
  attemptedCount: results.length,
  persistedCount: persisted.length,
  persistedCards: persisted.reduce((sum, row) => sum + Number(row.counts?.cards || 0), 0),
  persistedParallels: persisted.reduce((sum, row) => sum + Number(row.counts?.parallels || 0), 0),
  persistedIdentities: persisted.reduce((sum, row) => sum + Number(row.counts?.identities || 0), 0),
  knownPersisted: [...knownPersisted],
  results,
};
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ persistedCount: receipt.persistedCount, attemptedCount: receipt.attemptedCount, persistedCards: receipt.persistedCards, persistedParallels: receipt.persistedParallels, persistedIdentities: receipt.persistedIdentities }, null, 2));
if (!persisted.length) process.exitCode = 2;
