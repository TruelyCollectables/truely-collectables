import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { assertChecklistPlanComplexity } from "../src/lib/checklist-registry/server";
import { CHECKLIST_SOURCE_BUCKET } from "../src/lib/checklist-registry/storage";
import { parseToppsHockeyTextChecklist } from "../src/lib/checklist-registry/topps-hockey-text-adapter";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const MAX_SOURCES = Math.max(1, Math.min(100, Number(process.env.TOPPS_HOCKEY_MAX_SOURCES || 100)));
const OUTPUT = resolve(process.cwd(), process.env.TOPPS_HOCKEY_OUTPUT || ".checklist-discovery/topps-hockey-worker-receipt.json");
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/topps-hockey-tmp");

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Topps Hockey worker requires Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function trusted(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" && (url.hostname === "topps.com" || url.hostname.endsWith(".topps.com") || url.hostname === "cdn.shopify.com");
}
function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function mime(url: string, header: string) {
  const type = header.split(";")[0].trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  const extension = extname(new URL(url).pathname).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".csv") return "text/csv";
  if (extension === ".txt") return "text/plain";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".xls") return "application/vnd.ms-excel";
  return type || "application/octet-stream";
}
async function download(url: string) {
  if (!trusted(url)) throw new Error("Untrusted Topps Hockey source URL.");
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(90_000), headers: { "Cache-Control": "no-cache", "User-Agent": "TCOS-Topps-Hockey-Worker/1.0" } });
  if (!trusted(response.url || url)) throw new Error("Topps Hockey redirect left trusted hosts.");
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) throw new Error("Invalid Topps Hockey source size.");
  return { bytes, finalUrl: response.url || url, mimeType: mime(response.url || url, response.headers.get("content-type") || "") };
}
function filename(url: string, fallback: string) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || fallback).replace(/[^A-Za-z0-9._-]+/g, "-"); }
  catch { return `${fallback.replace(/[^A-Za-z0-9._-]+/g, "-")}.bin`; }
}
function htmlToText(value: string) { return value.replace(/<\/?(?:p|div|li|tr|h[1-6]|br|section|article|table|tbody|thead)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
function extractText(bytes: Uint8Array, mimeType: string, name: string) {
  if (mimeType === "application/pdf") {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const path = resolve(TEMP_ROOT, name.replace(/\.pdf$/i, "") + ".pdf"); writeFileSync(path, bytes);
    try { return execFileSync("pdftotext", ["-layout", "-nopgbrk", path, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }).trim(); }
    finally { rmSync(path, { force: true }); }
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  if (mimeType === "text/html") return htmlToText(decoded);
  if (mimeType === "text/plain" || mimeType === "text/csv") return decoded.trim();
  throw new Error(`Unsupported Topps Hockey extraction format: ${mimeType}`);
}
async function updateCatalog(db: ReturnType<typeof dbClient>, sourceUrl: string, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").update(values).eq("manufacturer", "Topps").eq("sport", "Hockey").eq("source_url", sourceUrl);
  if (error) throw new Error(`Could not update Hockey source catalog: ${error.message}`);
}

async function main() {
  const db = dbClient();
  const startedAt = new Date().toISOString();
  const { data: rows, error } = await db.from("checklist_source_catalog").select("source_url,release_name,status,source_sha256,metadata").eq("manufacturer", "Topps").eq("sport", "Hockey").in("status", ["discovered", "validated"]).order("last_seen_at", { ascending: false }).limit(MAX_SOURCES);
  if (error) throw new Error(`Could not read Topps Hockey queue: ${error.message}`);

  const totals = { selected: rows?.length || 0, imported: 0, quarantined: 0, failed: 0, sets: 0, cards: 0, parallels: 0, identities: 0 };
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows || []) {
    const sourceUrl = String(row.source_url);
    const releaseName = String(row.release_name || "Topps Hockey");
    const expectedDigest = String(row.source_sha256 || "").toLowerCase();
    const checkedAt = new Date().toISOString();
    try {
      const downloaded = await download(sourceUrl);
      const digest = sha256(downloaded.bytes);
      if (!/^[a-f0-9]{64}$/.test(expectedDigest) || digest !== expectedDigest) {
        totals.quarantined += 1;
        await updateCatalog(db, sourceUrl, { status: "quarantined", last_checked_at: checkedAt, issue_summary: [{ code: "topps_hockey_source_hash_mismatch", severity: "error", message: "Source changed after discovery or had no pinned SHA-256." }] });
        results.push({ sourceUrl, releaseName, status: "quarantined", code: "source_hash_mismatch" });
        continue;
      }
      const archiveFilename = filename(downloaded.finalUrl, releaseName);
      const text = extractText(downloaded.bytes, downloaded.mimeType, archiveFilename);
      if (text.length < 50) throw new Error(`Hockey checklist extraction produced only ${text.length} characters.`);
      const artifact: ChecklistSourceArtifact = { sourceUrl, originalFilename: `${releaseName.replace(/[^A-Za-z0-9._-]+/g, "-")}.txt`, mimeType: "text/plain", content: text, archiveContent: downloaded.bytes, archiveFilename, archiveMimeType: downloaded.mimeType, retrievedAt: checkedAt, authority: "official_manufacturer", redistributionAllowed: false };
      const plan = parseToppsHockeyTextChecklist(artifact);
      const complexity = assertChecklistPlanComplexity(plan);
      const validationErrors = plan.validation.issues.filter((issue) => issue.severity === "error");
      if (plan.validation.status !== "passed" || validationErrors.length) {
        totals.quarantined += 1;
        await updateCatalog(db, sourceUrl, { status: "quarantined", last_checked_at: checkedAt, adapter_id: plan.adapterId, adapter_version: plan.adapterVersion, validation_counts: plan.validation.counts, issue_summary: validationErrors.slice(0, 100) });
        results.push({ sourceUrl, releaseName, status: "quarantined", counts: plan.validation.counts, errors: validationErrors.slice(0, 20) });
        continue;
      }
      const storage = plan.source.storage;
      const { error: uploadError } = await db.storage.from(CHECKLIST_SOURCE_BUCKET).upload(storage.objectPath, Buffer.from(downloaded.bytes), { contentType: storage.mimeType, upsert: false, cacheControl: "0" });
      if (uploadError && !/already exists|duplicate|409/i.test(uploadError.message || "")) throw new Error(`Could not archive Hockey checklist: ${uploadError.message}`);
      const { data: persistence, error: persistenceError } = await db.rpc("tcos_apply_checklist_import_plan", { p_plan: plan, p_original_filename: storage.originalFilename, p_mime_type: storage.mimeType, p_size_bytes: storage.sizeBytes, p_sha256: storage.sha256, p_storage_bucket: storage.bucket, p_storage_object_path: storage.objectPath });
      if (persistenceError) throw new Error(`Hockey Registry transaction failed: ${persistenceError.message}`);
      totals.imported += 1; totals.sets += plan.validation.counts.sets; totals.cards += plan.validation.counts.cards; totals.parallels += plan.validation.counts.parallels; totals.identities += plan.validation.counts.identities;
      await updateCatalog(db, sourceUrl, { status: "imported", source_sha256: digest, release_slug: plan.release.releaseSlug, release_name: [plan.release.releaseYear, plan.release.product].filter(Boolean).join(" "), adapter_id: plan.adapterId, adapter_version: plan.adapterVersion, last_checked_at: checkedAt, imported_at: checkedAt, validation_counts: plan.validation.counts, issue_summary: plan.validation.issues.slice(0, 100), metadata: { ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}), originalMimeType: downloaded.mimeType, originalFilename: archiveFilename, sourceSizeBytes: downloaded.bytes.byteLength, worker: "topps-hockey-v1" } });
      results.push({ sourceUrl, releaseName, status: "imported", counts: plan.validation.counts, complexity, persistence });
    } catch (caught) {
      totals.failed += 1;
      const message = caught instanceof Error ? caught.message : String(caught);
      await updateCatalog(db, sourceUrl, { status: "failed", last_checked_at: checkedAt, issue_summary: [{ code: "topps_hockey_worker_failure", severity: "error", message: message.slice(0, 500) }] }).catch(() => undefined);
      results.push({ sourceUrl, releaseName, status: "failed", message });
    }
  }
  const { count: productionSourceCount } = await db.from("checklist_source_catalog").select("source_url", { count: "exact", head: true }).eq("manufacturer", "Topps").eq("sport", "Hockey");
  const receipt = { schema: "tcos.toppsHockey.workerReceipt.v1", manufacturer: "Topps", sport: "Hockey", startedAt, completedAt: new Date().toISOString(), productionSourceCount: productionSourceCount || 0, totals, results };
  mkdirSync(dirname(OUTPUT), { recursive: true }); writeFileSync(OUTPUT, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ productionSourceCount: productionSourceCount || 0, totals }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
