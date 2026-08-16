import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { downloadAndParse, parseChecklist } from "./mainstream-checklist/source-tools.mjs";
import { buildPlan, assertPlanComplexity } from "./mainstream-checklist/registry-tools.mjs";
import {
  normalizeCoordinateParsedChecklist,
  normalizeGoGtsPdfCoordinates,
  runGoGtsCoordinateNormalizerSelfTest,
} from "./mainstream-checklist/gogts-pdf-coordinate-normalizer.mjs";

const MINIMUM_CARD_ROWS = Math.max(1, Number(process.env.PUBLIC_WEB_MINIMUM_CARD_ROWS || 25));
const TARGETS_FILE = process.env.GOGTS_COORDINATE_TARGETS;
const OUTPUT_ROOT = resolve(process.env.GOGTS_COORDINATE_OUTPUT || ".checklist-discovery/gogts-coordinate-output");
if (!TARGETS_FILE) throw new Error("GOGTS_COORDINATE_TARGETS is required.");

const acronyms = new Map([
  ["fifa", "FIFA"], ["mlb", "MLB"], ["nba", "NBA"], ["nfl", "NFL"], ["nhl", "NHL"], ["ufc", "UFC"], ["wnba", "WNBA"],
]);
const displayToken = (value) => String(value || "").split("-").filter(Boolean).map((part) => acronyms.get(part.toLowerCase()) || `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
const safeSlug = (value) => String(value || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "target";

function buildEntry(target) {
  const parts = String(target.exactSetKey || "").split("|");
  if (parts.length !== 4) throw new Error(`Invalid exactSetKey: ${target.exactSetKey}`);
  const [sportKey, seasonKey, manufacturerKey, productKey] = parts;
  const manufacturer = displayToken(manufacturerKey);
  const product = displayToken(productKey);
  return {
    id: `coordinate-${safeSlug(target.exactSetKey)}`,
    disposition: "import",
    sourceName: new URL(target.sourceUrl).hostname,
    sourceUrl: target.sourceUrl,
    fallbackUrls: target.fallbackUrls || [],
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: MINIMUM_CARD_ROWS,
    release: {
      exactSetKey: target.exactSetKey,
      canonicalName: `${seasonKey} ${manufacturer} ${product} ${displayToken(sportKey)}`,
      manufacturer,
      brand: null,
      product,
      releaseYear: Number(target.year || String(seasonKey).match(/\d{4}/)?.[0] || 0),
      season: seasonKey,
      sport: sportKey,
      league: null,
    },
  };
}

mkdirSync(OUTPUT_ROOT, { recursive: true });
for (const dir of ["sources", "normalized", "parsed", "plans", "results"]) mkdirSync(resolve(OUTPUT_ROOT, dir), { recursive: true });
runGoGtsCoordinateNormalizerSelfTest();

const targets = JSON.parse(await (await import("node:fs/promises")).readFile(TARGETS_FILE, "utf8"));
if (!Array.isArray(targets) || !targets.length) throw new Error("Target manifest must be a non-empty array.");
const results = [];

for (let index = 0; index < targets.length; index += 1) {
  const target = targets[index];
  const entry = buildEntry(target);
  const slug = safeSlug(target.exactSetKey);
  console.log(`=== COORDINATE ${index + 1}/${targets.length} ${target.exactSetKey} ===`);
  try {
    const downloaded = await downloadAndParse(entry);
    let parsed = downloaded.parsed;
    let coordinate = null;
    if (String(downloaded.source.mimeType || "").toLowerCase() === "application/pdf") {
      coordinate = normalizeGoGtsPdfCoordinates(downloaded.source.bytes);
      if (!coordinate.detected || coordinate.rows.length < MINIMUM_CARD_ROWS) {
        throw new Error(`Coordinate table extraction did not produce enough rows (${coordinate.rows.length}).`);
      }
      parsed = normalizeCoordinateParsedChecklist(parseChecklist(entry, coordinate.text));
    }
    const checkedAt = new Date().toISOString();
    const plan = buildPlan(entry, parsed, downloaded.source, checkedAt);
    const complexity = assertPlanComplexity(plan);
    const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
    const sourceName = `${slug}__${downloaded.source.filename.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    writeFileSync(resolve(OUTPUT_ROOT, "sources", sourceName), Buffer.from(downloaded.source.bytes));
    if (coordinate?.text) writeFileSync(resolve(OUTPUT_ROOT, "normalized", `${slug}.txt`), coordinate.text);
    writeFileSync(resolve(OUTPUT_ROOT, "parsed", `${slug}.json`), JSON.stringify(parsed, null, 2));
    writeFileSync(resolve(OUTPUT_ROOT, "plans", `${slug}.json`), JSON.stringify(plan, null, 2));
    const result = {
      exactSetKey: target.exactSetKey,
      status: errors.length ? "validation_failed" : "ready",
      sourceUrl: target.sourceUrl,
      selectedUrl: downloaded.source.selectedUrl || downloaded.source.finalUrl || target.sourceUrl,
      finalUrl: downloaded.source.finalUrl,
      mimeType: downloaded.source.mimeType,
      filename: downloaded.source.filename,
      coordinateRows: coordinate?.rows.length ?? null,
      coordinateBuckets: coordinate?.buckets.length ?? null,
      counts: plan.validation.counts,
      serializedBytes: complexity.serializedBytes,
      sourceBytes: downloaded.source.bytes.byteLength,
      errors: errors.slice(0, 30),
      warnings: plan.validation.issues.filter((issue) => issue.severity !== "error").slice(0, 30),
      storage: plan.source.storage,
    };
    results.push(result);
    writeFileSync(resolve(OUTPUT_ROOT, "results", `${slug}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ key: target.exactSetKey, status: result.status, coordinateRows: result.coordinateRows, counts: result.counts }));
  } catch (error) {
    const result = {
      exactSetKey: target.exactSetKey,
      status: "failed",
      sourceUrl: target.sourceUrl,
      error: error instanceof Error ? error.stack || error.message : String(error),
    };
    results.push(result);
    writeFileSync(resolve(OUTPUT_ROOT, "results", `${slug}.json`), JSON.stringify(result, null, 2));
    console.error(JSON.stringify({ key: target.exactSetKey, status: "failed", error: result.error.slice(0, 1000) }));
  }
}

const ready = results.filter((row) => row.status === "ready");
const validationFailed = results.filter((row) => row.status === "validation_failed");
const failed = results.filter((row) => row.status === "failed");
const summary = {
  schema: "tcos.checklist.gogtsCoordinateHarvest.v1",
  targetCount: targets.length,
  resultCount: results.length,
  readyCount: ready.length,
  validationFailedCount: validationFailed.length,
  failedCount: failed.length,
  totalCards: ready.reduce((sum, row) => sum + Number(row.counts?.cards || 0), 0),
  totalParallels: ready.reduce((sum, row) => sum + Number(row.counts?.parallels || 0), 0),
  totalIdentities: ready.reduce((sum, row) => sum + Number(row.counts?.identities || 0), 0),
  ready,
  validationFailed,
  failed,
};
writeFileSync(resolve(OUTPUT_ROOT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ targetCount: summary.targetCount, readyCount: summary.readyCount, validationFailedCount: summary.validationFailedCount, failedCount: summary.failedCount, totalCards: summary.totalCards, totalParallels: summary.totalParallels, totalIdentities: summary.totalIdentities }, null, 2));
if (!ready.length) process.exitCode = 2;
