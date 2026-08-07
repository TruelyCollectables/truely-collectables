import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const auditOutput = resolve(process.cwd(), process.env.MASTER_CHECKLIST_EVIDENCE_AUDIT_OUTPUT || ".checklist-discovery/master-archive-evidence-audit.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function evidenceFiles(candidate) {
  return (candidate.files || []).filter((file) =>
    ["checklist-text", "source-download"].includes(file.role) && file.sha256,
  );
}

function compactEvidence(exactSetKey, candidate, file) {
  return {
    exactSetKey,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    sourceItemId: candidate.id,
    archivePath: candidate.archivePath,
    fileName: file.name,
    role: file.role,
    sha256: file.sha256,
    duplicateOf: file.duplicateOf || null,
  };
}

const manifestPath = resolve(corpusRoot, "manifest.json");
const manifest = readJson(manifestPath);
if (!Array.isArray(manifest.sets) || manifest.sets.length !== 5643) {
  throw new Error(`Frozen corpus expected 5,643 audited sets, found ${manifest.sets?.length ?? "invalid"}.`);
}
if (Number(manifest.counts?.import || 0) !== 5268) {
  throw new Error(`Frozen corpus expected 5,268 archive-bearing sets, found ${manifest.counts?.import ?? "invalid"}.`);
}
if (String(manifest.sourceRunId || "") !== "31100986894") {
  throw new Error(`Frozen corpus source run changed: ${manifest.sourceRunId || "missing"}.`);
}

const shaEvidence = new Map();
let duplicateReferenceFiles = 0;
let candidateCount = 0;
let evidenceFileCount = 0;
const knownContamination = [];

for (const set of manifest.sets) {
  for (const candidate of set.candidates || []) {
    candidateCount += 1;
    for (const file of evidenceFiles(candidate)) {
      evidenceFileCount += 1;
      const row = compactEvidence(set.exactSetKey, candidate, file);
      const rows = shaEvidence.get(file.sha256) || [];
      rows.push(row);
      shaEvidence.set(file.sha256, rows);
      if (file.duplicateOf) {
        duplicateReferenceFiles += 1;
        if (
          set.exactSetKey === "baseball|2021|topps|inception" &&
          /opening-day/i.test(String(file.duplicateOf))
        ) {
          knownContamination.push(row);
        }
      }
    }
  }
}

const crossSetCollisions = [];
const unsafeOriginalCollisions = [];
for (const [sha256, rows] of shaEvidence) {
  const exactSets = [...new Set(rows.map((row) => row.exactSetKey))];
  if (exactSets.length < 2) continue;
  const directOriginals = rows.filter((row) => !row.duplicateOf);
  const collision = {
    sha256,
    exactSetCount: exactSets.length,
    exactSets,
    directOriginalCount: directOriginals.length,
    duplicateReferenceCount: rows.length - directOriginals.length,
    evidence: rows,
  };
  crossSetCollisions.push(collision);
  if (directOriginals.length > 1) unsafeOriginalCollisions.push(collision);
}

if (unsafeOriginalCollisions.length) {
  writeJson(auditOutput, {
    schema: "tcos.checklist.masterArchiveEvidenceAudit.v1",
    checkedAt: new Date().toISOString(),
    ok: false,
    reason: "cross_set_sha_has_multiple_direct_originals",
    auditedSets: manifest.sets.length,
    archiveBearingSets: Number(manifest.counts.import),
    evidenceFileCount,
    duplicateReferenceFiles,
    crossSetCollisionCount: crossSetCollisions.length,
    unsafeOriginalCollisionCount: unsafeOriginalCollisions.length,
    unsafeOriginalCollisions,
  });
  throw new Error(`Found ${unsafeOriginalCollisions.length} cross-set evidence SHA collisions with multiple direct originals.`);
}

if (!knownContamination.length) {
  throw new Error("Frozen-corpus regression guard did not find the known 2021 Topps Inception -> Opening Day duplicate reference.");
}

let blockedFiles = 0;
let affectedCandidates = 0;
let affectedSets = 0;
const affectedSetKeys = new Set();
const blockedSamples = [];

for (const set of manifest.sets) {
  for (const candidate of set.candidates || []) {
    const before = candidate.files || [];
    const blocked = before.filter((file) => Boolean(file.duplicateOf));
    if (!blocked.length) continue;
    affectedCandidates += 1;
    affectedSetKeys.add(set.exactSetKey);
    blockedFiles += blocked.length;
    for (const file of blocked) {
      if (blockedSamples.length < 100) blockedSamples.push(compactEvidence(set.exactSetKey, candidate, file));
    }
    candidate.files = before.filter((file) => !file.duplicateOf);
    candidate.blockedDuplicateEvidenceCount = blocked.length;
  }
}
affectedSets = affectedSetKeys.size;

for (let batchIndex = 0; batchIndex < Number(manifest.batchCount || 16); batchIndex += 1) {
  const path = resolve(corpusRoot, `batch-${batchIndex}.json`);
  const batch = readJson(path);
  let batchBlocked = 0;
  for (const set of batch.sets || []) {
    for (const candidate of set.candidates || []) {
      const before = candidate.files || [];
      const blocked = before.filter((file) => Boolean(file.duplicateOf));
      batchBlocked += blocked.length;
      candidate.files = before.filter((file) => !file.duplicateOf);
      if (blocked.length) candidate.blockedDuplicateEvidenceCount = blocked.length;
    }
  }
  writeJson(path, batch);
  const reloaded = readJson(path);
  const leftovers = (reloaded.sets || []).flatMap((set) =>
    (set.candidates || []).flatMap((candidate) =>
      (candidate.files || []).filter((file) => file.duplicateOf),
    ),
  );
  if (leftovers.length) throw new Error(`Batch ${batchIndex} still contains ${leftovers.length} duplicate evidence references after sanitization.`);
  if (batchBlocked < 0) throw new Error("Unreachable batch evidence count guard.");
}

writeJson(manifestPath, manifest);
const manifestLeftovers = manifest.sets.flatMap((set) =>
  (set.candidates || []).flatMap((candidate) =>
    (candidate.files || []).filter((file) => file.duplicateOf),
  ),
);
if (manifestLeftovers.length) throw new Error(`Sanitized manifest still contains ${manifestLeftovers.length} duplicate evidence references.`);

const audit = {
  schema: "tcos.checklist.masterArchiveEvidenceAudit.v1",
  checkedAt: new Date().toISOString(),
  ok: true,
  sourceRunId: manifest.sourceRunId,
  auditedSets: manifest.sets.length,
  archiveBearingSets: Number(manifest.counts.import),
  candidateCount,
  evidenceFileCount,
  uniqueEvidenceShaCount: shaEvidence.size,
  duplicateReferenceFiles,
  blockedDuplicateEvidenceFiles: blockedFiles,
  affectedCandidates,
  affectedSets,
  crossSetCollisionCount: crossSetCollisions.length,
  unsafeOriginalCollisionCount: unsafeOriginalCollisions.length,
  knownContaminationBlocked: knownContamination.length,
  policy: "All archive files carrying duplicateOf are removed from runnable candidate manifests. The importer must use direct candidate-owned evidence or live-source revalidation instead.",
  crossSetCollisions,
  blockedSamples,
};
writeJson(auditOutput, audit);
console.log(JSON.stringify(audit, null, 2));
