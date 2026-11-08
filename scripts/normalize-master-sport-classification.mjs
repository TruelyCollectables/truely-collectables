import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const extractedRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_EXTRACTED_ROOT || ".master-checklist-extracted");
const auditOutput = resolve(process.cwd(), process.env.MASTER_CHECKLIST_SPORT_AUDIT_OUTPUT || ".checklist-discovery/master-sport-normalization-audit-v4.json");
const ARCHIVE_ROOT = resolve(extractedRoot, ".card-checklist-master-archive");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function normalized(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}
function candidateChecklistText(candidate) {
  const file = (candidate.files || []).find((row) => row.role === "checklist-text" && !row.duplicateOf);
  if (!file) return "";
  const path = resolve(ARCHIVE_ROOT, candidate.archivePath, file.name);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8").slice(0, 12_000);
}
function classifyCandidate(candidate, set) {
  const title = normalized(`${candidate.title || ""} ${set.product || ""}`);
  const url = normalized(candidate.sourceUrl);
  const fileText = normalized((candidate.files || []).filter((file) => !file.duplicateOf).map((file) => file.name).join(" "));
  const checklistText = normalized(candidateChecklistText(candidate));

  const urlPaths = [
    ["/nfl/", "football"],
    ["/nba/", "basketball"],
    ["/mlb/", "baseball"],
    ["/nhl/", "hockey"],
    ["/soccer/", "soccer"],
  ];
  for (const [path, sport] of urlPaths) if (url.includes(path)) return { sport, reason: "source_url_path" };

  if (
    url.includes("/multisport/") ||
    /\b(?:multi[- ]?sport|multiple[- ]sport)\b/.test(`${title} ${url}`)
  ) {
    return { sport: "multi-sport", reason: "explicit_multisport_source" };
  }

  const rules = [
    ["soccer", /\b(?:soccer|uefa|bundesliga|epl)\b|premier[- ]league/],
    ["wrestling", /\b(?:wwe|aew|wrestling|wcw)\b/],
    ["mma", /\b(?:ufc|mma)\b/],
    ["racing", /\b(?:nascar|racing)\b/],
    ["basketball", /\b(?:basketball|nba|wnba)\b/],
    ["baseball", /\b(?:baseball|mlb)\b/],
    ["football", /\b(?:football|nfl|aaf)\b/],
    ["hockey", /\b(?:hockey|nhl|ahl)\b/],
    ["golf", /\b(?:golf|pga)\b/],
    ["tennis", /\b(?:tennis|atp|wta)\b/],
    ["boxing", /\bboxing\b/],
  ];
  for (const [sport, pattern] of rules) if (pattern.test(title)) return { sport, reason: "source_title" };
  for (const [sport, pattern] of rules) if (pattern.test(fileText)) return { sport, reason: "direct_file_name" };

  if (/\bmulti-sport checklist\b|\bmulti\/other sport checklists\b/.test(checklistText)) {
    return { sport: "multi-sport", reason: "archived_checklist_category" };
  }
  const checklistSports = rules.filter(([, pattern]) => pattern.test(checklistText)).map(([sport]) => sport);
  const uniqueChecklistSports = [...new Set(checklistSports)];
  if (uniqueChecklistSports.includes("soccer") && uniqueChecklistSports.includes("football")) {
    uniqueChecklistSports.splice(uniqueChecklistSports.indexOf("football"), 1);
  }
  if (uniqueChecklistSports.length === 1) return { sport: uniqueChecklistSports[0], reason: "archived_checklist_text" };

  if (url.includes("/non-sports/")) return { sport: "excluded_non_sport", reason: "non_sports_source_path" };
  return { sport: "needs_sport_review", reason: "insufficient_sport_evidence" };
}
function sourceSummary(candidate, classification) {
  return {
    id: candidate.id,
    source: candidate.source,
    title: candidate.title,
    sourceUrl: candidate.sourceUrl,
    checklistRows: Number(candidate.checklistRows || 0),
    classification: classification.sport,
    reason: classification.reason,
  };
}
function mergeCandidates(target, candidates, sourceExactSetKey, classification) {
  const urls = new Set((target.candidates || []).map((candidate) => candidate.sourceUrl));
  target.candidates ||= [];
  for (const candidate of candidates) {
    if (urls.has(candidate.sourceUrl)) continue;
    target.candidates.push({
      ...candidate,
      sportClassification: classification.sport,
      sportClassificationReason: classification.reason,
      sportReclassifiedFromExactSetKey: sourceExactSetKey,
    });
    urls.add(candidate.sourceUrl);
  }
  target.sourceCount = new Set(target.candidates.map((candidate) => candidate.source).filter(Boolean)).size;
  target.itemCount = target.candidates.length;
  target.checklistRowsMaximum = Math.max(Number(target.checklistRowsMaximum || 0), ...target.candidates.map((candidate) => Number(candidate.checklistRows || 0)));
}

