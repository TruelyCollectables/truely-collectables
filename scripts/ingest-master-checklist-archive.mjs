import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseArchivedCandidate } from "./master-checklist-archive/archive-source-tools.mjs";
import { downloadAndParse } from "./mainstream-checklist/source-tools.mjs";
import {
  ARCHIVE_BUCKET,
  assertPlanComplexity,
  buildPlan,
  dbClient,
  ensureArchiveBucket,
  limitedIssues,
  persistPlan,
  uploadArchive,
  upsertCatalog,
} from "./mainstream-checklist/registry-tools.mjs";

const CORPUS_ROOT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const EXTRACTED_ROOT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_EXTRACTED_ROOT || ".master-checklist-extracted");
const BATCH_INDEX = Math.max(0, Number(process.env.MASTER_CHECKLIST_BATCH_INDEX || 0));
const APPLY = process.env.MASTER_CHECKLIST_APPLY !== "false";
const WORKERS = Math.max(1, Math.min(6, Number(process.env.MASTER_CHECKLIST_WORKERS || 3)));
const OUTPUT = resolve(
  process.cwd(),
  process.env.MASTER_CHECKLIST_OUTPUT || `.checklist-discovery/master-archive-batch-${BATCH_INDEX}.json`,
);
const MASTER_RUN_ID = "31100986894";
const MASTER_ARCHIVE_ARTIFACT_ID = "8972198573";

function writeReceipt(value) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(value, null, 2));
}

function canonicalName(set) {
  return [set.season, set.manufacturer, set.product, set.sport].filter(Boolean).join(" ");
}

function entryFor(set, candidate) {
  const expected = Number(candidate.checklistRows || set.checklistRowsMaximum || 0);
  const minimumCardRows = expected >= 20 ? Math.max(3, Math.floor(expected * 0.90)) : Math.max(3, expected || 3);
  return {
    id: set.id,
    disposition: "standalone",
    sourceName: candidate.source,
    sourceUrl: candidate.sourceUrl,
    fallbackUrls: [],
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows,
    release: {
      canonicalName: canonicalName(set),
      exactSetKey: set.exactSetKey,
      manufacturer: set.manufacturer,
      brand: null,
      product: set.product,
      releaseYear: set.releaseYear,
      season: set.season,
      sport: set.sport,
      league: null,
    },
  };
}

function completenessErrors(set, candidate, parsed, origin) {
  const issues = [];
  const expected = Number(candidate.checklistRows || set.checklistRowsMaximum || 0);
  const count = Number(parsed.cards?.length || 0);
  if (count < 3) {
    issues.push({ code: "master_archive_insufficient_rows", severity: "error", message: `${origin} parsed only ${count} deterministic rows.` });
  }
  if (expected >= 20 && count < Math.floor(expected * 0.90)) {
    issues.push({ code: "master_archive_row_count_shortfall", severity: "error", message: `${origin} parsed ${count} rows; archived source recorded ${expected}.` });
  }
  if (expected >= 20 && count > Math.max(expected + 25, Math.ceil(expected * 1.20))) {
    issues.push({ code: "master_archive_row_count_excess", severity: "error", message: `${origin} parsed ${count} rows; archived source recorded ${expected}.` });
  }
  return issues;
}

