import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { classifyMasterSportCandidate } from "./master-checklist-sport-classifier.mjs";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const extractedRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_EXTRACTED_ROOT || ".master-checklist-extracted");
const auditOutput = resolve(process.cwd(), process.env.MASTER_CHECKLIST_SPORT_AUDIT_OUTPUT || ".checklist-discovery/master-sport-normalization-audit-v4.json");
const archiveRoot = resolve(extractedRoot, ".card-checklist-master-archive");
const ORIGINAL_SET_COUNT = 5643;
const ORIGINAL_IMPORT_COUNT = 5268;
const ORIGINAL_SOURCE_RUN = "31100986894";
const ORIGINAL_MULTI_IMPORT_SETS = 797;
const ORIGINAL_MULTI_CANDIDATES = 916;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function checklistText(candidate) {
  const file = (candidate.files || []).find((row) => row.role === "checklist-text" && !row.duplicateOf);
  if (!file) return "";
  const path = resolve(archiveRoot, candidate.archivePath, file.name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").slice(0, 12_000);
}
function compactSource(candidate, classification) {
  return {
    id: candidate.id,
    source: candidate.source,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    checklistRows: Number(candidate.checklistRows || 0),
    classification: classification.sport,
    reason: classification.reason,
    evidence: classification.evidence || [],
  };
}
function mergeCandidates(target, candidates, sourceExactSetKey, classification) {
  const byUrl = new Map((target.candidates || []).map((candidate) => [candidate.sourceUrl, candidate]));
  for (const candidate of candidates) {
    if (byUrl.has(candidate.sourceUrl)) continue;
    byUrl.set(candidate.sourceUrl, {
      ...candidate,
      sportClassification: classification.sport,
      sportClassificationReason: classification.reason,
      sportReclassifiedFromExactSetKey: sourceExactSetKey,
    });
  }
  target.candidates = [...byUrl.values()];
  target.sourceCount = new Set(target.candidates.map((candidate) => candidate.source).filter(Boolean)).size;
  target.itemCount = target.candidates.length;
  target.checklistRowsMaximum = Math.max(
    Number(target.checklistRowsMaximum || 0),
    ...target.candidates.map((candidate) => Number(candidate.checklistRows || 0)),
  );
}

const manifestPath = resolve(corpusRoot, "manifest.json");
const manifest = readJson(manifestPath);
if (!Array.isArray(manifest.sets) || manifest.sets.length !== ORIGINAL_SET_COUNT) {
  throw new Error(`Frozen corpus expected ${ORIGINAL_SET_COUNT.toLocaleString()} audited sets, found ${manifest.sets?.length ?? "invalid"}.`);
}
if (Number(manifest.counts?.import || 0) !== ORIGINAL_IMPORT_COUNT) {
  throw new Error(`Frozen corpus expected ${ORIGINAL_IMPORT_COUNT.toLocaleString()} archive-bearing sets, found ${manifest.counts?.import ?? "invalid"}.`);
}
if (String(manifest.sourceRunId || "") !== ORIGINAL_SOURCE_RUN) {
  throw new Error(`Frozen source run changed: ${manifest.sourceRunId || "missing"}.`);
}

const multiImportSets = manifest.sets.filter((set) => set.sport === "multi-sport" && set.disposition === "import");
const multiCandidates = multiImportSets.reduce((sum, set) => sum + (set.candidates || []).length, 0);
if (multiImportSets.length !== ORIGINAL_MULTI_IMPORT_SETS || multiCandidates !== ORIGINAL_MULTI_CANDIDATES) {
  throw new Error(`Frozen multi-sport fingerprint changed: ${multiImportSets.length} sets / ${multiCandidates} candidates.`);
}

const normalizedSets = [];
const byKey = new Map();
for (const set of manifest.sets) {
  if (set.sport === "multi-sport" && set.disposition === "import") continue;
  const clone = structuredClone(set);
  normalizedSets.push(clone);
  byKey.set(clone.exactSetKey, clone);
}

const candidateClassifications = {};
const classificationReasons = {};
const excludedSources = [];
const aggregateSources = [];
const unresolvedSources = [];
let mergedIntoExisting = 0;
let promotedExistingGap = 0;
let createdReclassifiedSets = 0;

for (const original of multiImportSets) {
  const groups = new Map();
  for (const candidate of original.candidates || []) {
    const classification = classifyMasterSportCandidate(candidate, original, checklistText(candidate));
    candidateClassifications[classification.sport] = (candidateClassifications[classification.sport] || 0) + 1;
    classificationReasons[classification.reason] = (classificationReasons[classification.reason] || 0) + 1;
    const rows = groups.get(classification.sport) || [];
    rows.push({ candidate: structuredClone(candidate), classification });
    groups.set(classification.sport, rows);
  }

  const rest = original.exactSetKey.split("|").slice(1).join("|");
  for (const [classificationSport, rows] of groups) {
    const candidates = rows.map((row) => row.candidate);
    const classification = rows[0].classification;

    if (classificationSport === "excluded_non_sport") {
      const excluded = structuredClone(original);
      excluded.id = `${original.id}-non-sport`;
      excluded.exactSetKey = `non-sport|${rest}`;
      excluded.sport = "non-sport";
      excluded.universe = "non-sport";
      excluded.disposition = "excluded_non_sport";
      excluded.candidates = [];
      excluded.checklistRowsMaximum = 0;
      excluded.excludedSources = rows.map((row) => compactSource(row.candidate, row.classification));
      normalizedSets.push(excluded);
      byKey.set(excluded.exactSetKey, excluded);
      excludedSources.push(...excluded.excludedSources);
      continue;
    }

    if (classificationSport === "aggregate_multi_release") {
      const aggregate = structuredClone(original);
      aggregate.id = `${original.id}-aggregate`;
      aggregate.disposition = "aggregate_index";
      aggregate.candidates = [];
      aggregate.checklistRowsMaximum = 0;
      aggregate.aggregateSources = rows.map((row) => compactSource(row.candidate, row.classification));
      normalizedSets.push(aggregate);
      byKey.set(aggregate.exactSetKey, aggregate);
      aggregateSources.push(...aggregate.aggregateSources);
      continue;
    }

    if (classificationSport === "needs_sport_review") {
      unresolvedSources.push(...rows.map((row) => compactSource(row.candidate, row.classification)));
      continue;
    }

    const key = `${classificationSport}|${rest}`;
    const existing = byKey.get(key);
    if (existing) {
      if (existing.disposition === "gap_pending") {
        existing.disposition = "import";
        promotedExistingGap += 1;
      } else if (existing.disposition !== "import") {
        throw new Error(`Cannot route ${original.exactSetKey} into ${key} with disposition ${existing.disposition}.`);
      }
      mergeCandidates(existing, candidates, original.exactSetKey, classification);
      existing.sportReclassificationSources = [...new Set([...(existing.sportReclassificationSources || []), original.exactSetKey])].sort();
      mergedIntoExisting += 1;
      continue;
    }

    const created = structuredClone(original);
    created.id = `${original.id}-${classificationSport}`;
    created.exactSetKey = key;
    created.sport = classificationSport;
    created.universe = classificationSport;
    created.disposition = "import";
    created.candidates = [];
    created.reclassifiedFromExactSetKey = original.exactSetKey;
    created.sportClassification = classificationSport;
    mergeCandidates(created, candidates, original.exactSetKey, classification);
    normalizedSets.push(created);
    byKey.set(key, created);
    createdReclassifiedSets += 1;
  }
}

if (unresolvedSources.length) {
  writeJson(auditOutput, {
    schema: "tcos.checklist.masterSportNormalization.v2",
    checkedAt: new Date().toISOString(),
    ok: false,
    reason: "unresolved_multi_sport_sources",
    unresolvedSources,
  });
  throw new Error(`Sport normalization left ${unresolvedSources.length} source candidates unresolved.`);
}

const dispositionCounts = {};
for (const set of normalizedSets) dispositionCounts[set.disposition] = (dispositionCounts[set.disposition] || 0) + 1;
const audit = {
  schema: "tcos.checklist.masterSportNormalization.v2",
  checkedAt: new Date().toISOString(),
  ok: true,
  originalAuditedSets: ORIGINAL_SET_COUNT,
  originalArchiveBearingSetKeys: ORIGINAL_IMPORT_COUNT,
  originalMultiSportImportSetCount: multiImportSets.length,
  originalMultiSportCandidateCount: multiCandidates,
  candidateClassifications,
  classificationReasons,
  excludedNonSportSourceCount: excludedSources.length,
  aggregateMultiReleaseSourceCount: aggregateSources.length,
  unresolvedSourceCount: 0,
  mergedIntoExisting,
  promotedExistingGap,
  createdReclassifiedSets,
  normalizedSetCount: normalizedSets.length,
  normalizedDispositionCounts: dispositionCounts,
  excludedSources,
  aggregateSources,
};

manifest.originalCorpusFingerprint = {
  auditedSets: ORIGINAL_SET_COUNT,
  archiveBearingSetKeys: ORIGINAL_IMPORT_COUNT,
  sourceRunId: ORIGINAL_SOURCE_RUN,
};
manifest.sets = normalizedSets;
manifest.counts = dispositionCounts;
manifest.sportNormalization = audit;

const batchCount = Number(manifest.batchCount || 16);
const batches = Array.from({ length: batchCount }, () => []);
for (let position = 0; position < normalizedSets.length; position += 1) {
  const set = normalizedSets[position];
  const batchIndex = Number.isInteger(set.batch) ? set.batch : position % batchCount;
  if (batchIndex < 0 || batchIndex >= batchCount) throw new Error(`Invalid batch ${batchIndex} for ${set.exactSetKey}.`);
  set.batch = batchIndex;
  batches[batchIndex].push(set);
}
for (let index = 0; index < batchCount; index += 1) {
  writeJson(resolve(corpusRoot, `batch-${index}.json`), {
    schema: "tcos.checklist.masterArchiveBatch.v1",
    index,
    count: batchCount,
    sets: batches[index],
  });
}
writeJson(manifestPath, manifest);
writeJson(auditOutput, audit);
console.log(JSON.stringify(audit, null, 2));
