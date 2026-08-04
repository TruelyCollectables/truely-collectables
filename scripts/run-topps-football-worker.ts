import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { assertChecklistPlanComplexity } from "../src/lib/checklist-registry/server";
import { CHECKLIST_SOURCE_BUCKET } from "../src/lib/checklist-registry/storage";
import { parseToppsFootballTextChecklist } from "../src/lib/checklist-registry/topps-football-text-adapter";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const INDEX_URL = "https://www.topps.com/pages/checklists";
const MAX_PRODUCTS = Math.max(1, Math.min(500, Number(process.env.TOPPS_FOOTBALL_MAX_PRODUCTS || 500)));
const MAX_SOURCES = Math.max(1, Math.min(100, Number(process.env.TOPPS_FOOTBALL_MAX_SOURCES || 100)));
const OUTPUT = resolve(process.cwd(), process.env.TOPPS_FOOTBALL_OUTPUT || ".checklist-discovery/topps-football-worker-receipt.json");
const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/topps-football-tmp");

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Topps football worker requires Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function clean(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&reg;/gi, "®").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function absolute(value: string, base: string) { const url = new URL(value, base); url.hash = ""; return url.toString(); }
function anchors(html: string, base: string) {
  const values: Array<{ url: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { values.push({ url: absolute(match[1], base), text: clean(match[2]) }); } catch { /* ignore */ }
  }
  return values;
}
function isFootballTitle(value: string) {
  const title = clean(value);
  return /\b(football|nfl|bowman university|bowman u|chrome u|collegiate)\b/i.test(title) && !/baseball|mlb|basketball|hockey|soccer|uefa|formula 1|wwe/i.test(title);
}
async function fetchResponse(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/pdf,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": "TCOS-Topps-Football-Worker/1.0 (+private registry automation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response;
}
async function fetchHtml(url: string) {
  const response = await fetchResponse(url);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) throw new Error(`Unexpected HTML content type ${type || "unknown"}`);
  const html = await response.text();
  if (html.length < 1_000) throw new Error(`Incomplete HTML (${html.length} bytes)`);
  return html;
}
function productPages(html: string) {
  const unique = new Map<string, { url: string; title: string }>();
  for (const anchor of anchors(html, INDEX_URL)) {
    if (!isFootballTitle(anchor.text)) continue;
    const parsed = new URL(anchor.url);
    if (!["www.topps.com", "topps.com"].includes(parsed.hostname)) continue;
    if (!/^\/(pages|products)\//i.test(parsed.pathname)) continue;
    unique.set(anchor.url, { url: anchor.url, title: anchor.text });
  }
  return [...unique.values()].slice(0, MAX_PRODUCTS);
}
function checklistAssets(html: string, pageUrl: string) {
  const unique = new Map<string, { url: string; label: string }>();
  for (const anchor of anchors(html, pageUrl)) {
    if (!/checklist/i.test(anchor.text) && !/\.(pdf|xlsx?|csv|txt)(?:$|\?)/i.test(anchor.url)) continue;
    if (/odds/i.test(anchor.text)) continue;
    unique.set(anchor.url, { url: anchor.url, label: anchor.text });
  }
  return [...unique.values()];
}
function normalizedMimeType(url: string, header: string) {
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
  const response = await fetchResponse(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("Downloaded football checklist was empty.");
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error(`Football checklist exceeds 50 MiB (${bytes.byteLength} bytes).`);
  return { bytes, mimeType: normalizedMimeType(response.url || url, response.headers.get("content-type") || "") };
}
function filename(sourceUrl: string, fallback: string) {
  try {
    const value = new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1);
    if (value) return decodeURIComponent(value).replace(/[^a-zA-Z0-9._-]+/g, "-");
  } catch { /* fallback */ }
  return `${fallback.replace(/[^a-zA-Z0-9._-]+/g, "-") || "topps-football"}.bin`;
}
function htmlToText(value: string) {
  return value.replace(/<\/?(?:p|div|li|tr|h[1-6]|br|section|article|table|tbody|thead)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function extractText(params: { bytes: Uint8Array; mimeType: string; filename: string }) {
  if (params.mimeType === "application/pdf") {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const filePath = resolve(TEMP_ROOT, params.filename.replace(/\.pdf$/i, "") + ".pdf");
    writeFileSync(filePath, params.bytes);
    try { return execFileSync("pdftotext", ["-layout", "-nopgbrk", filePath, "-"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }).trim(); }
    finally { rmSync(filePath, { force: true }); }
  }
  const decoded = Buffer.from(params.bytes).toString("utf8");
  if (params.mimeType === "text/html") return htmlToText(decoded);
  if (params.mimeType === "text/plain" || params.mimeType === "text/csv") return decoded.trim();
  throw new Error(`Unsupported football checklist extraction format: ${params.mimeType}`);
}
async function updateCatalog(db: ReturnType<typeof dbClient>, sourceUrl: string, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").update(values).eq("manufacturer", "Topps").eq("sport", "Football").eq("source_url", sourceUrl);
  if (error) throw new Error(`Could not update football source catalog: ${error.message}`);
}
async function persist(db: ReturnType<typeof dbClient>, artifact: ChecklistSourceArtifact) {
  const plan = parseToppsFootballTextChecklist(artifact);
  const complexity = assertChecklistPlanComplexity(plan);
  const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
  if (plan.validation.status !== "passed" || errors.length) return { ok: false, plan, complexity, errors };

  const archive = artifact.archiveContent ?? artifact.content;
  const bytes = typeof archive === "string" ? Buffer.from(archive, "utf8") : Buffer.from(archive);
  const storage = plan.source.storage;
  const { error: uploadError } = await db.storage.from(CHECKLIST_SOURCE_BUCKET).upload(storage.objectPath, bytes, { contentType: storage.mimeType, upsert: false, cacheControl: "0" });
  if (uploadError && !/already exists|duplicate|409/i.test(uploadError.message || "")) throw new Error(`Could not archive football checklist: ${uploadError.message}`);
  const { data, error } = await db.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });
  if (error) throw new Error(`Football Registry transaction failed: ${error.message}`);
  return { ok: true, plan, complexity, persistence: data, errors: [] };
}

async function discover(db: ReturnType<typeof dbClient>) {
  const pages = productPages(await fetchHtml(INDEX_URL));
  const results: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    try {
      const assets = checklistAssets(await fetchHtml(page.url), page.url);
      for (const asset of assets) {
        const checkedAt = new Date().toISOString();
        const downloaded = await download(asset.url);
        const digest = sha256(downloaded.bytes);
        const { data: existing } = await db.from("checklist_source_catalog").select("status,source_sha256").eq("manufacturer", "Topps").eq("sport", "Football").eq("source_url", asset.url).maybeSingle();
        const unchangedImported = existing?.status === "imported" && existing?.source_sha256 === digest;
        const status = unchangedImported ? "imported" : "discovered";
        const { error } = await db.from("checklist_source_catalog").upsert({
          manufacturer: "Topps",
          sport: "Football",
          source_url: asset.url,
          source_sha256: digest,
          release_name: page.title,
          status,
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          issue_summary: unchangedImported ? [] : [{ code: "topps_football_ready_for_worker", severity: "warning", message: "Official Topps football checklist is queued for deterministic validation and import." }],
          metadata: { productPageUrl: page.url, assetLabel: asset.label, mimeType: downloaded.mimeType, sizeBytes: downloaded.bytes.byteLength, provider: "topps_official_checklist_index", worker: "topps-football-v1" },
        }, { onConflict: "source_url" });
        if (error) throw new Error(error.message);
        results.push({ sourceUrl: asset.url, releaseName: page.title, status: unchangedImported ? "unchanged" : "queued", sha256: digest });
      }
    } catch (caught) {
      results.push({ productPage: page.url, releaseName: page.title, status: "failed", message: caught instanceof Error ? caught.message : String(caught) });
    }
  }
  return { pageCount: pages.length, results };
}

