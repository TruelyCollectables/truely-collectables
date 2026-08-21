import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { HOCKEY_SEASONS, WNBA_YEARS, targetIdentity } from "./target-scope.mjs";

const CATALOG_ROOT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CATALOG_ROOT || ".master-checklist-catalog");
const OUTPUT_ROOT = resolve(process.cwd(), process.env.INSTACOMP_TARGET_CORPUS_ROOT || ".instacomp-target-checklist-corpus");
const ARCHIVE_PREFIX = ".card-checklist-master-archive";
const BATCH_SIZE = Math.max(1, Math.min(100, Number(process.env.INSTACOMP_TARGET_BATCH_SIZE || 50)));
const STRUCTURED_EXTENSIONS = new Set([".csv", ".tsv", ".txt", ".xls", ".xlsx", ".html", ".htm"]);
const SUPPLEMENTAL_SOURCES = new Map([
  ["hockey|2024-25|upper-deck|artifacts", {
    id: "recovered-2024-25-upper-deck-artifacts", source: "upperdeck", title: "2024-25 Upper Deck Artifacts Checklist",
    sourceUrl: "https://upperdeck.com/checklist/2024-25-artifacts-checklist/", status: "checklist-saved", checklistRows: 3, archivePath: null, files: [],
  }],
  ["hockey|2025-26|upper-deck|star-rookies-box-set", {
    id: "recovered-2025-26-upper-deck-star-rookies", source: "upperdeck", title: "2025-26 NHL Star Rookies Box Set Checklist",
    sourceUrl: "https://upperdeck.com/checklist/2025-2026-nhl-star-rookies-box-set-checklist/", status: "checklist-saved", checklistRows: 3, archivePath: null, files: [],
  }],
]);

const SOURCE_PRIORITY = new Map([
  ["beckett", 0], ["gogts", 1], ["cardboardconnection", 2], ["bigapplecollects", 3],
  ["cardboardchecklist", 4], ["breakninja", 5], ["cloutsnchara", 6], ["keyman", 7],
  ["sportscardradio", 8], ["baseballcardpedia", 9],
]);

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function extension(name) { return String(name || "").toLowerCase().match(/(\.[a-z0-9]+)(?:\.duplicate-of\.txt)?$/i)?.[1] || ""; }
function archivePath(row, file) { return file.duplicateOf ? `${ARCHIVE_PREFIX}/${file.duplicateOf}` : `${ARCHIVE_PREFIX}/${row.archivePath}/${file.name}`; }
function candidateScore(row) {
  const structured = (row.files || []).some((file) => file.role === "source-download" && STRUCTURED_EXTENSIONS.has(extension(file.name)));
  return [-Number(row.checklistRows || 0), structured ? 0 : 1, SOURCE_PRIORITY.get(row.source) ?? 20, row.sourceUrl || ""];
}
function compareTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
function compactCandidate(row) {
  return {
    id: row.id, source: row.source, title: row.title, sourceUrl: row.sourceUrl,
    sourceRevision: row.sourceRevision || null, status: row.status,
    checklistRows: Number(row.checklistRows || 0), archivePath: row.archivePath,
    files: (row.files || []).filter((file) => file.role === "checklist-text" || (file.role === "source-download" && STRUCTURED_EXTENSIONS.has(extension(file.name)))),
  };
}
function stableId(key) { return `TARGET-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`; }

mkdirSync(OUTPUT_ROOT, { recursive: true });
const sportsSets = readJson(resolve(CATALOG_ROOT, "phase1-sports-2000-plus/sports-sets.json"));
const sourceItems = readJson(resolve(CATALOG_ROOT, "source-items.json"));
const sourceByArchive = new Map(sourceItems.map((row) => [row.archivePath, row]));
const grouped = new Map();

for (const sourceSet of sportsSets) {
  const target = targetIdentity(sourceSet);
  if (!target) continue;
  const bucket = grouped.get(target.exactSetKey) || { target, sourceSets: [] };
  bucket.sourceSets.push(sourceSet);
  grouped.set(target.exactSetKey, bucket);
}

