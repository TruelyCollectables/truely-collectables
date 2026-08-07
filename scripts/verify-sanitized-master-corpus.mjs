import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const manifest = JSON.parse(readFileSync(resolve(corpusRoot, "manifest.json"), "utf8"));
const sets = manifest.sets || [];
const byKey = new Map(sets.map((set) => [set.exactSetKey, set]));
const counts = {};
const sourceOwners = new Map();
const directShaOwners = new Map();
let runnableCandidates = 0;
let aliasCount = 0;

if (sets.length !== 5643) throw new Error(`Sanitized corpus expected 5,643 audited sets, found ${sets.length}.`);
if (String(manifest.sourceRunId || "") !== "31100986894") throw new Error(`Sanitized corpus source run changed: ${manifest.sourceRunId || "missing"}.`);

for (const set of sets) {
  counts[set.disposition] = (counts[set.disposition] || 0) + 1;
  if (set.disposition === "alias_of") {
    aliasCount += 1;
    if ((set.candidates || []).length) throw new Error(`Alias ${set.exactSetKey} retained runnable candidates.`);
    const target = byKey.get(set.aliasOfExactSetKey);
    if (!target || target.disposition !== "import") throw new Error(`Alias ${set.exactSetKey} does not resolve to an importable canonical set.`);
    if (!(target.aliasExactSetKeys || []).includes(set.exactSetKey)) throw new Error(`Canonical ${target.exactSetKey} does not reciprocally record alias ${set.exactSetKey}.`);
    continue;
  }
  if (set.disposition !== "import") continue;
  if (!(set.candidates || []).length) throw new Error(`Canonical import set ${set.exactSetKey} has no runnable source candidate.`);
  const releaseExpected = Number(set.checklistRowsMaximum || 0);
  if (releaseExpected < 1) throw new Error(`Canonical import set ${set.exactSetKey} has no checklist-row expectation.`);

  for (const candidate of set.candidates || []) {
    runnableCandidates += 1;
    if (Number(candidate.checklistRows || 0) < releaseExpected) {
      throw new Error(`Candidate ${candidate.sourceUrl} can validate below ${set.exactSetKey}'s release completeness floor.`);
    }
    for (const file of candidate.files || []) {
      if (file.duplicateOf) throw new Error(`Runnable candidate ${candidate.sourceUrl} retained duplicate evidence ${file.name}.`);
      if (!file.sha256 || !["checklist-text", "source-download"].includes(file.role)) continue;
      const owners = directShaOwners.get(file.sha256) || new Set();
      owners.add(set.exactSetKey);
      directShaOwners.set(file.sha256, owners);
    }
    const sourceUrl = String(candidate.sourceUrl || "").trim();
    if (sourceUrl) {
      const owner = sourceOwners.get(sourceUrl);
      if (owner && owner !== set.exactSetKey) throw new Error(`Source URL ${sourceUrl} is runnable under both ${owner} and ${set.exactSetKey}.`);
      sourceOwners.set(sourceUrl, set.exactSetKey);
    }
  }
}

const crossCanonicalSha = [...directShaOwners.entries()]
  .filter(([, owners]) => owners.size > 1)
  .map(([sha256, owners]) => ({ sha256, exactSetKeys: [...owners].sort() }));
if (crossCanonicalSha.length) throw new Error(`Sanitized runnable corpus still has ${crossCanonicalSha.length} direct evidence SHA collisions across canonical releases.`);

if (Number(counts.import || 0) + Number(counts.alias_of || 0) !== 5268) {
  throw new Error(`Canonical + alias resolution must cover all 5,268 archive-bearing sets; found ${(counts.import || 0) + (counts.alias_of || 0)}.`);
}
if (Number(counts.import || 0) !== 4937) throw new Error(`Frozen-corpus canonical import fingerprint changed: expected 4,937, found ${counts.import || 0}.`);
if (Number(counts.alias_of || 0) !== 331) throw new Error(`Frozen-corpus alias fingerprint changed: expected 331, found ${counts.alias_of || 0}.`);
if (Number(counts.gap_pending || 0) !== 367) throw new Error(`Frozen-corpus gap count changed: expected 367, found ${counts.gap_pending || 0}.`);
if (Number(counts.aggregate_index || 0) !== 7) throw new Error(`Frozen-corpus aggregate-index count changed: expected 7, found ${counts.aggregate_index || 0}.`);
if (Number(counts.needs_name_review || 0) !== 1) throw new Error(`Frozen-corpus name-review count changed: expected 1, found ${counts.needs_name_review || 0}.`);

console.log(JSON.stringify({
  schema: "tcos.checklist.sanitizedMasterCorpusProof.v1",
  checkedAt: new Date().toISOString(),
  ok: true,
  auditedSets: sets.length,
  dispositionCounts: counts,
  originalArchiveBearingSets: 5268,
  canonicalImportSets: Number(counts.import || 0),
  resolvedAliasSets: aliasCount,
  runnableCandidates,
  uniqueRunnableSourceUrls: sourceOwners.size,
  directEvidenceShaCount: directShaOwners.size,
  crossCanonicalDirectShaCollisions: 0,
  duplicateEvidenceReferencesRemaining: 0,
  candidatesBelowReleaseCompletenessFloor: 0,
}, null, 2));
