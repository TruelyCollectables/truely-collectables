import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const INDEX_URL = "https://www.topps.com/pages/checklists";
const MAX_PRODUCTS = Math.max(1, Number(process.env.TOPPS_BASEBALL_MAX_PRODUCTS || 40));
const OUTPUT = resolve(
  process.cwd(),
  process.env.TOPPS_BASEBALL_DISCOVERY_OUTPUT ||
    ".checklist-discovery/topps-baseball-receipt.json",
);

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Topps baseball discovery requires Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function clean(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&reg;/gi, "®").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}
function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function absolute(value: string, base: string) {
  const url = new URL(value, base);
  url.hash = "";
  return url.toString();
}
async function fetchResponse(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": "TCOS-Topps-Baseball-Checklist-Discovery/1.0 (+private registry automation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
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

function anchors(html: string, base: string) {
  const values: Array<{ url: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      values.push({ url: absolute(match[1], base), text: clean(match[2]) });
    } catch {
      // Ignore malformed unrelated anchors.
    }
  }
  return values;
}
function isBaseballTitle(value: string) {
  const title = clean(value);
  return /\b(baseball|bowman|mlb)\b/i.test(title) && !/basketball|football|soccer|uefa|star wars|disney|pixar/i.test(title);
}
function inferYear(value: string) {
  return value.match(/\b(20\d{2})\b/)?.[1] || null;
}
function productPages(html: string) {
  const unique = new Map<string, { url: string; title: string }>();
  for (const anchor of anchors(html, INDEX_URL)) {
    if (!isBaseballTitle(anchor.text)) continue;
    const parsed = new URL(anchor.url);
    if (parsed.hostname !== "www.topps.com" && parsed.hostname !== "topps.com") continue;
    if (!/^\/pages\//i.test(parsed.pathname) && !/^\/products\//i.test(parsed.pathname)) continue;
    unique.set(anchor.url, { url: anchor.url, title: anchor.text });
  }
  return [...unique.values()].slice(0, MAX_PRODUCTS);
}
function checklistAssets(html: string, pageUrl: string) {
  const unique = new Map<string, { url: string; label: string }>();
  for (const anchor of anchors(html, pageUrl)) {
    const url = anchor.url;
    const label = anchor.text;
    if (!/checklist/i.test(label) && !/\.(pdf|xlsx?|csv)(?:$|\?)/i.test(url)) continue;
    if (/odds/i.test(label)) continue;
    unique.set(url, { url, label });
  }
  return [...unique.values()];
}
function mimeType(url: string, header: string) {
  const type = header.split(";")[0].trim().toLowerCase();
  if (type) return type;
  if (/\.pdf(?:$|\?)/i.test(url)) return "application/pdf";
  if (/\.xlsx(?:$|\?)/i.test(url)) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (/\.xls(?:$|\?)/i.test(url)) return "application/vnd.ms-excel";
  if (/\.csv(?:$|\?)/i.test(url)) return "text/csv";
  return "application/octet-stream";
}
async function upsert(db: ReturnType<typeof client>, values: Record<string, unknown>) {
  const { error } = await db.from("checklist_source_catalog").upsert(values, { onConflict: "source_url" });
  if (error) throw new Error(`Could not update checklist source catalog: ${error.message}`);
}

async function main() {
  const db = client();
  const startedAt = new Date().toISOString();
  const pages = productPages(await fetchHtml(INDEX_URL));
  const results: Array<Record<string, unknown>> = [];

  for (const page of pages) {
    const checkedAt = new Date().toISOString();
    try {
      const html = await fetchHtml(page.url);
      const assets = checklistAssets(html, page.url);
      if (!assets.length) {
        results.push({ productPage: page.url, title: page.title, status: "no_checklist_asset" });
        continue;
      }
      for (const asset of assets) {
        const response = await fetchResponse(asset.url);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const sourceSha256 = sha256(bytes);
        const type = mimeType(asset.url, response.headers.get("content-type") || "");
        const supportedForAutomaticParsing = ["text/csv", "application/json", "text/html"].includes(type);
        const status = supportedForAutomaticParsing ? "discovered" : "quarantined";
        const issueSummary = supportedForAutomaticParsing
          ? []
          : [{
              code: "topps_baseball_adapter_required",
              severity: "error",
              message: `Official Topps baseball checklist discovered as ${type}; retain privately and add a deterministic adapter before import.`,
            }];
        await upsert(db, {
          manufacturer: "Topps",
          sport: "Baseball",
          source_url: asset.url,
          source_sha256: sourceSha256,
          release_name: page.title,
          status,
          last_seen_at: checkedAt,
          last_checked_at: checkedAt,
          issue_summary: issueSummary,
          metadata: {
            productPageUrl: page.url,
            assetLabel: asset.label,
            releaseYear: inferYear(page.title),
            mimeType: type,
            sizeBytes: bytes.byteLength,
            provider: "topps_official_checklist_index",
          },
        });
        results.push({
          productPage: page.url,
          title: page.title,
          sourceUrl: asset.url,
          sourceSha256,
          mimeType: type,
          sizeBytes: bytes.byteLength,
          status,
        });
      }
    } catch (error) {
      results.push({
        productPage: page.url,
        title: page.title,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const receipt = {
    schema: "tcos.checklist.toppsBaseballDiscoveryReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    indexUrl: INDEX_URL,
    productCount: pages.length,
    results,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
