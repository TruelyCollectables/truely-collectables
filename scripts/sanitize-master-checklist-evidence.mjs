import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const auditOutput = resolve(process.cwd(), process.env.MASTER_CHECKLIST_EVIDENCE_AUDIT_OUTPUT || ".checklist-discovery/master-archive-evidence-audit.json");
const EXPECTED_SET_COUNT = 5643;
const EXPECTED_ARCHIVE_BEARING = 5268;
const EXPECTED_SOURCE_RUN = "31100986894";

const GENERIC_ALIAS_NOISE = new Set(["trading", "cards", "card", "checklist", "is", "live"]);
const SPORT_ALIAS_NOISE = {
  baseball: new Set(["baseball", "mlb"]),
  basketball: new Set(["basketball", "nba", "wnba"]),
  football: new Set(["football", "nfl"]),
  hockey: new Set(["hockey", "nhl"]),
  soccer: new Set(["soccer", "epl"]),
  mma: new Set(["mma", "ufc"]),
  wrestling: new Set(["wrestling", "wwe", "aew"]),
};

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

function aliasCore(set) {
  const noise = new Set([
    ...GENERIC_ALIAS_NOISE,
    ...(SPORT_ALIAS_NOISE[String(set.sport || "").toLowerCase()] || []),
  ]);
  return String(set.product || "")
    .normalize("NFKC")
    .toLowerCase()
    .match(/[a-z0-9]+/g)?.filter((token) => !noise.has(token)).join("-") || "";
}

