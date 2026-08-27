import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const temp = mkdtempSync(join(tmpdir(), "master-candidate-completeness-"));
try {
  const sets = [
    {
      exactSetKey: "basketball|2020-21|panini|prizm",
      disposition: "import",
      checklistRowsMaximum: 500,
      batch: 0,
      candidates: [
        { source: "cardboardconnection", sourceUrl: "https://example.invalid/full", checklistRows: 500 },
        { source: "gogts", sourceUrl: "https://example.invalid/thin", checklistRows: 13 },
      ],
    },
    {
      exactSetKey: "baseball|2021|topps|alias",
      disposition: "alias_of",
      aliasOfExactSetKey: "baseball|2021|topps|canonical",
      checklistRowsMaximum: 13,
      batch: 1,
      candidates: [],
    },
  ];
  const manifest = { schema: "test", batchCount: 16, sets };
  writeFileSync(join(temp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (let index = 0; index < 16; index += 1) {
    writeFileSync(join(temp, `batch-${index}.json`), `${JSON.stringify({ schema: "test", index, count: 16, sets: [] }, null, 2)}\n`);
  }

  const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/enforce-master-candidate-completeness.mjs")], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, MASTER_CHECKLIST_CORPUS_ROOT: temp },
  });
  assert.equal(result.status, 0, result.stderr);
  const updated = JSON.parse(readFileSync(join(temp, "manifest.json"), "utf8"));
  const release = updated.sets[0];
  const full = release.candidates[0];
  const thin = release.candidates[1];
  assert.equal(full.sourceChecklistRows, 500);
  assert.equal(full.checklistRows, 500);
  assert.equal(thin.sourceChecklistRows, 13);
  assert.equal(thin.validationChecklistRows, 500);
  assert.equal(thin.checklistRows, 500, "Thin source must be forced to prove full release completeness.");
  assert.equal(updated.candidateCompleteness.raisedCandidates, 1);
  assert.equal(updated.candidateCompleteness.unchangedCandidates, 1);

  const batch0 = JSON.parse(readFileSync(join(temp, "batch-0.json"), "utf8"));
  assert.equal(batch0.sets[0].candidates[1].checklistRows, 500);
  const batch1 = JSON.parse(readFileSync(join(temp, "batch-1.json"), "utf8"));
  assert.equal(batch1.sets[0].disposition, "alias_of");
  assert.equal(batch1.sets[0].candidates.length, 0);

  console.log(JSON.stringify({ status: "passed", thinSourceCannotPassThin: true, originalSourceRowsPreserved: true }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
