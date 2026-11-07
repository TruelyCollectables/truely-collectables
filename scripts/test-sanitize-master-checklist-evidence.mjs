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
  return { name, role: "source-download", sha256, bytes: 100, duplicateOf };
}

function candidate(id, files, { source = "gogts", rows = 13 } = {}) {
  return {
    id,
    source,
    title: id,
    sourceUrl: `https://example.invalid/${id}`,
    archivePath: `SORTED/test/${id}`,
    checklistRows: rows,
    files,
  };
}

function set(exactSetKey, candidates = [], options = {}) {
  const parts = exactSetKey.split("|");
  return {
    id: exactSetKey,
    exactSetKey,
    sport: options.sport || parts[0] || "baseball",
    season: options.season || parts[1] || "2021",
    manufacturer: options.manufacturer || parts[2] || "topps",
    product: options.product || parts.at(-1),
    sourceCount: options.sourceCount ?? new Set(candidates.map((row) => row.source)).size,
    itemCount: options.itemCount ?? candidates.length,
    checklistRowsMaximum: options.rows ?? Math.max(0, ...candidates.map((row) => Number(row.checklistRows || 0))),
    disposition: options.disposition || (candidates.length ? "import" : "gap_pending"),
    batch: options.batch,
    candidates,
  };
}

function buildCorpus(root, { unsafeOriginalCollision = false } = {}) {
  const openingSha = "a".repeat(64);
  const unsafeSha = "b".repeat(64);
  const chromeSha = "c".repeat(64);
  const chromeAliasSha = "d".repeat(64);
  const sets = [
    set("baseball|2021|topps|opening-day", [
      candidate("opening-day", [file("opening-day.pdf", openingSha)], { rows: 220 }),
    ], { product: "Opening Day", rows: 220, batch: 0 }),
    set("baseball|2021|topps|inception", [
      candidate("inception", [
        file(
          "opening-day.pdf.DUPLICATE-OF.txt",
          openingSha,
          "SORTED/baseball/2021/topps/opening-day/gogts/opening-day/opening-day.pdf",
        ),
      ]),
    ], { product: "Inception", rows: 13, batch: 1 }),
    set("baseball|2022|topps|chrome", [
      candidate("chrome-full", [file("chrome.csv", chromeSha)], { source: "cardboardconnection", rows: 500 }),
    ], { product: "Chrome", rows: 500, batch: 2 }),
    set("baseball|2022|topps|chrome-trading-cards", [
      candidate("chrome-trading", [file("chrome-trading.pdf", chromeAliasSha)], { source: "gogts", rows: 13 }),
    ], { product: "Chrome Trading Cards", rows: 13, batch: 3 }),
  ];

  if (unsafeOriginalCollision) {
    sets.push(
      set("baseball|2022|topps|unsafe-a", [candidate("unsafe-a", [file("unsafe-a.pdf", unsafeSha)])], { product: "Unsafe A", batch: 4 }),
      set("baseball|2022|topps|unsafe-b", [candidate("unsafe-b", [file("unsafe-b.pdf", unsafeSha)])], { product: "Unsafe B", batch: 5 }),
    );
  }

  while (sets.length < 5643) {
    const position = sets.length;
    sets.push(set(`baseball|2099|test|filler-${position}`, [], { product: `Filler ${position}`, batch: position % 16 }));
  }
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
      sets: sets.filter((row, position) => (Number.isInteger(row.batch) ? row.batch : position % 16) === index),
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
  assert.equal(audit.aliasResolvedCount, 1);
  assert.equal(audit.aliasGroupCount, 1);

  const sanitized = JSON.parse(readFileSync(join(safeRoot, "manifest.json"), "utf8"));
  const inception = sanitized.sets.find((row) => row.exactSetKey === "baseball|2021|topps|inception");
  assert.equal(inception.candidates[0].files.length, 0, "Duplicate reference must be removed from runnable manifest.");
  assert.equal(inception.candidates[0].blockedDuplicateEvidenceCount, 1);

  const chrome = sanitized.sets.find((row) => row.exactSetKey === "baseball|2022|topps|chrome");
  const chromeAlias = sanitized.sets.find((row) => row.exactSetKey === "baseball|2022|topps|chrome-trading-cards");
  assert.equal(chrome.disposition, "import");
  assert.deepEqual(chrome.aliasExactSetKeys, ["baseball|2022|topps|chrome-trading-cards"]);
  assert.equal(chrome.candidates.length, 2, "Canonical release must retain candidates from both source aliases.");
  assert.equal(chromeAlias.disposition, "alias_of");
  assert.equal(chromeAlias.aliasOfExactSetKey, chrome.exactSetKey);
  assert.equal(chromeAlias.candidates.length, 0, "Alias release must never remain runnable.");

  for (let index = 0; index < 16; index += 1) {
    const batch = JSON.parse(readFileSync(join(safeRoot, `batch-${index}.json`), "utf8"));
    const leftovers = batch.sets.flatMap((row) =>
      (row.candidates || []).flatMap((source) => (source.files || []).filter((evidence) => evidence.duplicateOf)),
    );
    assert.equal(leftovers.length, 0, `Batch ${index} retained duplicate evidence.`);
    for (const alias of batch.sets.filter((row) => row.disposition === "alias_of")) {
      assert.equal(alias.candidates.length, 0, `Batch ${index} retained runnable alias candidates.`);
    }
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
    deterministicAliasCollapsed: true,
    sourceCandidatesPreservedOnCanonical: true,
    knownContaminationRegression: true,
    unsafeCrossSetOriginalCollisionRejected: true,
    all16BatchesVerified: true,
  }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
