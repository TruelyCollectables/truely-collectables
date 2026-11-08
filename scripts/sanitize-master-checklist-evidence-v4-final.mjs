import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const auditOutput = resolve(process.cwd(), process.env.MASTER_CHECKLIST_EVIDENCE_AUDIT_OUTPUT || ".checklist-discovery/master-archive-evidence-audit-v4.json");
const GENERIC_ALIAS_NOISE = new Set(["trading", "cards", "card", "checklist", "is", "live"]);
const GENERIC_SPORT_WORD = Object.fromEntries(
  ["baseball", "basketball", "football", "hockey", "soccer", "mma", "wrestling", "racing", "golf", "tennis", "boxing"].map((sport) => [sport, new Set([sport])]),
);
GENERIC_SPORT_WORD["multi-sport"] = new Set(["multisport", "multi", "sport", "multiple", "sports"]);

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function writeJson(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function evidenceFiles(candidate) { return (candidate.files || []).filter((file) => ["checklist-text", "source-download"].includes(file.role) && file.sha256); }
function compactEvidence(exactSetKey, candidate, file) {
  return { exactSetKey, source: candidate.source, sourceUrl: candidate.sourceUrl, sourceItemId: candidate.id, archivePath: candidate.archivePath, fileName: file.name, role: file.role, sha256: file.sha256, duplicateOf: file.duplicateOf || null };
}
function aliasCore(set) {
  const noise = new Set([...GENERIC_ALIAS_NOISE, ...(GENERIC_SPORT_WORD[String(set.sport || "").toLowerCase()] || [])]);
  return String(set.product || "").normalize("NFKC").toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => !noise.has(token)).join("-") || "";
}
function canonicalScore(set) { return [Number(set.checklistRowsMaximum || 0), Number(set.sourceCount || 0), Number(set.itemCount || 0), -String(set.product || "").length]; }
function canonicalSort(a, b) {
  const left = canonicalScore(a), right = canonicalScore(b);
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return right[index] - left[index];
  return String(a.exactSetKey).localeCompare(String(b.exactSetKey));
}
function dedupeCandidates(candidates) {
  const byUrl = new Map();
  for (const candidate of candidates) {
    const key = String(candidate.sourceUrl || `${candidate.source || ""}:${candidate.id || candidate.archivePath || ""}`);
    const prior = byUrl.get(key);
    if (!prior || Number(candidate.checklistRows || 0) > Number(prior.checklistRows || 0)) byUrl.set(key, candidate);
  }
  return [...byUrl.values()];
}

const manifestPath = resolve(corpusRoot, "manifest.json");
const manifest = readJson(manifestPath);
const fp = manifest.originalCorpusFingerprint || {};
if (fp.auditedSets !== 5643 || fp.archiveBearingSetKeys !== 5268 || fp.sourceRunId !== "31100986894") throw new Error(`Normalized corpus lost frozen fingerprint: ${JSON.stringify(fp)}.`);
if (!manifest.sportNormalization?.ok || manifest.sportNormalization.unresolvedSourceCount !== 0) throw new Error("Sport normalization must pass with zero unresolved sources before evidence sanitization.");
if ((manifest.sets || []).length !== 5548) throw new Error(`Sport-normalized corpus expected 5,548 records, found ${manifest.sets?.length || 0}.`);
for (const [key, expected] of Object.entries({ import: 5160, gap_pending: 331, excluded_non_sport: 48, aggregate_index: 8, needs_name_review: 1 })) {
  if (Number(manifest.counts?.[key] || 0) !== expected) throw new Error(`Sport-normalized ${key} count changed: expected ${expected}, found ${manifest.counts?.[key] || 0}.`);
}

const shaEvidence = new Map();
let candidateCount = 0, evidenceFileCount = 0, duplicateReferenceFiles = 0;
const knownContamination = [];
for (const set of manifest.sets) {
  if (set.disposition !== "import") continue;
  for (const candidate of set.candidates || []) {
    candidateCount += 1;
    for (const file of evidenceFiles(candidate)) {
      evidenceFileCount += 1;
      const row = compactEvidence(set.exactSetKey, candidate, file);
      const rows = shaEvidence.get(file.sha256) || []; rows.push(row); shaEvidence.set(file.sha256, rows);
      if (file.duplicateOf) {
        duplicateReferenceFiles += 1;
        if (set.exactSetKey === "baseball|2021|topps|inception" && /opening-day/i.test(String(file.duplicateOf))) knownContamination.push(row);
      }
    }
  }
}
const crossSetCollisions = [], unsafeOriginalCollisions = [];
for (const [sha256, rows] of shaEvidence) {
  const exactSets = [...new Set(rows.map((row) => row.exactSetKey))]; if (exactSets.length < 2) continue;
  const directOriginals = rows.filter((row) => !row.duplicateOf);
  const collision = { sha256, exactSetCount: exactSets.length, exactSets, directOriginalCount: directOriginals.length, duplicateReferenceCount: rows.length - directOriginals.length, evidence: rows };
  crossSetCollisions.push(collision); if (directOriginals.length > 1) unsafeOriginalCollisions.push(collision);
}
if (unsafeOriginalCollisions.length) throw new Error(`Found ${unsafeOriginalCollisions.length} cross-release evidence SHAs with multiple direct originals.`);
if (!knownContamination.length) throw new Error("Known 2021 Topps Inception -> Opening Day inherited evidence regression was not found.");

