import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dbClient } from "./mainstream-checklist/registry-tools.mjs";

const corpusRoot = resolve(process.cwd(), process.env.MASTER_CHECKLIST_CORPUS_ROOT || ".master-checklist-corpus");
const output = resolve(process.cwd(), process.env.MASTER_CHECKLIST_RECONCILIATION_OUTPUT || ".checklist-discovery/master-archive-reconciliation-v4.json");
function writeReceipt(value) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, "utf8"); console.log(JSON.stringify(value, null, 2)); }
async function catalogRows(db, urls) {
  const rows = [], unique = [...new Set(urls.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 80) {
    const { data, error } = await db.from("checklist_source_catalog").select("source_url,status,release_name,validation_counts,issue_summary,metadata,last_checked_at").in("source_url", unique.slice(index, index + 80));
    if (error) throw new Error(`Could not reconcile source catalog: ${error.message}`);
    rows.push(...(data || []));
  }
  return rows;
}

async function main() {
  const manifest = JSON.parse(readFileSync(resolve(corpusRoot, "manifest.json"), "utf8"));
  const fp = manifest.originalCorpusFingerprint || {};
  if (fp.auditedSets !== 5643 || fp.archiveBearingSetKeys !== 5268 || fp.sourceRunId !== "31100986894") throw new Error(`Reconciliation corpus lost frozen provenance: ${JSON.stringify(fp)}.`);
  if ((manifest.sets || []).length !== 5548) throw new Error(`Reconciliation expected 5,548 sanitized records, found ${manifest.sets?.length || 0}.`);
  if (Number(manifest.counts?.import || 0) !== 5098 || Number(manifest.counts?.alias_of || 0) !== 62) throw new Error(`Reconciliation canonical/alias fingerprint changed: ${manifest.counts?.import || 0}/${manifest.counts?.alias_of || 0}.`);

  const importSets = manifest.sets.filter((set) => set.disposition === "import");
  const db = dbClient();
  const rows = await catalogRows(db, importSets.flatMap((set) => (set.candidates || []).map((candidate) => candidate.sourceUrl)));
  const byUrl = new Map(rows.map((row) => [row.source_url, row]));
  const unresolved = [], covered = [];
  let cards = 0, identities = 0;

  for (const set of importSets) {
    const matches = (set.candidates || []).map((candidate) => ({ candidate, row: byUrl.get(candidate.sourceUrl) })).filter(({ row }) =>
      row && ["imported", "unchanged"].includes(row.status) && row.metadata?.masterArchiveRunId === "31100986894" && row.metadata?.masterArchiveExactSetKey === set.exactSetKey
    );
    if (!matches.length) {
      unresolved.push({ id: set.id, exactSetKey: set.exactSetKey, sport: set.sport, season: set.season, manufacturer: set.manufacturer, product: set.product, recordedRows: set.checklistRowsMaximum, aliases: set.aliasExactSetKeys || [], candidates: (set.candidates || []).slice(0, 8).map((candidate) => { const row = byUrl.get(candidate.sourceUrl); return { source: candidate.source, sourceUrl: candidate.sourceUrl, sourceChecklistRows: candidate.sourceChecklistRows ?? null, validationChecklistRows: candidate.validationChecklistRows ?? candidate.checklistRows ?? null, status: row?.status || "missing_catalog_row", catalogExactSetKey: row?.metadata?.masterArchiveExactSetKey || null, catalogMasterRunId: row?.metadata?.masterArchiveRunId || null, counts: row?.validation_counts || null, issues: (row?.issue_summary || []).slice(0, 3), lastCheckedAt: row?.last_checked_at || null }; }) });
      continue;
    }
    const best = matches.sort((a, b) => Number(b.row.validation_counts?.cards || 0) - Number(a.row.validation_counts?.cards || 0))[0];
    cards += Number(best.row.validation_counts?.cards || 0); identities += Number(best.row.validation_counts?.identities || 0);
    covered.push({ id: set.id, exactSetKey: set.exactSetKey, source: best.candidate.source, sourceUrl: best.candidate.sourceUrl, status: best.row.status, cards: Number(best.row.validation_counts?.cards || 0), identities: Number(best.row.validation_counts?.identities || 0), aliases: set.aliasExactSetKeys || [] });
  }

  const receipt = { schema: "tcos.checklist.masterArchiveReconciliation.v4.final", checkedAt: new Date().toISOString(), frozenSourceRunId: fp.sourceRunId, originalAuditedSetKeys: fp.auditedSets, originalArchiveBearingSetKeys: fp.archiveBearingSetKeys, sanitizedSetRecords: manifest.sets.length, dispositionCounts: manifest.counts, expectedCanonicalImportSets: importSets.length, promotedCanonicalImportSets: covered.length, remainingCanonicalImportSets: unresolved.length, resolvedAliasSets: Number(manifest.counts?.alias_of || 0), promotedTotals: { cards, identities }, exactSanitizedProvenanceRequired: true, complete: covered.length === importSets.length && unresolved.length === 0, unresolved: unresolved.slice(0, 500) };
  writeReceipt(receipt); if (!receipt.complete) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1; });
