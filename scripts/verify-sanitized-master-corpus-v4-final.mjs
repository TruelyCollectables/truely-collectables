import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const manifest = JSON.parse(readFileSync(resolve(corpusRoot, "manifest.json"), "utf8"));
const sets = manifest.sets || [], byKey = new Map(sets.map((set) => [set.exactSetKey, set]));
const counts = {}, sourceOwners = new Map(), directShaOwners = new Map();
let runnableCandidates = 0, duplicateEvidenceReferencesRemaining = 0, candidatesBelowReleaseCompletenessFloor = 0;
const dangerousAliasGroups = [];
const fp = manifest.originalCorpusFingerprint || {};
if (fp.auditedSets !== 5643 || fp.archiveBearingSetKeys !== 5268 || fp.sourceRunId !== "31100986894") throw new Error(`Final corpus lost frozen fingerprint: ${JSON.stringify(fp)}.`);
if (!manifest.sportNormalization?.ok || manifest.sportNormalization.unresolvedSourceCount !== 0) throw new Error("Final corpus requires zero-unresolved sport normalization.");
if (sets.length !== 5548) throw new Error(`Final sanitized corpus expected 5,548 records, found ${sets.length}.`);

for (const set of sets) {
  counts[set.disposition] = (counts[set.disposition] || 0) + 1;
  if (set.disposition === "alias_of") {
    if ((set.candidates || []).length) throw new Error(`Alias ${set.exactSetKey} retained runnable candidates.`);
    const target = byKey.get(set.aliasOfExactSetKey);
    if (!target || target.disposition !== "import" || !(target.aliasExactSetKeys || []).includes(set.exactSetKey)) throw new Error(`Alias ${set.exactSetKey} does not resolve reciprocally to a canonical import release.`);
    continue;
  }
  if (set.disposition !== "import") {
    if ((set.candidates || []).length) throw new Error(`Non-import record ${set.exactSetKey} (${set.disposition}) retained runnable candidates.`);
    continue;
  }
  if (!(set.candidates || []).length) throw new Error(`Canonical import release ${set.exactSetKey} has no runnable source candidate.`);
  const releaseExpected = Number(set.checklistRowsMaximum || 0); if (releaseExpected < 1) throw new Error(`Canonical import release ${set.exactSetKey} has no completeness expectation.`);
  for (const candidate of set.candidates || []) {
    runnableCandidates += 1;
    if (Number(candidate.checklistRows || 0) < releaseExpected) candidatesBelowReleaseCompletenessFloor += 1;
    const sourceUrl = String(candidate.sourceUrl || "").trim();
    if (sourceUrl) { const owner = sourceOwners.get(sourceUrl); if (owner && owner !== set.exactSetKey) throw new Error(`Source URL ${sourceUrl} is runnable under both ${owner} and ${set.exactSetKey}.`); sourceOwners.set(sourceUrl, set.exactSetKey); }
    for (const file of candidate.files || []) {
      if (file.duplicateOf) duplicateEvidenceReferencesRemaining += 1;
      if (!file.sha256 || !["checklist-text", "source-download"].includes(file.role)) continue;
      const owners = directShaOwners.get(file.sha256) || new Set(); owners.add(set.exactSetKey); directShaOwners.set(file.sha256, owners);
    }
  }
}
const crossCanonicalDirectSha = [...directShaOwners.entries()].filter(([, owners]) => owners.size > 1).map(([sha256, owners]) => ({ sha256, exactSetKeys: [...owners].sort() }));
if (crossCanonicalDirectSha.length) throw new Error(`Final runnable corpus still has ${crossCanonicalDirectSha.length} direct evidence SHAs shared across canonical releases.`);
if (duplicateEvidenceReferencesRemaining) throw new Error(`Final runnable corpus still has ${duplicateEvidenceReferencesRemaining} inherited evidence references.`);
if (candidatesBelowReleaseCompletenessFloor) throw new Error(`Final runnable corpus has ${candidatesBelowReleaseCompletenessFloor} candidates below their release completeness floor.`);

for (const set of sets.filter((row) => row.disposition === "import" && (row.aliasExactSetKeys || []).length)) {
  const members = [set.exactSetKey, ...(set.aliasExactSetKeys || [])].join(" ").toLowerCase();
  const cleanNba = members.replace(/wnba/g, "");
  if (/\bwnba\b/.test(members) && /\bnba\b/.test(cleanNba)) dangerousAliasGroups.push({ canonical: set.exactSetKey, aliases: set.aliasExactSetKeys, conflict: "WNBA/NBA" });
  if (/\bwwe\b/.test(members) && /\baew\b/.test(members)) dangerousAliasGroups.push({ canonical: set.exactSetKey, aliases: set.aliasExactSetKeys, conflict: "WWE/AEW" });
}
if (dangerousAliasGroups.length) throw new Error(`Final alias map contains ${dangerousAliasGroups.length} league/promotion-crossing merges.`);
for (const [key, expected] of Object.entries({ import: 5098, alias_of: 62, gap_pending: 331, excluded_non_sport: 48, aggregate_index: 8, needs_name_review: 1 })) {
  if (Number(counts[key] || 0) !== expected) throw new Error(`Final ${key} count changed: expected ${expected}, found ${counts[key] || 0}.`);
}
const proof = {
  schema: "tcos.checklist.sanitizedMasterCorpusProof.v4.final", checkedAt: new Date().toISOString(), ok: true,
  originalCorpusFingerprint: fp, sanitizedSetRecords: sets.length, dispositionCounts: counts,
  canonicalImportSets: Number(counts.import || 0), resolvedAliasSets: Number(counts.alias_of || 0), runnableCandidates,
  uniqueRunnableSourceUrls: sourceOwners.size, directEvidenceShaCount: directShaOwners.size,
  crossCanonicalDirectShaCollisions: 0, duplicateEvidenceReferencesRemaining: 0, candidatesBelowReleaseCompletenessFloor: 0, dangerousAliasGroups: 0,
  sportNormalization: { originalMultiSportCandidates: manifest.sportNormalization.originalMultiSportCandidateCount, unresolved: manifest.sportNormalization.unresolvedSourceCount, excludedNonSport: manifest.sportNormalization.excludedNonSportSourceCount, aggregateMultiRelease: manifest.sportNormalization.aggregateMultiReleaseSourceCount },
};
console.log(JSON.stringify(proof, null, 2));