let blockedDuplicateEvidenceFiles = 0, affectedCandidates = 0;
const affectedSets = new Set(), blockedSamples = [];
for (const set of manifest.sets) {
  if (set.disposition !== "import") continue;
  for (const candidate of set.candidates || []) {
    const blocked = (candidate.files || []).filter((file) => Boolean(file.duplicateOf)); if (!blocked.length) continue;
    affectedCandidates += 1; affectedSets.add(set.exactSetKey); blockedDuplicateEvidenceFiles += blocked.length;
    for (const file of blocked) if (blockedSamples.length < 100) blockedSamples.push(compactEvidence(set.exactSetKey, candidate, file));
    candidate.files = (candidate.files || []).filter((file) => !file.duplicateOf); candidate.blockedDuplicateEvidenceCount = blocked.length;
  }
}

const aliasBuckets = new Map();
for (const set of manifest.sets) {
  if (set.disposition !== "import") continue;
  const core = aliasCore(set); if (!core) continue;
  const key = [String(set.sport).toLowerCase(), String(set.season).toLowerCase(), String(set.manufacturer).toLowerCase(), core].join("|");
  const rows = aliasBuckets.get(key) || []; rows.push(set); aliasBuckets.set(key, rows);
}
const aliasGroups = []; let aliasResolvedCount = 0;
for (const [aliasKey, members] of aliasBuckets) {
  if (members.length < 2) continue;
  const ordered = [...members].sort(canonicalSort), canonical = ordered[0], aliases = ordered.slice(1);
  canonical.aliasExactSetKeys = [...new Set([...(canonical.aliasExactSetKeys || []), ...aliases.map((set) => set.exactSetKey)])].sort();
  canonical.candidates = dedupeCandidates(ordered.flatMap((member) => (member.candidates || []).map((candidate) => ({ ...candidate, aliasSourceExactSetKey: member.exactSetKey }))));
  canonical.sourceCount = new Set(canonical.candidates.map((candidate) => candidate.source).filter(Boolean)).size;
  canonical.itemCount = canonical.candidates.length;
  canonical.checklistRowsMaximum = Math.max(...ordered.map((set) => Number(set.checklistRowsMaximum || 0)));
  for (const alias of aliases) { alias.disposition = "alias_of"; alias.aliasOfExactSetKey = canonical.exactSetKey; alias.aliasOriginalCandidateCount = (alias.candidates || []).length; alias.candidates = []; aliasResolvedCount += 1; }
  aliasGroups.push({ aliasKey, canonicalExactSetKey: canonical.exactSetKey, canonicalProduct: canonical.product, memberExactSetKeys: ordered.map((set) => set.exactSetKey), memberProducts: ordered.map((set) => set.product), mergedCandidateCount: canonical.candidates.length });
}
const dispositionCounts = {}; for (const set of manifest.sets) dispositionCounts[set.disposition] = (dispositionCounts[set.disposition] || 0) + 1;
manifest.counts = dispositionCounts;
manifest.evidenceSanitization = { schema: "tcos.checklist.masterArchiveEvidenceSanitization.v4", duplicateReferencesBlocked: blockedDuplicateEvidenceFiles, deterministicAliasesResolved: aliasResolvedCount, aliasPolicy: "generic wording + generic sport noun only; league/promotion tokens preserved" };

const batchCount = Number(manifest.batchCount || 16), batches = Array.from({ length: batchCount }, () => []);
for (let position = 0; position < manifest.sets.length; position += 1) { const set = manifest.sets[position], batchIndex = Number.isInteger(set.batch) ? set.batch : position % batchCount; set.batch = batchIndex; batches[batchIndex].push(set); }
for (let index = 0; index < batchCount; index += 1) writeJson(resolve(corpusRoot, `batch-${index}.json`), { schema: "tcos.checklist.masterArchiveBatch.v1", index, count: batchCount, sets: batches[index] });
writeJson(manifestPath, manifest);

const leftovers = manifest.sets.flatMap((set) => (set.candidates || []).flatMap((candidate) => (candidate.files || []).filter((file) => file.duplicateOf)));
if (leftovers.length) throw new Error(`Sanitized corpus still contains ${leftovers.length} inherited evidence references.`);
for (const alias of manifest.sets.filter((set) => set.disposition === "alias_of")) if (!alias.aliasOfExactSetKey || (alias.candidates || []).length) throw new Error(`Alias ${alias.exactSetKey} was not fully collapsed.`);

const audit = {
  schema: "tcos.checklist.masterArchiveEvidenceAudit.v4", checkedAt: new Date().toISOString(), ok: true,
  originalCorpusFingerprint: fp, sportNormalizedSetCount: manifest.sets.length, sportNormalizedImportSetsBeforeAlias: 5160,
  candidateCount, evidenceFileCount, uniqueEvidenceShaCount: shaEvidence.size, duplicateReferenceFiles, blockedDuplicateEvidenceFiles,
  affectedCandidates, affectedSets: affectedSets.size, crossSetCollisionCount: crossSetCollisions.length, unsafeOriginalCollisionCount: 0,
  knownContaminationBlocked: knownContamination.length, aliasGroupCount: aliasGroups.length, aliasResolvedCount,
  canonicalImportSets: Number(dispositionCounts.import || 0), dispositionCounts,
  aliasPolicy: "Only generic wording and generic sport nouns are removable. NBA, WNBA, NFL, NHL, MLB, WWE, AEW, UFC and other league/promotion tokens remain identity-bearing.",
  aliasGroups, crossSetCollisions, blockedSamples,
};
writeJson(auditOutput, audit); console.log(JSON.stringify(audit, null, 2));
