import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadMainstreamChecklistManifest } from "./mainstream-checklist/manifest.mjs";
import {
  downloadAndParse,
  runParserSelfTest,
} from "./mainstream-checklist/source-tools.mjs";
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

const OUTPUT = resolve(
  process.cwd(),
  process.env.MAINSTREAM_CHECKLIST_OUTPUT ||
    ".checklist-discovery/mainstream-backlog-receipt.json",
);
const APPLY = process.env.MAINSTREAM_CHECKLIST_APPLY !== "false";
const SELF_TEST = process.env.MAINSTREAM_CHECKLIST_SELF_TEST === "true";
const RECONCILE_ONLY = process.env.MAINSTREAM_CHECKLIST_RECONCILE_ONLY === "true";
const BATCH_INDEX = Math.max(0, Number(process.env.MAINSTREAM_CHECKLIST_BATCH_INDEX || 0));
const BATCH_COUNT = Math.max(1, Number(process.env.MAINSTREAM_CHECKLIST_BATCH_COUNT || 1));
const WORKERS = Math.max(1, Math.min(6, Number(process.env.MAINSTREAM_CHECKLIST_WORKERS || 3)));

const REGISTRY_ARCHIVE_MIME_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
  "application/pdf",
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function registrySource(downloaded) {
  if (REGISTRY_ARCHIVE_MIME_TYPES.has(downloaded.source.mimeType)) {
    return downloaded.source;
  }
  const bytes = Buffer.from(`<pre>${escapeHtml(downloaded.text)}</pre>`, "utf8");
  return {
    ...downloaded.source,
    bytes,
    mimeType: "text/html",
    filename: `${downloaded.source.filename}.normalized.html`,
    derivedNormalizedSource: true,
  };
}

function writeReceipt(value) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(value, null, 2));
}

async function processEntry(db, entry) {
  const checkedAt = new Date().toISOString();
  let downloaded = null;
  let archive = null;
  const baseMetadata = {
    backlogSchema: "tcos.instacomp.mainstreamChecklistBacklog.v1",
    backlogId: entry.id,
    disposition: entry.disposition,
    exactSetKey: entry.release.exactSetKey,
    sourceName: entry.sourceName,
  };
  try {
    downloaded = await downloadAndParse(entry);
    archive = await uploadArchive(db, downloaded.source);
    if (downloaded.landingPage) await uploadArchive(db, downloaded.landingPage);

    const { data: existing, error: existingError } = await db
      .from("checklist_source_catalog")
      .select("status,source_sha256")
      .eq("source_url", entry.sourceUrl)
      .maybeSingle();
    if (existingError) throw new Error(`Could not read source catalog: ${existingError.message}`);

    if (
      ["imported", "unchanged"].includes(existing?.status || "") &&
      existing?.source_sha256 === archive.digest
    ) {
      await upsertCatalog(db, {
        manufacturer: entry.release.manufacturer,
        sport: entry.release.sport,
        source_url: entry.sourceUrl,
        source_sha256: archive.digest,
        status: existing.status === "imported" ? "imported" : "unchanged",
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        metadata: {
          ...baseMetadata,
          rawArchived: true,
          archiveBucket: ARCHIVE_BUCKET,
          archiveObjectPath: archive.objectPath,
          selectedUrl: downloaded.source.selectedUrl,
        },
      });
      return { id: entry.id, sourceUrl: entry.sourceUrl, status: "unchanged" };
    }

    if (entry.disposition === "attachment_only") {
      const issue = {
        code: "mainstream_attachment_only",
        severity: "warning",
        message:
          "Source is a supplement, variation guide, alias, or parent-release attachment and must not create a standalone Registry release.",
      };
      await upsertCatalog(db, {
        manufacturer: entry.release.manufacturer,
        sport: entry.release.sport,
        source_url: entry.sourceUrl,
        source_sha256: archive.digest,
        release_name: entry.release.canonicalName,
        status: "quarantined",
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: {
          sets: 0,
          cards: downloaded.parsed.cards.length,
          parallels: downloaded.parsed.parallels.length,
          identities: 0,
        },
        issue_summary: [issue],
        metadata: {
          ...baseMetadata,
          rawArchived: true,
          archiveBucket: ARCHIVE_BUCKET,
          archiveObjectPath: archive.objectPath,
          selectedUrl: downloaded.source.selectedUrl,
          attachmentCardRowsObserved: downloaded.parsed.cards.length,
        },
      });
      return {
        id: entry.id,
        sourceUrl: entry.sourceUrl,
        status: "attachment_only",
        archived: true,
      };
    }

    const registryArtifact = registrySource(downloaded);
    const plan = buildPlan(entry, downloaded.parsed, registryArtifact, checkedAt);
    const complexity = assertPlanComplexity(plan);
    const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
    const common = {
      manufacturer: plan.release.manufacturer,
      sport: plan.release.sport,
      source_url: entry.sourceUrl,
      source_sha256: archive.digest,
      release_slug: plan.release.releaseSlug,
      release_name: entry.release.canonicalName,
      adapter_id: plan.adapterId,
      adapter_version: plan.adapterVersion,
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      validation_counts: plan.validation.counts,
      issue_summary: limitedIssues(plan.validation.issues),
      metadata: {
        ...baseMetadata,
        rawArchived: true,
        archiveBucket: ARCHIVE_BUCKET,
        archiveObjectPath: archive.objectPath,
        selectedUrl: downloaded.source.selectedUrl,
        finalUrl: downloaded.source.finalUrl,
        sourceMimeType: downloaded.source.mimeType,
        sourceSizeBytes: downloaded.source.bytes.byteLength,
        registrySourceMimeType: registryArtifact.mimeType,
        registrySourceDerived: registryArtifact.derivedNormalizedSource === true,
        extractedTextBytes: Buffer.byteLength(downloaded.text, "utf8"),
        planBytes: complexity.serializedBytes,
      },
    };

    if (errors.length || plan.validation.status !== "passed") {
      await upsertCatalog(db, { ...common, status: "quarantined" });
      return {
        id: entry.id,
        sourceUrl: entry.sourceUrl,
        status: "quarantined",
        counts: plan.validation.counts,
        errors: limitedIssues(errors),
      };
    }

    if (!APPLY) {
      await upsertCatalog(db, { ...common, status: "validated" });
      return {
        id: entry.id,
        sourceUrl: entry.sourceUrl,
        status: "validated",
        counts: plan.validation.counts,
      };
    }

    const persistence = await persistPlan(db, plan, registryArtifact.bytes);
    await upsertCatalog(db, {
      ...common,
      status: "imported",
      imported_at: checkedAt,
    });
    return {
      id: entry.id,
      sourceUrl: entry.sourceUrl,
      status: "imported",
      counts: plan.validation.counts,
      persistence,
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    const status = archive ? "quarantined" : "failed";
    await upsertCatalog(db, {
      manufacturer: entry.release.manufacturer,
      sport: entry.release.sport,
      source_url: entry.sourceUrl,
      source_sha256: archive?.digest || null,
      release_name: entry.release.canonicalName,
      status,
      last_seen_at: checkedAt,
      last_checked_at: checkedAt,
      issue_summary: [
        {
          code: archive
            ? "mainstream_backlog_normalization_quarantined"
            : "mainstream_backlog_ingest_failure",
          severity: "error",
          message: message.slice(0, 500),
        },
      ],
      metadata: {
        ...baseMetadata,
        rawArchived: Boolean(archive),
        archiveBucket: archive ? ARCHIVE_BUCKET : null,
        archiveObjectPath: archive?.objectPath || null,
        selectedUrl: downloaded?.source?.selectedUrl || null,
      },
    });
    return { id: entry.id, sourceUrl: entry.sourceUrl, status, message };
  }
}

async function parallelMap(values, concurrency, worker) {
  const output = new Array(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(1, values.length)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        output[index] = await worker(values[index], index);
      }
    },
  );
  await Promise.all(runners);
  return output;
}

