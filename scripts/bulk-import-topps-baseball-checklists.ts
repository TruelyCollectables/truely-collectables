import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const APPLY = process.env.TOPPS_BASEBALL_BULK_APPLY === "true";
const MAX_SOURCES = Math.max(1, Math.min(500, Number(process.env.TOPPS_BASEBALL_BULK_MAX_SOURCES || 100)));
const OUTPUT = resolve(process.cwd(), process.env.TOPPS_BASEBALL_BULK_OUTPUT || ".checklist-discovery/topps-baseball-bulk-import-receipt.json");
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/topps-baseball-tmp");
const ALLOWED_STATUSES = (process.env.TOPPS_BASEBALL_BULK_STATUSES || "discovered,validated,quarantined,failed").split(",").map((value) => value.trim()).filter(Boolean);

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Topps baseball bulk import requires Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }

function cleanFilename(sourceUrl: string, fallback: string) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const value = pathname.split("/").filter(Boolean).at(-1);
    if (value) return decodeURIComponent(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
  } catch { /* use fallback */ }
  return `${fallback.replace(/[^a-zA-Z0-9._-]+/g, "-") || "topps-checklist"}.bin`;
}

function normalizedMimeType(sourceUrl: string, header: string) {
  const type = header.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const extension = extname(new URL(sourceUrl).pathname).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".csv") return "text/csv";
  if (extension === ".txt") return "text/plain";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".xls") return "application/vnd.ms-excel";
  return type || "application/octet-stream";
}

async function download(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "application/pdf,text/plain,text/csv,text/html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": "TCOS-Topps-Baseball-Bulk-Importer/1.0 (+private registry automation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Downloaded checklist was empty.");
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error(`Checklist exceeds the 50 MiB source limit (${bytes.byteLength} bytes).`);
  return { bytes, mimeType: normalizedMimeType(response.url || sourceUrl, response.headers.get("content-type") || "") };
}