const manifestPath = resolve(corpusRoot, "manifest.json");
const manifest = readJson(manifestPath);
if ((manifest.sets || []).length !== 5643) throw new Error(`Expected frozen 5,643-set corpus, found ${manifest.sets?.length || 0}.`);
if (Number(manifest.counts?.import || 0) !== 5268) throw new Error(`Expected frozen 5,268 archive-bearing sets, found ${manifest.counts?.import || 0}.`);
if (String(manifest.sourceRunId || "") !== "31100986894") throw new Error(`Frozen source run changed: ${manifest.sourceRunId || "missing"}.`);

const originalSets = manifest.sets;
const originalMultiSportImportSets = originalSets.filter((set) => set.sport === "multi-sport" && set.disposition === "import");
const originalMultiSportCandidates = originalMultiSportImportSets.reduce((sum, set) => sum + (set.candidates || []).length, 0);
if (originalMultiSportImportSets.length !== 797 || originalMultiSportCandidates !== 916) {
  throw new Error(`Multi-sport frozen fingerprint changed: ${originalMultiSportImportSets.length} sets / ${originalMultiSportCandidates} candidates.`);
}

const normalizedSets = [];
const byKey = new Map();
for (const set of originalSets) {
  if (set.sport === "multi-sport" && set.disposition === "import") continue;
  const clone = structuredClone(set);
  normalizedSets.push(clone);
  byKey.set(clone.exactSetKey, clone);
}

const candidateClassifications = {};
const classificationReasons = {};
let mergedIntoExisting = 0;
let promotedExistingGap = 0;
let createdReclassifiedSets = 0;
const excludedSources = [];
const unresolvedSources = [];

for (const original of originalMultiSportImportSets) {
  const groups = new Map();
  for (const candidate of original.candidates || []) {
    const classification = classifyCandidate(candidate, original);
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
      const key = `non-sport|${rest}`;
      const excluded = structuredClone(original);
      excluded.exactSetKey = key;
      excluded.sport = "non-sport";
      excluded.universe = "non-sport";
      excluded.disposition = "excluded_non_sport";
      excluded.candidates = [];
      excluded.checklistRowsMaximum = 0;
      excluded.excludedSources = rows.map((row) => sourceSummary(row.candidate, row.classification));
      normalizedSets.push(excluded);
      byKey.set(key, excluded);
      excludedSources.push(...excluded.excludedSources);
      continue;
    }

    if (classificationSport === "needs_sport_review") {
      unresolvedSources.push(...rows.map((row) => sourceSummary(row.candidate, row.classification)));
      continue;
    }

    const key = `${classificationSport}|${rest}`;
    const existing = byKey.get(key);
    if (existing) {
      if (existing.disposition === "gap_pending") {
        existing.disposition = "import";
        promotedExistingGap += 1;
      } else if (existing.disposition !== "import") {
        throw new Error(`Cannot route ${original.exactSetKey} into non-import target ${key} (${existing.disposition}).`);
      }
      mergeCandidates(existing, candidates, original.exactSetKey, classification);
      existing.sportReclassificationSources = [...new Set([...(existing.sportReclassificationSources || []), original.exactSetKey])].sort();
      mergedIntoExisting += 1;
      continue;
    }

    const created = structuredClone(original);
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
  const audit = {
    schema: "tcos.checklist.masterSportNormalization.v1",
    ok: false,
    reason: "unresolved_multi_sport_sources",
    unresolvedSources,
  };
  writeJson(auditOutput, audit);
  throw new Error(`Sport normalization left ${unresolvedSources.length} source candidates unresolved.`);
}

const counts = {};
for (const set of normalizedSets) counts[set.disposition] = (counts[set.disposition] || 0) + 1;
const normalization = {
  schema: "tcos.checklist.masterSportNormalization.v1",
  checkedAt: new Date().toISOString(),
  ok: true,
  originalAuditedSets: 5643,
  originalArchiveBearingSets: 5268,
  originalMultiSportImportSets,
  originalMultiSportImportSetCount: originalMultiSportImportSets.length,
  originalMultiSportCandidateCount: originalMultiSportCandidates,
  candidateClassifications,
  classificationReasons,
  excludedNonSportSourceCount: excludedSources.length,
  unresolvedSourceCount: unresolvedSources.length,
  mergedIntoExisting,
  promotedExistingGap,
  createdReclassifiedSets,
  normalizedSetCount: normalizedSets.length,
  normalizedDispositionCounts: counts,
  excludedSources,
};

manifest.originalCorpusFingerprint = {
  auditedSets: 5643,
  archiveBearingSets: 5268,
  sourceRunId: "31100986894",
};
manifest.sets = normalizedSets;
manifest.counts = counts;
manifest.sportNormalization = normalization;

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
writeJson(auditOutput, normalization);
console.log(JSON.stringify(normalization, null, 2));
