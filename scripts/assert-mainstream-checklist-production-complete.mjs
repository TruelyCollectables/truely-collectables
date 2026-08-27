import { createClient } from "@supabase/supabase-js";
import { loadMainstreamChecklistManifest } from "./mainstream-checklist/manifest.mjs";
import { isVerifiedNonPromotable } from "./mainstream-checklist/verified-exceptions.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Production completion proof requires Supabase service-role access.");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const manifest = loadMainstreamChecklistManifest();
const rows = [];
const urls = manifest.entries.map((entry) => entry.sourceUrl);
for (let index = 0; index < urls.length; index += 100) {
  const { data, error } = await db
    .from("checklist_source_catalog")
    .select("source_url,status,release_slug,validation_counts,issue_summary,metadata")
    .in("source_url", urls.slice(index, index + 100));
  if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
  rows.push(...(data || []));
}

const byUrl = new Map(rows.map((row) => [row.source_url, row]));
const failures = [];
const counts = { imported: 0, unchanged: 0, attachments: 0, cards: 0, identities: 0 };

for (const entry of manifest.entries) {
  const row = byUrl.get(entry.sourceUrl);
  if (!row) {
    failures.push({ id: entry.id, code: "missing_catalog_row" });
    continue;
  }
  if (row.metadata?.rawArchived !== true) {
    failures.push({ id: entry.id, code: "raw_source_not_archived", status: row.status });
  }

  const attachmentOnly = entry.disposition === "attachment_only" || isVerifiedNonPromotable(entry);
  if (attachmentOnly) {
    counts.attachments += 1;
    const issueCodes = new Set((row.issue_summary || []).map((issue) => issue.code));
    if (row.status !== "quarantined" || !issueCodes.has("mainstream_attachment_only")) {
      failures.push({ id: entry.id, code: "attachment_not_classified", status: row.status });
    }
    continue;
  }

  if (!new Set(["imported", "unchanged"]).has(row.status)) {
    failures.push({
      id: entry.id,
      code: "confirmed_checklist_not_promoted",
      status: row.status,
      issues: (row.issue_summary || []).slice(0, 3),
    });
    continue;
  }

  counts[row.status] += 1;
  const minimum = Math.max(1, Number(entry.minimumCardRows || 3));
  const cards = Number(row.validation_counts?.cards || 0);
  const identities = Number(row.validation_counts?.identities || 0);
  if (cards < minimum || identities < cards) {
    failures.push({
      id: entry.id,
      code: "promoted_counts_below_contract",
      cards,
      identities,
      minimum,
    });
  }
  counts.cards += cards;
  counts.identities += identities;
}

if (manifest.entries.length !== 327) failures.push({ code: "manifest_count_changed", count: manifest.entries.length });
if (counts.attachments !== 8) failures.push({ code: "attachment_count_changed", count: counts.attachments, expected: 8 });
if (counts.imported + counts.unchanged !== 319) {
  failures.push({
    code: "promoted_source_count_mismatch",
    promoted: counts.imported + counts.unchanged,
    expected: 319,
  });
}

const proof = {
  schema: "tcos.checklist.mainstreamBacklogPromotionProof.v2",
  checkedAt: new Date().toISOString(),
  expectedSources: 327,
  expectedPromotedSources: 319,
  expectedAttachmentOnly: 8,
  catalogRows: rows.length,
  counts,
  complete: failures.length === 0,
  failures: failures.slice(0, 100),
};
console.log(JSON.stringify(proof, null, 2));
if (!proof.complete) process.exitCode = 1;
