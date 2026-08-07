import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const manifestPath = resolve(corpusRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const batchCount = Number(manifest.batchCount || 16);
let runnableCandidates = 0;
let raisedCandidates = 0;
let unchangedCandidates = 0;

for (const set of manifest.sets || []) {
  if (set.disposition !== "import") continue;
  const releaseExpectedRows = Number(set.checklistRowsMaximum || 0);
  if (releaseExpectedRows < 1) throw new Error(`Import set ${set.exactSetKey} has no release checklist-row expectation.`);
  for (const candidate of set.candidates || []) {
    runnableCandidates += 1;
    const sourceRows = Number(candidate.sourceChecklistRows ?? candidate.checklistRows ?? 0);
    candidate.sourceChecklistRows = sourceRows;
    candidate.validationChecklistRows = releaseExpectedRows;
    candidate.checklistRows = Math.max(sourceRows, releaseExpectedRows);
    if (candidate.checklistRows > sourceRows) raisedCandidates += 1;
    else unchangedCandidates += 1;
  }
}

const batches = Array.from({ length: batchCount }, () => []);
for (let position = 0; position < manifest.sets.length; position += 1) {
  const set = manifest.sets[position];
  const batchIndex = Number.isInteger(set.batch) ? set.batch : position % batchCount;
  if (batchIndex < 0 || batchIndex >= batchCount) throw new Error(`Invalid batch ${batchIndex} for ${set.exactSetKey}.`);
  batches[batchIndex].push(set);
}
for (let index = 0; index < batchCount; index += 1) {
  writeFileSync(
    resolve(corpusRoot, `batch-${index}.json`),
    `${JSON.stringify({ schema: "tcos.checklist.masterArchiveBatch.v1", index, count: batchCount, sets: batches[index] }, null, 2)}\n`,
    "utf8",
  );
}
manifest.candidateCompleteness = {
  schema: "tcos.checklist.masterCandidateCompleteness.v1",
  runnableCandidates,
  raisedCandidates,
  unchangedCandidates,
  policy: "Each candidate validates against max(sourceChecklistRows, release checklistRowsMaximum). Original source row counts remain in sourceChecklistRows.",
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

for (const set of manifest.sets.filter((row) => row.disposition === "import")) {
  for (const candidate of set.candidates || []) {
    if (Number(candidate.checklistRows || 0) < Number(set.checklistRowsMaximum || 0)) {
      throw new Error(`Candidate ${candidate.sourceUrl} can validate below release completeness for ${set.exactSetKey}.`);
    }
  }
}

console.log(JSON.stringify({
  schema: "tcos.checklist.masterCandidateCompleteness.v1",
  ok: true,
  runnableCandidates,
  raisedCandidates,
  unchangedCandidates,
}, null, 2));