async function reconcile(db, manifest) {
  const urls = manifest.entries.map((entry) => entry.sourceUrl);
  const rows = [];
  for (let index = 0; index < urls.length; index += 100) {
    const group = urls.slice(index, index + 100);
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("source_url,status,validation_counts,metadata,issue_summary")
      .in("source_url", group);
    if (error) throw new Error(`Could not reconcile source catalog: ${error.message}`);
    rows.push(...(data || []));
  }
  const byUrl = new Map(rows.map((row) => [row.source_url, row]));
  const missing = urls.filter((url) => !byUrl.has(url));
  const statuses = {};
  let rawArchived = 0;
  let cards = 0;
  let identities = 0;
  for (const row of rows) {
    statuses[row.status] = (statuses[row.status] || 0) + 1;
    if (row.metadata?.rawArchived === true) rawArchived += 1;
    cards += Number(row.validation_counts?.cards || 0);
    identities += Number(row.validation_counts?.identities || 0);
  }
  const receipt = {
    schema: "tcos.checklist.mainstreamBacklogReconciliation.v1",
    checkedAt: new Date().toISOString(),
    expectedSources: urls.length,
    catalogRows: rows.length,
    rawArchived,
    statuses,
    normalizedTotals: { cards, identities },
    missing,
    complete:
      rows.length === urls.length &&
      rawArchived === urls.length &&
      Number(statuses.failed || 0) === 0,
  };
  writeReceipt(receipt);
  if (!receipt.complete) process.exitCode = 1;
}

async function main() {
  if (SELF_TEST) {
    console.log(JSON.stringify(runParserSelfTest()));
    return;
  }

  const manifest = loadMainstreamChecklistManifest();
  const db = dbClient();
  await ensureArchiveBucket(db);
  if (RECONCILE_ONLY) {
    await reconcile(db, manifest);
    return;
  }

  const selected = manifest.entries.filter(
    (entry, index) => index % BATCH_COUNT === BATCH_INDEX,
  );
  const startedAt = new Date().toISOString();
  const results = await parallelMap(selected, WORKERS, (entry) =>
    processEntry(db, entry),
  );
  const statuses = {};
  const totals = { sets: 0, cards: 0, parallels: 0, identities: 0 };
  for (const result of results) {
    statuses[result.status] = (statuses[result.status] || 0) + 1;
    for (const key of Object.keys(totals)) {
      totals[key] += Number(result.counts?.[key] || 0);
    }
  }
  writeReceipt({
    schema: "tcos.checklist.mainstreamBacklogBatchReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "validate",
    batch: { index: BATCH_INDEX, count: BATCH_COUNT, selected: selected.length },
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
