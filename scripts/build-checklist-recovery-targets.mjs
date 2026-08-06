import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CONFIG_PATH = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_CONFIG || "data/checklist-recovery-targets.json");
const BASE_ROOT = resolve(process.cwd(), process.env.CHECKLIST_BASE_CATALOG_ROOT || ".card-checklist-master-archive");
const OUT = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_TARGETS_OUTPUT || ".checklist-recovery-state/targets.json");
const SPORTS = new Set(["baseball", "basketball", "football", "hockey", "soccer", "racing", "wrestling", "mma", "boxing", "golf", "tennis", "multi-sport"]);

function slug(value) {
  return String(value || "").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}
function seasonStart(value) {
  const match = String(value || "").match(/\b((?:18|19|20)\d{2})\b/);
  return match ? Number(match[1]) : null;
}
function targetFromSet(row, scope, priority) {
  const exactSetKey = row.exactSetKey || [row.universe || row.sport, row.season, row.manufacturer, row.product].map(slug).join("|");
  return {
    id: createHash("sha256").update(exactSetKey).digest("hex").slice(0, 16),
    sport: row.sport || row.universe,
    year: seasonStart(row.season),
    season: row.season,
    manufacturer: row.manufacturer,
    product: row.product,
    exactSetKey,
    scope,
    priority,
    knownLeadUrl: "",
    knownLeadName: "",
  };
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
if (config.serviceName !== "InstaComp AI Checklist Sentinel™") {
  throw new Error("Checklist Sentinel configuration has the wrong serviceName.");
}
const masterSets = JSON.parse(readFileSync(resolve(BASE_ROOT, "master-sets.json"), "utf8"));
const setMap = new Map(masterSets.map((row) => [row.exactSetKey, row]));
const modernKeys = readFileSync(resolve(process.cwd(), config.modernGapKeysFile), "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const targets = [];
const missingModernKeys = [];
for (const key of modernKeys) {
  const row = setMap.get(key);
  if (!row) { missingModernKeys.push(key); continue; }
  targets.push(targetFromSet(row, "mainstream-2000-plus-gap", "P1 — Mainstream gap"));
}
for (const row of masterSets) {
  const year = seasonStart(row.season);
  const sport = slug(row.sport || row.universe);
  if (year == null || year >= 2000 || !SPORTS.has(sport)) continue;
  if (Number(row.checklistRowsMaximum || 0) > 0) continue;
  targets.push(targetFromSet(row, "pre-2000-gap", "P1 — Vintage gap"));
}
const deduped = [...new Map(targets.map((target) => [target.exactSetKey, target])).values()].sort((a, b) =>
  a.year - b.year || a.sport.localeCompare(b.sport) || a.manufacturer.localeCompare(b.manufacturer) || a.product.localeCompare(b.product),
);
const output = {
  schema: "instacomp.aiChecklistSentinelTargets.v1",
  serviceName: config.serviceName,
  generatedAt: new Date().toISOString(),
  sourceRunId: config.sourceRunId,
  schedule: config.schedule,
  searchRegistry: config.searchRegistry,
  policy: config.policy,
  totals: {
    targets: deduped.length,
    mainstream2000Plus: deduped.filter((row) => row.scope === "mainstream-2000-plus-gap").length,
    pre2000: deduped.filter((row) => row.scope === "pre-2000-gap").length,
    missingModernKeys: missingModernKeys.length,
  },
  missingModernKeys,
  targets: deduped,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ serviceName: output.serviceName, ...output.totals }));
if (missingModernKeys.length) throw new Error(`Modern gap keys missing from base catalog: ${missingModernKeys.length}`);
if (!deduped.length) throw new Error("No recovery targets were generated.");
