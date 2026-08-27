import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { dbClient } from "./mainstream-checklist/registry-tools.mjs";

const CORPUS_ROOT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const OUTPUT = resolve(process.cwd(), process.env.MASTER_CHECKLIST_RECONCILIATION_OUTPUT || ".checklist-discovery/master-archive-reconciliation.json");

function writeReceipt(value) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(value, null, 2));
}

async function catalogRows(db, urls) {
  const rows = [];
  const unique = [...new Set(urls.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 80) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("source_url,status,release_name,validation_counts,issue_summary,metadata,last_checked_at")
      .in("source_url", unique.slice(index, index + 80));
    if (error) throw new Error(`Could not reconcile source catalog: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

async function main() {
  const manifest = JSON.parse(readFileSync(resolve(CORPUS_ROOT, "manifest.json"), "utf8"));
  if (manifest.sets.length !== 5643) throw new Error(`Master corpus expected 5,643 audited sets, found ${manifest.sets.length}.`);
  const db = dbClient();
  const rows = await catalogRows(db, manifest.sets.flatMap((set) => (set.candidates || []).map((candidate) => candidate.sourceUrl)));
  const byUrl = new Map(rows.map((row) => [row.source_url, row]));

  const statusCounts = {};
  const unresolved = [];
  const covered = [];
  let cards = 0;
  let identities = 0;
  for (const set of manifest.sets) {
    statusCounts[set.disposition] = (statusCounts[set.disposition] || 0) + 1;
    if (set.disposition !== "import") continue;
    const matches = (set.candidates || [])
      .map((candidate) => ({ candidate, row: byUrl.get(candidate.sourceUrl) }))
      .filter((value) => value.row && ["imported", "unchanged"].includes(value.row.status));
    if (!matches.length) {
      unresolved.push({
        id: set.id,
        exactSetKey: set.exactSetKey,
        sport: set.sport,
        season: set.season,
        manufacturer: set.manufacturer,
        product: set.product,
        recordedRows: set.checklistRowsMaximum,
        candidates: (set.candidates || []).slice(0, 5).map((candidate) => {
          const row = byUrl.get(candidate.sourceUrl);
          return {
            source: candidate.source,
            sourceUrl: candidate.sourceUrl,
            recordedRows: candidate.checklistRows,
            status: row?.status || "missing_catalog_row",
            counts: row?.validation_counts || null,
            issues: (row?.issue_summary || []).slice(0, 3),
            lastCheckedAt: row?.last_checked_at || null,
          };
        }),
      });
      continue;
    }
    const best = matches.sort((a, b) => Number(b.row.validation_counts?.cards || 0) - Number(a.row.validation_counts?.cards || 0))[0];
    cards += Number(best.row.validation_counts?.cards || 0);
    identities += Number(best.row.validation_counts?.identities || 0);
    covered.push({ id: set.id, exactSetKey: set.exactSetKey, source: best.candidate.source, status: best.row.status, cards: Number(best.row.validation_counts?.cards || 0) });
  }

  const expectedImport = Number(manifest.counts?.import || 0);
  const receipt = {
    schema: "tcos.checklist.masterArchiveReconciliation.v1",
    checkedAt: new Date().toISOString(),
    masterRunId: manifest.sourceRunId,
    auditedSets: manifest.sets.length,
    dispositionCounts: manifest.counts,
    expectedArchiveBearingSets: expectedImport,
    promotedArchiveBearingSets: covered.length,
    remainingArchiveBearingSets: unresolved.length,
    promotedTotals: { cards, identities },
    gapPending: Number(manifest.counts?.gap_pending || 0),
    aggregateIndexes: Number(manifest.counts?.aggregate_index || 0),
    nameReview: Number(manifest.counts?.needs_name_review || 0),
    complete: covered.length === expectedImport && unresolved.length === 0,
    unresolved: unresolved.slice(0, 500),
  };
  writeReceipt(receipt);
  if (!receipt.complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
