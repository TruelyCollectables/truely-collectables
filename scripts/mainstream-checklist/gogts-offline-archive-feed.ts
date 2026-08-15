import { createHash } from "node:crypto";
import { basename, extname, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { importChecklistArtifact } from "../../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../../src/lib/checklist-registry/source-adapter";

const INPUT = resolve(process.cwd(), process.env.GOGTS_OFFLINE_INPUT || "tmp/gogts-offline-queue.json");
const OUTPUT = resolve(process.cwd(), process.env.GOGTS_OFFLINE_OUTPUT || "tmp/gogts-offline-receipt.json");
const APPLY = process.env.GOGTS_OFFLINE_APPLY === "true";
const MAX = Math.max(1, Number(process.env.GOGTS_OFFLINE_MAX || 2200));
const MIN_ROWS = Math.max(25, Number(process.env.GOGTS_OFFLINE_MIN_ROWS || 25));

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Offline GoGTS feed requires Production Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function yearOf(value: unknown) {
  const m = String(value || "").match(/(?:19|20)\d{2}/);
  return m ? m[0] : "";
}

function mimeFromPath(path: string) {
  const e = extname(path).toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".xls") return "application/vnd.ms-excel";
  if (e === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (e === ".csv") return "text/csv";
  return "application/octet-stream";
}

async function loadMasterState(db: ReturnType<typeof dbClient>) {
  const state = new Map<string, { imported: boolean }>();
  for (let start = 0; start < 12000; start += 1000) {
    const { data, error } = await db
      .from("checklist_source_catalog")
      .select("status,metadata")
      .range(start, start + 999);
    if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);
    for (const row of data || []) {
      const key = String((row as any)?.metadata?.masterArchiveExactSetKey || (row as any)?.metadata?.exactSetKey || "").toLowerCase();
      if (!key || key.split("|").length !== 4) continue;
      const current = state.get(key) || { imported: false };
      current.imported ||= (row as any).status === "imported";
      state.set(key, current);
    }
    if (!data || data.length < 1000) break;
  }
  return state;
}

function issueSummary(plan: any) {
  return (plan?.validation?.issues || []).slice(0, 50).map((value: any) => ({
    code: String(value.code || "validation_issue"),
    severity: String(value.severity || "error"),
    message: String(value.message || "").slice(0, 500),
  }));
}