async function catalogState(db, urls) {
  const rows = [];
  const unique = [...new Set(urls.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("source_url,status,source_sha256,validation_counts,metadata,release_name")
      .in("source_url", unique.slice(index, index + 100));
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    rows.push(...(data || []));
  }
  return new Map(rows.map((row) => [row.source_url, row]));
}

function existingForSet(set, state) {
  for (const candidate of set.candidates || []) {
    const row = state.get(candidate.sourceUrl);
    if (!row || !["imported", "unchanged"].includes(row.status)) continue;
    const exact = row.metadata?.masterArchiveExactSetKey || row.metadata?.exactSetKey || row.metadata?.backlogExactSetKey;
    if (exact === set.exactSetKey) return row;
  }
  return null;
}

function provenanceMetadata(set, candidate, selected, archive, plan, attempts) {
  return {
    masterArchiveSchema: "tcos.checklist.masterArchiveCorpus.v1",
    masterArchiveRunId: MASTER_RUN_ID,
    masterArchiveArtifactId: MASTER_ARCHIVE_ARTIFACT_ID,
    masterArchiveExactSetKey: set.exactSetKey,
    masterArchiveSetId: set.id,
    masterArchiveSource: candidate.source,
    masterArchiveSourceItemId: candidate.id,
    masterArchiveSourcePath: candidate.archivePath,
    masterArchiveRecordedRows: Number(candidate.checklistRows || 0),
    masterArchiveReadiness: set.readiness,
    masterArchiveSelectedMode: selected.mode || (selected.source.archivedMasterSource ? "archive" : "live"),
    rawArchived: true,
    archiveBucket: ARCHIVE_BUCKET,
    archiveObjectPath: archive.objectPath,
    selectedUrl: selected.source.selectedUrl,
    finalUrl: selected.source.finalUrl,
    sourceMimeType: selected.source.mimeType,
    sourceSizeBytes: selected.source.bytes.byteLength,
    validationCounts: plan.validation.counts,
    sourceAttempts: attempts.slice(0, 12),
  };
}

async function parseCandidate(set, candidate) {
  const entry = entryFor(set, candidate);
  const attempts = [];

  try {
    const archived = parseArchivedCandidate(entry, candidate, EXTRACTED_ROOT);
    const extra = completenessErrors(set, candidate, archived.parsed, `archive:${archived.mode}`);
    if (!extra.length && !archived.parsed.errors?.some((issue) => issue.severity === "error")) {
      archived.parsed.warnings = [...(archived.parsed.warnings || []), {
        code: "master_archive_provenance",
        severity: "warning",
        message: `Source recovered from master crawl ${MASTER_RUN_ID}.`,
      }];
      return { ...archived, entry, attempts: [{ mode: `archive:${archived.mode}`, status: "passed", cards: archived.parsed.cards.length }] };
    }
    attempts.push({ mode: `archive:${archived.mode}`, status: "rejected", cards: archived.parsed.cards.length, issues: limitedIssues(extra.length ? extra : archived.parsed.errors) });
  } catch (error) {
    attempts.push({ mode: "archive", status: "failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
  }

  try {
    const live = await downloadAndParse(entry);
    const extra = completenessErrors(set, candidate, live.parsed, "live");
    const parserErrors = live.parsed.errors?.filter((issue) => issue.severity === "error") || [];
    if (extra.length || parserErrors.length) {
      attempts.push({ mode: "live", status: "rejected", cards: live.parsed.cards.length, issues: limitedIssues([...parserErrors, ...extra]) });
    } else {
      live.parsed.warnings = [...(live.parsed.warnings || []), {
        code: "master_archive_live_recovery",
        severity: "warning",
        message: `Live source revalidated against master crawl ${MASTER_RUN_ID}.`,
      }];
      return { ...live, entry, mode: "live", attempts: [...attempts, { mode: "live", status: "passed", cards: live.parsed.cards.length }] };
    }
  } catch (error) {
    attempts.push({ mode: "live", status: "failed", message: (error instanceof Error ? error.message : String(error)).slice(0, 500) });
  }

  const error = new Error(`Candidate ${candidate.source} did not pass archived or live completeness validation.`);
  error.attempts = attempts;
  throw error;
}

async function processSet(db, set, state) {
  if (set.disposition !== "import") {
    return {
      id: set.id,
      exactSetKey: set.exactSetKey,
      status: set.disposition,
      recordedRows: set.checklistRowsMaximum,
    };
  }

  const existing = existingForSet(set, state);
  if (existing) {
    return {
      id: set.id,
      exactSetKey: set.exactSetKey,
      status: "already_live",
      counts: existing.validation_counts || null,
    };
  }

  const failures = [];
  for (const candidate of set.candidates || []) {
    let selected;
    try {
      selected = await parseCandidate(set, candidate);
    } catch (error) {
      failures.push({
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        recordedRows: candidate.checklistRows,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        attempts: error?.attempts || [],
      });
      continue;
    }

    let archive = null;
    try {
      archive = await uploadArchive(db, selected.source);
      const plan = buildPlan(selected.entry, selected.parsed, selected.source, new Date().toISOString());
      const extra = completenessErrors(set, candidate, selected.parsed, selected.mode || "selected");
      if (extra.length) plan.validation.issues.push(...extra);
      const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
      if (errors.length) {
        failures.push({ source: candidate.source, sourceUrl: candidate.sourceUrl, message: "Normalized plan failed validation.", issues: limitedIssues(errors) });
        continue;
      }
      assertPlanComplexity(plan);
      const checkedAt = new Date().toISOString();
      const common = {
        manufacturer: set.manufacturer,
        sport: set.sport,
        source_url: candidate.sourceUrl,
        source_sha256: archive.digest,
        release_slug: plan.release.releaseSlug,
        release_name: canonicalName(set),
        adapter_id: plan.adapterId,
        adapter_version: plan.adapterVersion,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: plan.validation.counts,
        issue_summary: limitedIssues(plan.validation.issues),
        metadata: provenanceMetadata(set, candidate, selected, archive, plan, [...failures, ...(selected.attempts || [])]),
      };

      if (!APPLY) {
        await upsertCatalog(db, { ...common, status: "validated" });
        return { id: set.id, exactSetKey: set.exactSetKey, status: "validated", source: candidate.source, counts: plan.validation.counts };
      }

      const persistence = await persistPlan(db, plan, selected.source.bytes);
      await upsertCatalog(db, { ...common, status: "imported", imported_at: checkedAt });
      return {
        id: set.id,
        exactSetKey: set.exactSetKey,
        status: "imported",
        source: candidate.source,
        mode: selected.mode,
        counts: plan.validation.counts,
        persistence,
      };
    } catch (error) {
      failures.push({
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
    }
  }

  const first = set.candidates?.[0];
  if (first) {
    const checkedAt = new Date().toISOString();
    await upsertCatalog(db, {
      manufacturer: set.manufacturer,
      sport: set.sport,
      source_url: first.sourceUrl,
      release_name: canonicalName(set),
      status: "quarantined",
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      validation_counts: { sets: 0, cards: 0, parallels: 0, identities: 0 },
      issue_summary: [{
        code: "master_archive_set_not_promoted",
        severity: "error",
        message: `No archived or live source passed completeness validation for ${set.exactSetKey}.`,
      }],
      metadata: {
        masterArchiveSchema: "tcos.checklist.masterArchiveCorpus.v1",
        masterArchiveRunId: MASTER_RUN_ID,
        masterArchiveArtifactId: MASTER_ARCHIVE_ARTIFACT_ID,
        masterArchiveExactSetKey: set.exactSetKey,
        masterArchiveSetId: set.id,
        masterArchiveRecordedRows: set.checklistRowsMaximum,
        sourceAttempts: failures.slice(0, 12),
      },
    });
  }
  return {
    id: set.id,
    exactSetKey: set.exactSetKey,
    status: "quarantined",
    recordedRows: set.checklistRowsMaximum,
    failures: failures.slice(0, 12),
  };
}

async function parallelMap(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, values.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  }));
  return output;
}

async function main() {
  const batch = JSON.parse(readFileSync(resolve(CORPUS_ROOT, `batch-${BATCH_INDEX}.json`), "utf8"));
  const sets = batch.sets || [];
  const db = dbClient();
  await ensureArchiveBucket(db);
  const state = await catalogState(db, sets.flatMap((set) => (set.candidates || []).map((candidate) => candidate.sourceUrl)));
  const startedAt = new Date().toISOString();
  const results = await parallelMap(sets, WORKERS, (set) => processSet(db, set, state));
  const statuses = {};
  const totals = { sets: 0, cards: 0, parallels: 0, identities: 0 };
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    for (const key of Object.keys(totals)) totals[key] += Number(result.counts?.[key] || 0);
  }
  writeReceipt({
    schema: "tcos.checklist.masterArchiveBatchReceipt.v1",
    masterRunId: MASTER_RUN_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "validate",
    batch: { index: BATCH_INDEX, count: batch.count, selected: sets.length },
    workers: WORKERS,
    statuses,
    normalizedTotals: totals,
    results,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
