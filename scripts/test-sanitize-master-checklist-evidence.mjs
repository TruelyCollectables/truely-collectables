import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve(process.cwd(), "scripts/sanitize-master-checklist-evidence.mjs");

function writeJson(path, value) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function file(name, sha256, duplicateOf = null) {
  return {
    name,
    role: "source-download",
    sha256,
    bytes: 100,
    duplicateOf,
  };
}

function candidate(id, files) {
  return {
    id,
    source: "gogts",
    title: id,
    sourceUrl: `https://example.invalid/${id}`,
    archivePath: `SORTED/test/${id}`,
    files,
  };
}

function set(exactSetKey, candidates = []) {
  return {
    id: exactSetKey,
    exactSetKey,
    sport: "baseball",
    season: "2021",
    manufacturer: "topps",
    product: exactSetKey.split("|").at(-1),
    disposition: candidates.length ? "import" : "gap_pending",
    candidates,
  };
}

function buildCorpus(root, { unsafeOriginalCollision = false } = {}) {
  const openingSha = "a".repeat(64);
  const unsafeSha = "b".repeat(64);
  const sets = [
    set("baseball|2021|topps|opening-day", [
      candidate("opening-day", [file("opening-day.pdf", openingSha)]),
    ]),
    set("baseball|2021|topps|inception", [
      candidate("inception", [
        file(
          "opening-day.pdf.DUPLICATE-OF.txt",
          openingSha,
          "SORTED/baseball/2021/topps/opening-day/gogts/opening-day/opening-day.pdf",
        ),
      ]),
    ]),
  ];

  if (unsafeOriginalCollision) {
    sets.push(
      set("baseball|2022|topps|unsafe-a", [candidate("unsafe-a", [file("unsafe-a.pdf", unsafeSha)])]),
      set("baseball|2022|topps|unsafe-b", [candidate("unsafe-b", [file("unsafe-b.pdf", unsafeSha)])]),
    );
  }

  while (sets.length < 5643) sets.push(set(`baseball|2099|test|filler-${sets.length}`));
  const manifest = {
    schema: "tcos.checklist.masterArchiveCorpus.v1",
    sourceRunId: "31100986894",
    batchCount: 16,
    counts: { import: 5268, gap_pending: 367, aggregate_index: 7, needs_name_review: 1 },
    sets,
  };
  writeJson(join(root, "manifest.json"), manifest);
  for (let index = 0; index < 16; index += 1) {
    writeJson(join(root, `batch-${index}.json`), {
      schema: "tcos.checklist.masterArchiveBatch.v1",
      index,
      count: 16,
      sets: sets.filter((_, position) => position % 16 === index),
    });
  }
}

function runSanitizer(root) {
  const audit = join(root, "audit.json");
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MASTER_CHECKLIST_CORPUS_ROOT: root,
      MASTER_CHECKLIST_EVIDENCE_AUDIT_OUTPUT: audit,
    },
  });
  return { ...result, audit };
}

const temp = mkdtempSync(join(tmpdir(), "master-evidence-sanitizer-"));
try {
  const safeRoot = join(temp, "safe");
  buildCorpus(safeRoot);
  const safe = runSanitizer(safeRoot);
  assert.equal(safe.status, 0, `Safe sanitizer fixture failed: ${safe.stderr}`);
  const audit = JSON.parse(readFileSync(safe.audit, "utf8"));
  assert.equal(audit.ok, true);
  assert.equal(audit.crossSetCollisionCount, 1);
  assert.equal(audit.unsafeOriginalCollisionCount, 0);
  assert.equal(audit.blockedDuplicateEvidenceFiles, 1);
  assert.equal(audit.knownContaminationBlocked, 1);
  const sanitized = JSON.parse(readFileSync(join(safeRoot, "manifest.json"), "utf8"));
  const inception = sanitized.sets.find((row) => row.exactSetKey === "baseball|2021|topps|inception");
  assert.equal(inception.candidates[0].files.length, 0, "Duplicate reference must be removed from runnable manifest.");
  assert.equal(inception.candidates[0].blockedDuplicateEvidenceCount, 1);
  for (let index = 0; index < 16; index += 1) {
    const batch = JSON.parse(readFileSync(join(safeRoot, `batch-${index}.json`), "utf8"));
    const leftovers = batch.sets.flatMap((row) =>
      (row.candidates || []).flatMap((source) => (source.files || []).filter((evidence) => evidence.duplicateOf)),
    );
    assert.equal(leftovers.length, 0, `Batch ${index} retained duplicate evidence.`);
  }

  const unsafeRoot = join(temp, "unsafe");
  buildCorpus(unsafeRoot, { unsafeOriginalCollision: true });
  const unsafe = runSanitizer(unsafeRoot);
  assert.notEqual(unsafe.status, 0, "Sanitizer must fail when one SHA has direct originals in multiple exact sets.");
  const unsafeAudit = JSON.parse(readFileSync(unsafe.audit, "utf8"));
  assert.equal(unsafeAudit.ok, false);
  assert.equal(unsafeAudit.reason, "cross_set_sha_has_multiple_direct_originals");
  assert.equal(unsafeAudit.unsafeOriginalCollisionCount, 1);

  console.log(JSON.stringify({
    status: "passed",
    duplicateReferenceRemoved: true,
    knownContaminationRegression: true,
    unsafeCrossSetOriginalCollisionRejected: true,
    all16BatchesVerified: true,
  }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
