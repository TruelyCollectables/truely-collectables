import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { managementQuery, persistPlanManagement } from "./management-staged-registry-writer.mjs";

const HARVEST_ROOT = resolve(process.env.VERIFIED_HARVEST_ROOT || "");
const EASY_PLAN_DIR = resolve(process.env.EASY_CERTIFIED_PLAN_DIR || "");
const HARD_PLAN_DIR = resolve(process.env.HARD_CERTIFIED_PLAN_DIR || "");
const OUTPUT = resolve(process.env.CERTIFIED_PDF_MANAGEMENT_RECEIPT || `${HARVEST_ROOT}/certified-pdf-management-receipt.json`);
const WAVE_SIZE = Math.max(1, Number(process.env.CERTIFIED_PDF_MANAGEMENT_WAVE_SIZE || 1));
const WAVE_DELAY_MS = Math.max(0, Number(process.env.CERTIFIED_PDF_MANAGEMENT_WAVE_DELAY_MS || 15000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunks = (values, size) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, i * size + size));
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";

const EXACT_KEYS = [
  "hockey|2021-22|topps|sticker-collection-nhl",
  "hockey|2022-23|upper-deck|o-pee-chee-nhl",
  "hockey|2022|leaf|art-of",
  "hockey|2021-22|upper-deck|the-cup-nhl",
  "hockey|2022-23|upper-deck|premier-nhl",
  "hockey|2023-24|upper-deck|skybox-metal-universe-nhl",
  "hockey|2024-25|upper-deck|series-two-nhl",
  "hockey|2024-25|upper-deck|sp-authentic-nhl",
];

for (const [label, path] of [["harvest", HARVEST_ROOT], ["easy plans", EASY_PLAN_DIR], ["hard plans", HARD_PLAN_DIR]]) {
  if (!path || !existsSync(path)) throw new Error(`${label} path missing: ${path}`);
}
const sourcesDir = resolve(HARVEST_ROOT, "output/sources");
if (!existsSync(sourcesDir)) throw new Error(`Immutable source directory missing: ${sourcesDir}`);
const sourceFiles = readdirSync(sourcesDir);

const planDirs = [EASY_PLAN_DIR, HARD_PLAN_DIR];
const tasks = [];
for (const exactSetKey of EXACT_KEYS) {
  const filename = `${safeSlug(exactSetKey)}.json`;
  const planPath = planDirs.map((dir) => resolve(dir, filename)).find((path) => existsSync(path));
  if (!planPath) throw new Error(`Certified plan missing for ${exactSetKey}: ${filename}`);
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (plan?.validation?.status !== "passed") throw new Error(`Plan ${exactSetKey} is not validation-passed.`);
  if (!String(plan?.release?.releaseSlug || "").endsWith("-hockey")) throw new Error(`Refusing non-Hockey plan ${exactSetKey}.`);
  tasks.push({ exactSetKey, plan, planPath });
}
tasks.sort((a, b) => Number(a.plan.validation.counts?.identities || 0) - Number(b.plan.validation.counts?.identities || 0));

const receipt = { schema: "tcos.certifiedPdfManagementApply.v1", targetCount: tasks.length, transport: "supabase_management_database_query", wave: { size: WAVE_SIZE, delayMs: WAVE_DELAY_MS }, results: [] };
function save() {
  receipt.updatedAt = new Date().toISOString();
  receipt.alreadyLiveCount = receipt.results.filter((r) => r.status === "already_live").length;
  receipt.persistedCount = receipt.results.filter((r) => r.status === "persisted").length;
  receipt.failedCount = receipt.results.filter((r) => r.status === "failed").length;
  receipt.persistedCards = receipt.results.filter((r) => r.status === "persisted").reduce((s, r) => s + Number(r.counts?.cards || 0), 0);
  receipt.persistedIdentities = receipt.results.filter((r) => r.status === "persisted").reduce((s, r) => s + Number(r.counts?.identities || 0), 0);
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
}

const slugList = tasks.map(({ plan }) => `'${String(plan.release.releaseSlug).replace(/'/g, "''")}'`).join(",");
const liveRows = await managementQuery(`
select r.slug, v.id as "versionId", v.status, v.normalized_card_count as cards, v.normalized_identity_count as identities
from public.checklist_releases r
join lateral (
  select id,status,normalized_card_count,normalized_identity_count,version_number
  from public.checklist_versions
  where release_id=r.id and is_active=true and status in ('live','revised')
    and coalesce(normalized_card_count,0)>0 and coalesce(normalized_identity_count,0)>0
  order by version_number desc limit 1
) v on true
where r.slug in (${slugList});`, "batch certified PDF management preflight");
const liveBySlug = new Map((Array.isArray(liveRows) ? liveRows : []).map((row) => [String(row.slug), row]));
const missing = [];
for (const task of tasks) {
  const counts = task.plan.validation.counts;
  const row = { exactSetKey: task.exactSetKey, releaseSlug: task.plan.release.releaseSlug, counts };
  receipt.results.push(row);
  const live = liveBySlug.get(task.plan.release.releaseSlug);
  if (live) {
    row.status = "already_live";
    row.live = live;
  } else {
    row.status = "pending";
    missing.push({ ...task, row });
  }
}
save();
console.log(`Certified PDF batch preflight: alreadyLive=${receipt.alreadyLiveCount}, missing=${missing.length}. Import order: ${missing.map((x) => `${x.exactSetKey}(${x.plan.validation.counts?.identities || 0})`).join(", ")}`);

const waves = chunks(missing, WAVE_SIZE);
for (let waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
  const wave = waves[waveIndex];
  console.log(`=== CERTIFIED PDF MANAGEMENT WAVE ${waveIndex + 1}/${waves.length} ===`);
  await Promise.all(wave.map(async ({ exactSetKey, plan, row }) => {
    try {
      const prefix = `${safeSlug(exactSetKey)}__`;
      const original = String(plan?.source?.storage?.originalFilename || "").toLowerCase();
      const sourceName = sourceFiles.find((name) => name.startsWith(prefix) && (!original || name.slice(name.indexOf("__") + 2).toLowerCase() === original)) || sourceFiles.find((name) => name.startsWith(prefix));
      if (!sourceName) throw new Error(`Immutable source missing for ${exactSetKey}`);
      const bytes = readFileSync(resolve(sourcesDir, sourceName));
      const expectedSize = Number(plan?.source?.storage?.sizeBytes || 0);
      if (expectedSize && bytes.byteLength !== expectedSize) throw new Error(`Source byte mismatch ${bytes.byteLength} != ${expectedSize}`);
      row.transaction = await persistPlanManagement(plan, bytes);
      row.status = "persisted";
      console.log(`PERSISTED ${exactSetKey} ${JSON.stringify(plan.validation.counts)}`);
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
      console.error(`FAILED ${exactSetKey}: ${row.error}`);
    } finally {
      save();
    }
  }));
  save();
  if (waveIndex < waves.length - 1 && WAVE_DELAY_MS) await sleep(WAVE_DELAY_MS);
}
save();
console.log(JSON.stringify({ targetCount: receipt.targetCount, alreadyLiveCount: receipt.alreadyLiveCount, persistedCount: receipt.persistedCount, failedCount: receipt.failedCount, persistedCards: receipt.persistedCards, persistedIdentities: receipt.persistedIdentities }, null, 2));
if (receipt.failedCount) process.exitCode = 2;