async function upsertCatalog(db: ReturnType<typeof dbClient>, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

async function main() {
  const parsed = JSON.parse(readFileSync(INPUT, "utf8"));
  const queue = (Array.isArray(parsed) ? parsed : parsed.candidates || []).slice(0, MAX);
  const db = dbClient();
  const master = await loadMasterState(db);
  const startedAt = new Date().toISOString();
  const results: any[] = [];

  for (const candidate of queue) {
    const exactSetKey = String(candidate.exactSetKey || "").toLowerCase();
    const localPath = resolve(String(candidate.localPath || ""));
    const sourceUrl = String(candidate.sourceUrl || candidate.articleUrl || "");
    const checkedAt = new Date().toISOString();

    try {
      if (!exactSetKey || exactSetKey.split("|").length !== 4) throw new Error("missing exactSetKey");
      if (!master.has(exactSetKey)) {
        results.push({ exactSetKey, sourceUrl, status: "skipped", reason: "not_in_current_master_catalog" });
        continue;
      }
      if (master.get(exactSetKey)?.imported) {
        results.push({ exactSetKey, sourceUrl, status: "already_imported" });
        continue;
      }
      if (!sourceUrl.startsWith("https://gogts.net/")) throw new Error("unexpected GoGTS attribution URL");

      const bytes = readFileSync(localPath);
      if (bytes.byteLength < 128) throw new Error(`archived source too small (${bytes.byteLength} bytes)`);
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      const [sport, season, manufacturer, product] = exactSetKey.split("|");
      const artifact: ChecklistSourceArtifact = {
        sourceUrl,
        originalFilename: basename(localPath),
        mimeType: mimeFromPath(localPath),
        content: new Uint8Array(bytes),
        retrievedAt: new Date().toISOString(),
        authority: "approved_reference_dataset",
        redistributionAllowed: false,
        targetContext: {
          targetKey: exactSetKey,
          sport,
          season,
          year: yearOf(season),
          manufacturer,
          product,
        },
      };

      const validation = await importChecklistArtifact({ artifact, validateOnly: true });
      const plan = validation.plan;
      const counts = plan.validation.counts;
      if (!validation.ok || plan.validation.status !== "passed" || Number(counts.cards || 0) < MIN_ROWS) {
        await upsertCatalog(db, {
          manufacturer: plan.release.manufacturer || manufacturer,
          sport: plan.release.sport || sport,
          source_url: sourceUrl,
          source_sha256: sourceSha256,
          release_slug: plan.release.releaseSlug,
          release_name: `${plan.release.season || plan.release.releaseYear || season} ${plan.release.product || product}`.trim(),
          adapter_id: validation.adapter.id,
          adapter_version: validation.adapter.version,
          status: "quarantined",
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          validation_counts: counts,
          issue_summary: issueSummary(plan),
          metadata: {
            masterArchiveExactSetKey: exactSetKey,
            gogtsOfflineArchive: true,
            masterArchiveRunId: "31100986894",
            archivedLocalFilename: basename(localPath),
          },
        });
        results.push({ exactSetKey, sourceUrl, status: "quarantined", reason: "targeted_validation_failed", counts });
        continue;
      }

      if (!APPLY) {
        results.push({ exactSetKey, sourceUrl, status: "validated", counts });
        continue;
      }

      const applied = await importChecklistArtifact({ artifact, validateOnly: false });
      const appliedCounts = applied.plan.validation.counts;
      if (!applied.ok || applied.plan.validation.status !== "passed" || Number(appliedCounts.cards || 0) < MIN_ROWS) {
        results.push({ exactSetKey, sourceUrl, status: "failed", reason: "apply_validation_failed", counts: appliedCounts });
        continue;
      }

      const persistence: any = applied.persistence || null;
      const imported = !applied.validatedOnly;
      const netNew = imported && persistence?.idempotent !== true;
      await upsertCatalog(db, {
        manufacturer: applied.plan.release.manufacturer || manufacturer,
        sport: applied.plan.release.sport || sport,
        source_url: sourceUrl,
        source_sha256: sourceSha256,
        release_slug: applied.plan.release.releaseSlug,
        release_name: `${applied.plan.release.season || applied.plan.release.releaseYear || season} ${applied.plan.release.product || product}`.trim(),
        adapter_id: applied.adapter.id,
        adapter_version: applied.adapter.version,
        status: imported ? "imported" : "validated",
        imported_at: imported ? checkedAt : null,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: appliedCounts,
        issue_summary: issueSummary(applied.plan),
        metadata: {
          masterArchiveExactSetKey: exactSetKey,
          gogtsOfflineArchive: true,
          masterArchiveRunId: "31100986894",
          archivedLocalFilename: basename(localPath),
        },
      });
      if (imported) master.set(exactSetKey, { imported: true });
      results.push({ exactSetKey, sourceUrl, status: imported ? "imported" : "validated", counts: appliedCounts, persistence, netNew });
    } catch (caught) {
      results.push({
        exactSetKey,
        sourceUrl,
        status: "failed",
        message: (caught instanceof Error ? caught.message : String(caught)).slice(0, 700),
      });
    }
  }

  const statuses: Record<string, number> = {};
  for (const result of results) statuses[result.status] = (statuses[result.status] || 0) + 1;
  const receipt = {
    schema: "tcos.checklist.gogtsOfflineArchiveFeedReceipt.v1",
    mode: APPLY ? "apply" : "validate",
    startedAt,
    completedAt: new Date().toISOString(),
    candidates: queue.length,
    processed: results.length,
    statuses,
    imported: results.filter((r) => r.status === "imported").length,
    netNew: results.filter((r) => r.status === "imported" && r.netNew === true).length,
    idempotent: results.filter((r) => r.status === "imported" && r.persistence?.idempotent === true).length,
    results,
  };
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ candidates: receipt.candidates, processed: receipt.processed, statuses, imported: receipt.imported, netNew: receipt.netNew, idempotent: receipt.idempotent }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
