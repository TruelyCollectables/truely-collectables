import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE_ROOT = resolve(process.cwd(), process.env.CHECKLIST_BASE_CATALOG_ROOT || ".card-checklist-master-archive");
const RECOVERY_ROOT = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_ORGANIZED_ROOT || ".checklist-recovery-organized");
const STATE_ROOT = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_STATE || ".checklist-recovery-state");
const TARGETS_PATH = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_TARGETS || "data/checklist-recovery-targets.json");
const OUT = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_MASTER_ROOT || ".card-checklist-recovery-master");

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
function json(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function sourceItemIdentity(row) {
  return [row.exactSetKey || "", row.source || "", row.id || "", row.sourceUrl || ""].join("|");
}

mkdirSync(OUT, { recursive: true });
const baseSets = json(resolve(BASE_ROOT, "master-sets.json"), []);
const baseItems = json(resolve(BASE_ROOT, "source-items.json"), []);
const recoverySets = json(resolve(RECOVERY_ROOT, "master-sets.json"), []);
const recoveryItems = json(resolve(RECOVERY_ROOT, "source-items.json"), []);
const progress = json(resolve(STATE_ROOT, "progress.json"), { totals: {} });
const targets = json(TARGETS_PATH, { targets: [] }).targets || [];

const setMap = new Map();
for (const row of baseSets) setMap.set(row.exactSetKey, structuredClone(row));
let newlyChecklistReady = 0;
let newSetIdentities = 0;
for (const row of recoverySets) {
  const key = row.exactSetKey;
  if (!key) continue;
  const existing = setMap.get(key);
  if (!existing) {
    setMap.set(key, structuredClone(row));
    newSetIdentities += 1;
    continue;
  }
  const beforeRows = Number(existing.checklistRowsMaximum || 0);
  existing.itemCount = Number(existing.itemCount || 0) + Number(row.itemCount || 0);
  existing.checklistRowsMaximum = Math.max(beforeRows, Number(row.checklistRowsMaximum || 0));
  existing.sources = [...new Set([...(existing.sources || []), ...(row.sources || [])])].sort();
  existing.sourceCount = existing.sources.length;
  const seenItems = new Set((existing.sourceItems || []).map((item) => `${item.source}|${item.id}|${item.sourceUrl || ""}`));
  for (const item of row.sourceItems || []) {
    const identity = `${item.source}|${item.id}|${item.sourceUrl || ""}`;
    if (!seenItems.has(identity)) {
      existing.sourceItems = [...(existing.sourceItems || []), item];
      seenItems.add(identity);
    }
  }
  if (beforeRows < 1 && existing.checklistRowsMaximum > 0) newlyChecklistReady += 1;
}

const sourceMap = new Map();
for (const row of [...baseItems, ...recoveryItems]) {
  const identity = sourceItemIdentity(row);
  const existing = sourceMap.get(identity);
  if (!existing || Number(row.checklistRows || 0) > Number(existing.checklistRows || 0)) sourceMap.set(identity, row);
}

const masterSets = [...setMap.values()].sort((a, b) => [a.universe, a.season, a.manufacturer, a.product].join("|").localeCompare(
  [b.universe, b.season, b.manufacturer, b.product].join("|"), undefined, { numeric: true, sensitivity: "base" },
));
const sourceItems = [...sourceMap.values()].sort((a, b) => [a.universe, a.season, a.manufacturer, a.product, a.source, a.title].join("|").localeCompare(
  [b.universe, b.season, b.manufacturer, b.product, b.source, b.title].join("|"), undefined, { numeric: true, sensitivity: "base" },
));

const targetKeys = new Set(targets.map((target) => target.exactSetKey));
const targetSets = masterSets.filter((row) => targetKeys.has(row.exactSetKey));
const targetChecklistReady = targetSets.filter((row) => Number(row.checklistRowsMaximum || 0) > 0).length;
const summary = {
  schema: "tcos.checklistRecoveryMerge.v1",
  generatedAt: new Date().toISOString(),
  baseExactSets: baseSets.length,
  updatedExactSets: masterSets.length,
  newSetIdentities,
  recoverySourceItems: recoveryItems.length,
  newlyChecklistReady,
  targetTotal: targets.length,
  targetChecklistReady,
  targetRemaining: Math.max(0, targets.length - targetChecklistReady),
  targetChecklistReadyPercent: targets.length ? Number(((targetChecklistReady / targets.length) * 100).toFixed(2)) : 100,
  crawlerProgress: progress.totals || {},
  duplicateExactSetKeys: masterSets.length - new Set(masterSets.map((row) => row.exactSetKey)).size,
  duplicateSourceItems: sourceItems.length - new Set(sourceItems.map(sourceItemIdentity)).size,
};

writeFileSync(resolve(OUT, "master-sets.json"), `${JSON.stringify(masterSets, null, 2)}\n`);
writeFileSync(resolve(OUT, "source-items.json"), `${JSON.stringify(sourceItems, null, 2)}\n`);
writeFileSync(resolve(OUT, "recovery-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const setHeaders = ["universe", "sport", "season", "manufacturer", "product", "sourceCount", "itemCount", "checklistRowsMaximum", "sources", "exactSetKey"];
const setCsv = [setHeaders.map(csvCell).join(",")];
for (const row of masterSets) setCsv.push(setHeaders.map((header) => csvCell(row[header])).join(","));
writeFileSync(resolve(OUT, "master-sets.csv"), `${setCsv.join("\n")}\n`);

const itemHeaders = ["classificationStatus", "universe", "sport", "season", "manufacturer", "product", "source", "title", "status", "checklistRows", "sourceUrl", "archivePath", "missing", "exactSetKey"];
const itemCsv = [itemHeaders.map(csvCell).join(",")];
for (const row of sourceItems) itemCsv.push(itemHeaders.map((header) => csvCell(row[header])).join(","));
writeFileSync(resolve(OUT, "source-items.csv"), `${itemCsv.join("\n")}\n`);

writeFileSync(resolve(OUT, "README.md"), [
  "# TCOS Checklist Recovery Master Catalog",
  "",
  "This catalog merges the run #50 exact-key master catalog with validated checklist recoveries.",
  "Community and forum links remain leads unless provenance and redistribution permission are confirmed.",
  "",
  "```json",
  JSON.stringify(summary, null, 2),
  "```",
  "",
].join("\n"));

console.log(JSON.stringify(summary));
if (summary.duplicateExactSetKeys !== 0) throw new Error("Exact-set duplicate reconciliation failed.");
if (summary.duplicateSourceItems !== 0) throw new Error("Source-item duplicate reconciliation failed.");