function htmlToText(value: string) {
  return value
    .replace(/<\/?(?:p|div|li|tr|h[1-6]|br|section|article|table|tbody|thead)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&reg;/gi, "®")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractText(params: { bytes: Uint8Array; mimeType: string; filename: string }) {
  if (params.mimeType === "application/pdf") {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const filePath = resolve(TEMP_ROOT, params.filename.replace(/\.pdf$/i, "") + ".pdf");
    writeFileSync(filePath, params.bytes);
    try {
      return execFileSync("pdftotext", ["-layout", "-nopgbrk", filePath, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }).trim();
    } finally {
      rmSync(filePath, { force: true });
    }
  }
  const decoded = Buffer.from(params.bytes).toString("utf8");
  if (params.mimeType === "text/html") return htmlToText(decoded);
  if (params.mimeType === "text/plain" || params.mimeType === "text/csv") return decoded.trim();
  throw new Error(`Unsupported checklist extraction format: ${params.mimeType}`);
}

function limitedIssues(values: Array<{ code: string; severity: string; message: string }>) {
  return values.slice(0, 100).map((value) => ({ code: value.code, severity: value.severity, message: value.message.slice(0, 500) }));
}

async function updateCatalog(db: ReturnType<typeof dbClient>, sourceUrl: string, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").update(values).eq("source_url", sourceUrl);
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

async function main() {
  const db = dbClient();
  const startedAt = new Date().toISOString();
  const { data: rows, error } = await db
    .from("checklist_source_catalog")
    .select("source_url,source_sha256,release_name,status,metadata,adapter_id,adapter_version")
    .eq("manufacturer", "Topps")
    .eq("sport", "Baseball")
    .in("status", ALLOWED_STATUSES)
    .order("last_seen_at", { ascending: false })
    .limit(MAX_SOURCES);
  if (error) throw new Error(`Could not read checklist source catalog: ${error.message}`);

  const results: Array<Record<string, unknown>> = [];
  const totals = { selected: rows?.length || 0, downloaded: 0, unchanged: 0, validated: 0, imported: 0, quarantined: 0, failed: 0, sets: 0, cards: 0, parallels: 0, identities: 0 };

  for (const row of rows || []) {
    const checkedAt = new Date().toISOString();
    const sourceUrl = String(row.source_url);
    const releaseName = String(row.release_name || "Topps Baseball Checklist");
    try {
      const downloaded = await download(sourceUrl);
      totals.downloaded += 1;
      const digest = sha256(downloaded.bytes);
      if (row.status === "imported" && row.source_sha256 === digest) {
        totals.unchanged += 1;
        results.push({ sourceUrl, releaseName, status: "unchanged", sha256: digest });
        await updateCatalog(db, sourceUrl, { last_seen_at: checkedAt, last_checked_at: checkedAt });
        continue;
      }

      const filename = cleanFilename(sourceUrl, releaseName);
      const text = extractText({ bytes: downloaded.bytes, mimeType: downloaded.mimeType, filename });
      if (text.length < 50) throw new Error(`Checklist extraction produced only ${text.length} characters.`);

      const artifact: ChecklistSourceArtifact = {
        sourceUrl,
        originalFilename: `${releaseName.replace(/[^a-zA-Z0-9._-]+/g, "-")}.txt`,
        mimeType: "text/plain",
        content: text,
        archiveContent: downloaded.bytes,
        archiveFilename: filename,
        archiveMimeType: downloaded.mimeType,
        retrievedAt: checkedAt,
        authority: "official_manufacturer",
        redistributionAllowed: false,
      };
      const validation = await importChecklistArtifact({ artifact, validateOnly: true });
      const validationErrors = validation.plan.validation.issues.filter((issue) => issue.severity === "error");
      const counts = validation.plan.validation.counts;
      const common = {
        source_sha256: digest,
        release_slug: validation.plan.release.releaseSlug,
        release_name: [validation.plan.release.releaseYear, validation.plan.release.product].filter(Boolean).join(" "),
        adapter_id: validation.adapter.id,
        adapter_version: validation.adapter.version,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: counts,
        issue_summary: limitedIssues(validation.plan.validation.issues),
        metadata: {
          ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
          originalMimeType: downloaded.mimeType,
          originalFilename: filename,
          extractedTextBytes: Buffer.byteLength(text, "utf8"),
          sourceSizeBytes: downloaded.bytes.byteLength,
          bulkImporter: "topps-baseball-v1",
        },
      };

      if (!validation.ok || validationErrors.length) {
        totals.quarantined += 1;
        await updateCatalog(db, sourceUrl, { ...common, status: "quarantined" });
        results.push({ sourceUrl, releaseName, status: "quarantined", counts, errors: limitedIssues(validationErrors) });
        continue;
      }

      totals.validated += 1;
      if (!APPLY) {
        await updateCatalog(db, sourceUrl, { ...common, status: "validated" });
        results.push({ sourceUrl, releaseName, status: "validated", counts });
        continue;
      }

      const imported = await importChecklistArtifact({ artifact });
      if (!imported.ok || imported.validatedOnly) throw new Error("Validated checklist did not complete Registry persistence.");
      totals.imported += 1;
      totals.sets += counts.sets;
      totals.cards += counts.cards;
      totals.parallels += counts.parallels;
      totals.identities += counts.identities;
      await updateCatalog(db, sourceUrl, { ...common, status: "imported", imported_at: checkedAt });
      results.push({ sourceUrl, releaseName, status: "imported", counts, persistence: imported.persistence });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const unsupported = /Unsupported checklist extraction format/.test(message);
      if (unsupported) totals.quarantined += 1;
      else totals.failed += 1;
      await updateCatalog(db, sourceUrl, {
        status: unsupported ? "quarantined" : "failed",
        last_checked_at: checkedAt,
        issue_summary: [{ code: unsupported ? "topps_baseball_extractor_required" : "topps_baseball_bulk_import_failure", severity: "error", message: message.slice(0, 500) }],
      });
      results.push({ sourceUrl, releaseName, status: unsupported ? "quarantined" : "failed", message });
    }
  }

  const receipt = { schema: "tcos.checklist.toppsBaseballBulkImportReceipt.v1", startedAt, completedAt: new Date().toISOString(), mode: APPLY ? "apply" : "validate", statuses: ALLOWED_STATUSES, maxSources: MAX_SOURCES, totals, results };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
}).finally(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});
