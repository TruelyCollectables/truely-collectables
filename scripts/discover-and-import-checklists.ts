import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

const ARCHIVE_ROOT = "https://upperdeck.com/category/checklist/";
const AUTO_IMPORT = process.env.CHECKLIST_DISCOVERY_AUTO_IMPORT === "true";
const MAX_PAGES = Math.max(1, Number(process.env.CHECKLIST_DISCOVERY_MAX_PAGES || 3));
const MAX_SOURCES = Math.max(1, Number(process.env.CHECKLIST_DISCOVERY_MAX_SOURCES || 25));
const OUTPUT = resolve(process.cwd(), process.env.CHECKLIST_DISCOVERY_OUTPUT || ".checklist-discovery/latest-receipt.json");

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Checklist discovery requires Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function canonical(value: string) {
  const url = new URL(value, ARCHIVE_ROOT);
  url.hash = ""; url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}
function links(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const url = canonical(match[1]);
      const parsed = new URL(url);
      if (parsed.hostname === "upperdeck.com" && /^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) found.add(url);
    } catch { /* ignore unrelated malformed links */ }
  }
  return [...found];
}
async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml", "Cache-Control": "no-cache", "User-Agent": "TCOS-Checklist-Discovery/1.0 (+private registry automation; contact sales@truelycollectables.com)" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) throw new Error(`Unexpected content type ${type || "unknown"}`);
  const html = await response.text();
  if (html.length < 1_000) throw new Error(`Incomplete HTML (${html.length} bytes)`);
  return html;
}
async function discover() {
  const found = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const pageUrl = page === 1 ? ARCHIVE_ROOT : `${ARCHIVE_ROOT}page/${page}/`;
    const pageLinks = links(await fetchHtml(pageUrl));
    if (!pageLinks.length) break;
    const before = found.size;
    pageLinks.forEach((url) => found.add(url));
    if (before === found.size) break;
  }
  return [...found].slice(0, MAX_SOURCES);
}
function artifact(sourceUrl: string, content: string): ChecklistSourceArtifact {
  const slug = new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1) || "checklist";
  return { sourceUrl, originalFilename: `${slug}.html`, mimeType: "text/html", content, retrievedAt: new Date().toISOString(), authority: "official_manufacturer", redistributionAllowed: false };
}
function issues(values: Array<{ code: string; severity: string; message: string }>) {
  return values.slice(0, 50).map((value) => ({ code: value.code, severity: value.severity, message: value.message.slice(0, 500) }));
}
async function upsert(db: ReturnType<typeof client>, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update source catalog: ${error.message}`);
}

async function main() {
  const db = client();
  const startedAt = new Date().toISOString();
  const sourceUrls = await discover();
  const results: Array<Record<string, unknown>> = [];

  for (const sourceUrl of sourceUrls) {
    const checkedAt = new Date().toISOString();
    try {
      const content = await fetchHtml(sourceUrl);
      const sourceSha256 = sha256(content);
      const { data: existing, error } = await db.from("checklist_source_catalog").select("status,source_sha256").eq("source_url", sourceUrl).maybeSingle();
      if (error) throw new Error(`Could not read source catalog: ${error.message}`);

      if (["imported", "unchanged"].includes(existing?.status || "") && existing?.source_sha256 === sourceSha256) {
        const preservedStatus = existing?.status === "imported" ? "imported" : "unchanged";
        await upsert(db, { manufacturer: "Upper Deck", source_url: sourceUrl, source_sha256: sourceSha256, status: preservedStatus, last_seen_at: checkedAt, last_checked_at: checkedAt });
        results.push({ sourceUrl, status: preservedStatus, sourceSha256, unchanged: true });
        continue;
      }

      const sourceArtifact = artifact(sourceUrl, content);
      const validation = await importChecklistArtifact({ artifact: sourceArtifact, validateOnly: true });
      const validationErrors = validation.plan.validation.issues.filter((value) => value.severity === "error");
      const releaseName = [validation.plan.release.season || validation.plan.release.releaseYear, validation.plan.release.product]
        .filter(Boolean)
        .join(" ");
      const common = {
        manufacturer: validation.plan.release.manufacturer,
        sport: validation.plan.release.sport,
        source_url: sourceUrl,
        source_sha256: sourceSha256,
        release_slug: validation.plan.release.releaseSlug,
        release_name: releaseName,
        adapter_id: validation.adapter.id,
        adapter_version: validation.adapter.version,
        last_seen_at: checkedAt,
        last_checked_at: checkedAt,
        validation_counts: validation.plan.validation.counts,
        issue_summary: issues(validation.plan.validation.issues),
        metadata: { season: validation.plan.release.season, releaseYear: validation.plan.release.releaseYear, league: validation.plan.release.league },
      };

      if (!validation.ok || validationErrors.length) {
        await upsert(db, { ...common, status: "quarantined" });
        results.push({ sourceUrl, status: "quarantined", release: releaseName, errors: issues(validationErrors) });
        continue;
      }
      if (!AUTO_IMPORT) {
        await upsert(db, { ...common, status: "validated" });
        results.push({ sourceUrl, status: "validated", release: releaseName, counts: validation.plan.validation.counts });
        continue;
      }

      const imported = await importChecklistArtifact({ artifact: sourceArtifact });
      if (!imported.ok || imported.validatedOnly) throw new Error("Validated checklist did not complete persistence.");
      await upsert(db, { ...common, status: "imported", imported_at: checkedAt });
      results.push({ sourceUrl, status: "imported", release: releaseName, counts: imported.plan.validation.counts, persistence: imported.persistence });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      await upsert(db, { manufacturer: "Upper Deck", source_url: sourceUrl, status: "failed", last_seen_at: checkedAt, last_checked_at: checkedAt, issue_summary: [{ code: "discovery_failure", severity: "error", message }] });
      results.push({ sourceUrl, status: "failed", message });
    }
  }

  const receipt = { schema: "tcos.checklist.discoveryReceipt.v1", startedAt, completedAt: new Date().toISOString(), mode: AUTO_IMPORT ? "automatic_import" : "validation_only", archiveRoot: ARCHIVE_ROOT, limits: { maxPages: MAX_PAGES, maxSources: MAX_SOURCES }, discoveredCount: sourceUrls.length, results };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