const extraction = new Set();
const sets = [];
for (const { target, sourceSets } of [...grouped.values()].sort((a, b) => a.target.exactSetKey.localeCompare(b.target.exactSetKey))) {
  const sourceRows = sourceSets.flatMap((set) => (set.sourceItems || []).map((ref) => sourceByArchive.get(ref.archivePath)).filter(Boolean));
  const supplement = SUPPLEMENTAL_SOURCES.get(target.exactSetKey);
  if (supplement) sourceRows.push(supplement);
  const byUrl = new Map();
  for (const row of sourceRows) {
    if (row.status !== "checklist-saved" || Number(row.checklistRows || 0) <= 0) continue;
    const prior = byUrl.get(row.sourceUrl);
    if (!prior || compareTuple(candidateScore(row), candidateScore(prior)) < 0) byUrl.set(row.sourceUrl, row);
  }
  const candidates = [...byUrl.values()].sort((a, b) => compareTuple(candidateScore(a), candidateScore(b))).map(compactCandidate);
  for (const candidate of candidates) {
    if (candidate.archivePath) {
      extraction.add(`${ARCHIVE_PREFIX}/${candidate.archivePath}/metadata.json`);
      for (const file of candidate.files) extraction.add(archivePath(candidate, file));
    }
  }
  const expectedRows = Math.max(0, ...sourceSets.map((set) => Number(set.checklistRowsMaximum || 0)), ...candidates.map((candidate) => Number(candidate.checklistRows || 0)));
  sets.push({
    id: stableId(target.exactSetKey), exactSetKey: target.exactSetKey, kind: target.kind,
    sport: target.sport, season: target.season, releaseYear: target.year,
    manufacturer: target.manufacturer, product: target.product,
    sourceCount: candidates.length, itemCount: sourceSets.reduce((n, set) => n + Number(set.itemCount || 0), 0),
    checklistRowsMaximum: expectedRows,
    readiness: candidates.length ? "TARGET_SOURCE_PRESENT" : "TARGET_SOURCE_GAP",
    disposition: candidates.length ? "import" : "gap_pending",
    aliasExactSetKeys: sourceSets.map((set) => set.exactSetKey).filter((key) => key !== target.exactSetKey),
    candidates,
  });
}

const byBucket = {};
for (const set of sets) {
  const bucket = set.kind === "hockey" ? `hockey:${set.season}` : `wnba:${set.releaseYear}`;
  const value = byBucket[bucket] || { total: 0, import: 0, gaps: 0, expectedRows: 0 };
  value.total += 1; value[set.disposition === "import" ? "import" : "gaps"] += 1; value.expectedRows += set.checklistRowsMaximum;
  byBucket[bucket] = value;
}
const gaps = sets.filter((set) => set.disposition !== "import").map((set) => ({ exactSetKey: set.exactSetKey, season: set.season, product: set.product }));
const batches = [];
for (let index = 0; index < sets.length; index += BATCH_SIZE) batches.push(sets.slice(index, index + BATCH_SIZE));

const manifest = {
  schema: "tcos.checklist.instaCompTargetCorpus.v1", generatedAt: new Date().toISOString(),
  sourceRunId: "31100986894", sourceArchiveArtifactId: "8972198573", sourceCatalogArtifactId: "8972199339",
  scope: { hockeySeasons: HOCKEY_SEASONS, wnbaYears: WNBA_YEARS },
  counts: { sets: sets.length, importable: sets.length - gaps.length, gaps: gaps.length, extractionFiles: extraction.size },
  batchSize: BATCH_SIZE, batchCount: batches.length,
  byBucket, gaps, sets,
};
writeFileSync(resolve(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (let index = 0; index < batches.length; index += 1) {
  writeFileSync(resolve(OUTPUT_ROOT, `batch-${index}.json`), `${JSON.stringify({ schema: "tcos.checklist.masterArchiveBatch.v1", index, count: batches.length, sets: batches[index] }, null, 2)}\n`);
}
writeFileSync(resolve(OUTPUT_ROOT, "extract-files.txt"), `${[...extraction].sort().join("\n")}\n`);
writeFileSync(resolve(OUTPUT_ROOT, "summary.json"), `${JSON.stringify({ counts: manifest.counts, batchSize: BATCH_SIZE, batchCount: batches.length, byBucket, gaps }, null, 2)}\n`);
console.log(JSON.stringify({ counts: manifest.counts, batchSize: BATCH_SIZE, batchCount: batches.length, byBucket, gaps }, null, 2));