async function main() {
  const db = dbClient();
  const startedAt = new Date().toISOString();
  const discovery = await discover(db);
  const { data: rows, error } = await db.from("checklist_source_catalog")
    .select("source_url,release_name,status,metadata")
    .eq("manufacturer", "Topps").eq("sport", "Football")
    .in("status", ["discovered", "validated", "quarantined", "failed"])
    .order("last_seen_at", { ascending: false }).limit(MAX_SOURCES);
  if (error) throw new Error(`Could not read Topps football queue: ${error.message}`);

  const totals = { selected: rows?.length || 0, imported: 0, quarantined: 0, failed: 0, sets: 0, cards: 0, parallels: 0, identities: 0 };
  const results: Array<Record<string, unknown>> = [];
  for (const row of rows || []) {
    const sourceUrl = String(row.source_url);
    const releaseName = String(row.release_name || "Topps Football");
    const checkedAt = new Date().toISOString();
    try {
      const downloaded = await download(sourceUrl);
      const sourceFilename = filename(sourceUrl, releaseName);
      const text = extractText({ ...downloaded, filename: sourceFilename });
      if (text.length < 50) throw new Error(`Football checklist extraction produced only ${text.length} characters.`);
      const artifact: ChecklistSourceArtifact = {
        sourceUrl,
        originalFilename: `${releaseName.replace(/[^a-zA-Z0-9._-]+/g, "-")}.txt`,
        mimeType: "text/plain",
        content: text,
        archiveContent: downloaded.bytes,
        archiveFilename: sourceFilename,
        archiveMimeType: downloaded.mimeType,
        retrievedAt: checkedAt,
        authority: "official_manufacturer",
        redistributionAllowed: false,
      };
      const imported = await persist(db, artifact);
      const counts = imported.plan.validation.counts;
      const common = {
        source_sha256: sha256(downloaded.bytes),
        release_slug: imported.plan.release.releaseSlug,
        adapter_id: imported.plan.adapterId,
        adapter_version: imported.plan.adapterVersion,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: counts,
        issue_summary: imported.plan.validation.issues.slice(0, 100),
      };
      if (!imported.ok) {
        totals.quarantined += 1;
        await updateCatalog(db, sourceUrl, { ...common, status: "quarantined" });
        results.push({ sourceUrl, releaseName, status: "quarantined", counts, errors: imported.errors });
        continue;
      }
      totals.imported += 1;
      totals.sets += counts.sets; totals.cards += counts.cards; totals.parallels += counts.parallels; totals.identities += counts.identities;
      await updateCatalog(db, sourceUrl, { ...common, status: "imported", imported_at: checkedAt });
      results.push({ sourceUrl, releaseName, status: "imported", counts, persistence: imported.persistence });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const unsupported = /Unsupported football checklist extraction format/.test(message);
      if (unsupported) totals.quarantined += 1; else totals.failed += 1;
      await updateCatalog(db, sourceUrl, { status: unsupported ? "quarantined" : "failed", last_checked_at: checkedAt, issue_summary: [{ code: unsupported ? "topps_football_extractor_required" : "topps_football_worker_failure", severity: "error", message: message.slice(0, 500) }] });
      results.push({ sourceUrl, releaseName, status: unsupported ? "quarantined" : "failed", message });
    }
  }

  const { count: productionSourceCount } = await db.from("checklist_source_catalog").select("source_url", { count: "exact", head: true }).eq("manufacturer", "Topps").eq("sport", "Football");
  const receipt = { schema: "tcos.checklist.toppsFootballWorkerReceipt.v1", startedAt, completedAt: new Date().toISOString(), manufacturer: "Topps", sport: "Football", maxSources: MAX_SOURCES, discovery, totals, productionSourceCount: productionSourceCount || 0, results };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
}).finally(() => rmSync(TEMP_ROOT, { recursive: true, force: true }));
