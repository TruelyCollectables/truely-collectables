import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CATALOG_ROOT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CATALOG_ROOT || ".master-checklist-catalog");
const OUTPUT_ROOT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const BATCH_COUNT = Math.max(1, Number(process.env.MASTER_CHECKLIST_BATCH_COUNT || 16));
const ARCHIVE_PREFIX = ".card-checklist-master-archive";
const STRUCTURED_EXTENSIONS = new Set([".csv", ".tsv", ".txt", ".xls", ".xlsx"]);

const SOURCE_PRIORITY = new Map([
  ["beckett", 0],
  ["gogts", 1],
  ["cardboardconnection", 2],
  ["bigapplecollects", 3],
  ["cardboardchecklist", 4],
  ["breakninja", 5],
  ["cloutsnchara", 6],
  ["keyman", 7],
  ["sportscardradio", 8],
  ["baseballcardpedia", 9],
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function extension(name) {
  const value = String(name || "").toLowerCase();
  const match = value.match(/(\.[a-z0-9]+)(?:\.duplicate-of\.txt)?$/i);
  return match?.[1] || "";
}

function yearFromSeason(value) {
  const match = String(value || "").match(/\b((?:19|20)\d{2})\b/);
  return match ? match[1] : null;
}

function seasonSpan(value) {
  const text = String(value || "");
  const match = text.match(/^((?:19|20)\d{2})[-/]((?:19|20)?\d{2})$/);
  if (!match) return 0;
  const start = Number(match[1]);
  const end = match[2].length === 2
    ? Math.floor(start / 100) * 100 + Number(match[2])
    : Number(match[2]);
  return Math.max(0, end - start);
}

function suspiciousProduct(value) {
  const text = String(value || "").normalize("NFKC").trim();
  return (
    !text ||
    text.length > 180 ||
    /\b(?:news and|checklist and|article and)\s*$/i.test(text) ||
    /\b(?:news|article)\s+and\b/i.test(text)
  );
}

function hashBatch(value) {
  const digest = createHash("sha256").update(String(value)).digest();
  return digest.readUInt32BE(0) % BATCH_COUNT;
}

function fileScore(file) {
  if (file.role !== "source-download") return 50;
  switch (extension(file.name)) {
    case ".xlsx": return 0;
    case ".xls": return 1;
    case ".csv": return 2;
    case ".tsv": return 3;
    case ".txt": return 4;
    default: return 40;
  }
}

function candidateScore(row) {
  const structured = (row.files || []).some((file) =>
    file.role === "source-download" && STRUCTURED_EXTENSIONS.has(extension(file.name)),
  );
  return [
    structured ? 0 : 1,
    SOURCE_PRIORITY.get(row.source) ?? 20,
    -Number(row.checklistRows || 0),
    row.sourceUrl || "",
  ];
}

function compareTuple(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === b[index]) continue;
    return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function archivePath(row, file) {
  if (file.duplicateOf) return `${ARCHIVE_PREFIX}/${file.duplicateOf}`;
  return `${ARCHIVE_PREFIX}/${row.archivePath}/${file.name}`;
}

function compactCandidate(row) {
  const files = (row.files || [])
    .filter((file) =>
      file.role === "checklist-text" ||
      (file.role === "source-download" && STRUCTURED_EXTENSIONS.has(extension(file.name))),
    )
    .sort((a, b) => fileScore(a) - fileScore(b));
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    sourceUrl: row.sourceUrl,
    sourceRevision: row.sourceRevision || null,
    status: row.status,
    checklistRows: Number(row.checklistRows || 0),
    archivePath: row.archivePath,
    files,
  };
}

mkdirSync(OUTPUT_ROOT, { recursive: true });
const sportsSets = readJson(resolve(CATALOG_ROOT, "phase1-sports-2000-plus/sports-sets.json"));
const sourceItems = readJson(resolve(CATALOG_ROOT, "source-items.json"));
const sourceByArchive = new Map(sourceItems.map((row) => [row.archivePath, row]));
const extraction = new Set();
const sets = [];

for (const set of sportsSets) {
  const sourceRows = (set.sourceItems || [])
    .map((ref) => sourceByArchive.get(ref.archivePath))
    .filter(Boolean);
  const candidates = sourceRows
    .filter((row) => row.status === "checklist-saved" && Number(row.checklistRows || 0) > 0)
    .sort((a, b) => compareTuple(candidateScore(a), candidateScore(b)))
    .map(compactCandidate);

  for (const candidate of candidates) {
    extraction.add(`${ARCHIVE_PREFIX}/${candidate.archivePath}/metadata.json`);
    for (const file of candidate.files) extraction.add(archivePath(candidate, file));
  }

  const span = seasonSpan(set.season);
  const disposition = span > 1
    ? "aggregate_index"
    : suspiciousProduct(set.product)
      ? "needs_name_review"
      : candidates.length
        ? "import"
        : "gap_pending";
  sets.push({
    id: `MA-${String(sets.length + 1).padStart(5, "0")}`,
    exactSetKey: set.exactSetKey,
    sport: set.sport,
    season: set.season,
    releaseYear: yearFromSeason(set.season),
    manufacturer: set.manufacturer,
    product: set.product,
    sourceCount: Number(set.sourceCount || 0),
    itemCount: Number(set.itemCount || 0),
    checklistRowsMaximum: Number(set.checklistRowsMaximum || 0),
    readiness: set.readiness,
    disposition,
    batch: hashBatch(set.exactSetKey),
    candidates,
  });
}

const batches = Array.from({ length: BATCH_COUNT }, () => []);
for (const set of sets) batches[set.batch].push(set);

const counts = sets.reduce((result, set) => {
  result[set.disposition] = (result[set.disposition] || 0) + 1;
  return result;
}, {});
const manifest = {
  schema: "tcos.checklist.masterArchiveCorpus.v1",
  generatedAt: new Date().toISOString(),
  sourceRunId: "31100986894",
  sourceArchiveArtifactId: "8972198573",
  sourceCatalogArtifactId: "8972199339",
  scope: "all audited sports sets from 2000 forward",
  expectedAuditedSets: 5643,
  batchCount: BATCH_COUNT,
  counts,
  extractionFiles: extraction.size,
  sets,
};

writeFileSync(resolve(OUTPUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (let index = 0; index < batches.length; index += 1) {
  writeFileSync(
    resolve(OUTPUT_ROOT, `batch-${index}.json`),
    `${JSON.stringify({ schema: "tcos.checklist.masterArchiveBatch.v1", index, count: BATCH_COUNT, sets: batches[index] }, null, 2)}\n`,
  );
}
writeFileSync(resolve(OUTPUT_ROOT, "extract-files.txt"), `${[...extraction].sort().join("\n")}\n`);
writeFileSync(
  resolve(OUTPUT_ROOT, "summary.json"),
  `${JSON.stringify({ sets: sets.length, counts, extractionFiles: extraction.size, batches: batches.map((rows) => rows.length) }, null, 2)}\n`,
);

if (sets.length !== 5643) throw new Error(`Expected 5,643 audited sports sets, found ${sets.length}.`);
if (Number(counts.import || 0) < 5_000) throw new Error(`Archive importable set count unexpectedly low: ${counts.import || 0}.`);
console.log(JSON.stringify({ sets: sets.length, counts, extractionFiles: extraction.size, batches: batches.map((rows) => rows.length) }));