function canonicalAliasMember(a, b) {
  const score = (set) => [
    Number(set.checklistRowsMaximum || 0),
    Number(set.sourceCount || 0),
    Number(set.itemCount || 0),
    -String(set.product || "").length,
  ];
  const left = score(a);
  const right = score(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return right[index] - left[index];
  }
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
if (!Array.isArray(manifest.sets) || manifest.sets.length !== EXPECTED_SET_COUNT) {
  throw new Error(`Frozen corpus expected ${EXPECTED_SET_COUNT.toLocaleString()} audited sets, found ${manifest.sets?.length ?? "invalid"}.`);
}
if (Number(manifest.counts?.import || 0) !== EXPECTED_ARCHIVE_BEARING) {
  throw new Error(`Frozen corpus expected ${EXPECTED_ARCHIVE_BEARING.toLocaleString()} archive-bearing sets, found ${manifest.counts?.import ?? "invalid"}.`);
}
if (String(manifest.sourceRunId || "") !== EXPECTED_SOURCE_RUN) {
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
    schema: "tcos.checklist.masterArchiveEvidenceAudit.v2",
    checkedAt: new Date().toISOString(),
    ok: false,
    reason: "cross_set_sha_has_multiple_direct_originals",
    auditedSets: manifest.sets.length,
    archiveBearingSetsOriginal: Number(manifest.counts.import),
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

// The master crawl sometimes split one physical release into two exact-set keys
// solely because one source title added league/sport/generic words such as NBA,
// NHL, UFC, Trading Cards, Checklist, or "is LIVE!". Those words cannot define
// a different physical release. Collapse only groups whose product names become
// exactly identical after removing that controlled non-identity vocabulary.
const aliasBuckets = new Map();
for (const set of manifest.sets) {
  if (set.disposition !== "import") continue;
  const core = aliasCore(set);
  if (!core) continue;
  const key = [String(set.sport || "").toLowerCase(), String(set.season || "").toLowerCase(), String(set.manufacturer || "").toLowerCase(), core].join("|");
  const rows = aliasBuckets.get(key) || [];
  rows.push(set);
  aliasBuckets.set(key, rows);
}

const aliasGroups = [];
let aliasResolvedCount = 0;
for (const [aliasKey, members] of aliasBuckets) {
  if (members.length < 2) continue;
  const ordered = [...members].sort(canonicalAliasMember);
  const canonical = ordered[0];
  const aliases = ordered.slice(1);
  canonical.aliasExactSetKeys = [...new Set([...(canonical.aliasExactSetKeys || []), ...aliases.map((set) => set.exactSetKey)])].sort();
  const mergedCandidates = [];
  for (const member of ordered) {
    for (const candidate of member.candidates || []) {
      mergedCandidates.push({
        ...candidate,
        aliasSourceExactSetKey: member.exactSetKey,
      });
    }
  }
  canonical.candidates = dedupeCandidates(mergedCandidates);
  canonical.sourceCount = new Set(canonical.candidates.map((candidate) => candidate.source).filter(Boolean)).size;
  canonical.itemCount = canonical.candidates.length;
  canonical.checklistRowsMaximum = Math.max(...ordered.map((set) => Number(set.checklistRowsMaximum || 0)));

  for (const alias of aliases) {
    alias.disposition = "alias_of";
    alias.aliasOfExactSetKey = canonical.exactSetKey;
    alias.aliasOriginalCandidateCount = (alias.candidates || []).length;
    alias.candidates = [];
    aliasResolvedCount += 1;
  }
  aliasGroups.push({
    aliasKey,
    canonicalExactSetKey: canonical.exactSetKey,
    canonicalProduct: canonical.product,
    memberExactSetKeys: ordered.map((set) => set.exactSetKey),
    memberProducts: ordered.map((set) => set.product),
    memberChecklistRowsMaximum: ordered.map((set) => Number(set.checklistRowsMaximum || 0)),
    mergedCandidateCount: canonical.candidates.length,
  });
}

const dispositionCounts = {};
for (const set of manifest.sets) dispositionCounts[set.disposition] = (dispositionCounts[set.disposition] || 0) + 1;
manifest.archiveBearingSetsOriginal = EXPECTED_ARCHIVE_BEARING;
manifest.counts = dispositionCounts;
manifest.evidenceSanitization = {
  schema: "tcos.checklist.masterArchiveEvidenceSanitization.v2",
  duplicateReferencesBlocked: blockedFiles,
  deterministicAliasesResolved: aliasResolvedCount,
};

// Rebuild all batches from the sanitized authoritative manifest. This safely
// moves merged alias candidates into the canonical set even when the original
// exact-set keys hashed into different batch files.
const batchCount = Number(manifest.batchCount || 16);
const batches = Array.from({ length: batchCount }, () => []);
for (let position = 0; position < manifest.sets.length; position += 1) {
  const set = manifest.sets[position];
  const batchIndex = Number.isInteger(set.batch) ? set.batch : position % batchCount;
  if (batchIndex < 0 || batchIndex >= batchCount) throw new Error(`Invalid batch ${batchIndex} for ${set.exactSetKey}.`);
  set.batch = batchIndex;
  batches[batchIndex].push(set);
}
for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
  writeJson(resolve(corpusRoot, `batch-${batchIndex}.json`), {
    schema: "tcos.checklist.masterArchiveBatch.v1",
    index: batchIndex,
    count: batchCount,
    sets: batches[batchIndex],
  });
}
writeJson(manifestPath, manifest);

const leftovers = manifest.sets.flatMap((set) =>
  (set.candidates || []).flatMap((candidate) =>
    (candidate.files || []).filter((file) => file.duplicateOf),
  ),
);
if (leftovers.length) throw new Error(`Sanitized manifest still contains ${leftovers.length} duplicate evidence references.`);
for (const set of manifest.sets.filter((row) => row.disposition === "alias_of")) {
  if (!set.aliasOfExactSetKey || (set.candidates || []).length) throw new Error(`Alias set ${set.exactSetKey} was not fully collapsed.`);
}

const audit = {
  schema: "tcos.checklist.masterArchiveEvidenceAudit.v2",
  checkedAt: new Date().toISOString(),
  ok: true,
  sourceRunId: manifest.sourceRunId,
  auditedSets: manifest.sets.length,
  archiveBearingSetsOriginal: EXPECTED_ARCHIVE_BEARING,
  canonicalImportSets: Number(dispositionCounts.import || 0),
  aliasResolvedCount,
  aliasGroupCount: aliasGroups.length,
  dispositionCounts,
  candidateCount,
  evidenceFileCount,
  uniqueEvidenceShaCount: shaEvidence.size,
  duplicateReferenceFiles,
  blockedDuplicateEvidenceFiles: blockedFiles,
  affectedCandidates,
  affectedSets: affectedSetKeys.size,
  crossSetCollisionCount: crossSetCollisions.length,
  unsafeOriginalCollisionCount: unsafeOriginalCollisions.length,
  knownContaminationBlocked: knownContamination.length,
  policy: "All duplicateOf archive evidence is blocked. Noise-only release aliases are collapsed to one canonical exact set with source candidates merged. Import then uses only direct candidate-owned evidence or live-source revalidation.",
  aliasGroups,
  crossSetCollisions,
  blockedSamples,
};
writeJson(auditOutput, audit);
console.log(JSON.stringify(audit, null, 2));
