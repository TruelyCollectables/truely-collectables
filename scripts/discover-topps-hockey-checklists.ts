import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const INDEX_URL = "https://www.topps.com/pages/checklists";
const MAX_PRODUCTS = Math.max(1, Math.min(500, Number(process.env.TOPPS_HOCKEY_MAX_PRODUCTS || 500)));
const OUTPUT = process.env.TOPPS_HOCKEY_DISCOVERY_OUTPUT || ".checklist-discovery/topps-hockey-discovery.json";

function dbClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Topps Hockey discovery requires Supabase service-role access.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function clean(value: string) { return value.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim(); }
function absolute(value: string, base: string) { const url = new URL(value, base); url.hash = ""; return url.toString(); }
function trusted(value: string) {
  const url = new URL(value);
  return url.protocol === "https:" && (url.hostname === "topps.com" || url.hostname.endsWith(".topps.com") || url.hostname === "cdn.shopify.com");
}
function anchors(html: string, base: string) {
  const values: Array<{ url: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { values.push({ url: absolute(match[1], base), text: clean(match[2]) }); } catch { /* ignore malformed links */ }
  }
  return values;
}
async function response(url: string) {
  if (!trusted(url)) throw new Error("Untrusted Topps Hockey URL.");
  const result = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(90_000), headers: { "Cache-Control": "no-cache", "User-Agent": "TCOS-Topps-Hockey-Discovery/1.0" } });
  if (!trusted(result.url || url)) throw new Error("Topps Hockey redirect left trusted hosts.");
  if (!result.ok) throw new Error(`HTTP ${result.status} ${result.statusText}`);
  return result;
}
async function html(url: string) { return (await response(url)).text(); }
function isHockey(value: string) { return /\b(hockey|nhl)\b/i.test(value) && !/baseball|football|basketball|soccer|wrestling|racing/i.test(value); }
function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

async function main() {
  const db = dbClient();
  const index = await html(INDEX_URL);
  const pages = [...new Map(anchors(index, INDEX_URL).filter((a) => isHockey(a.text) && /^https:\/\/(?:www\.)?topps\.com\/(?:pages|products)\//i.test(a.url)).map((a) => [a.url, a])).values()].slice(0, MAX_PRODUCTS);
  const results: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    try {
      const body = await html(page.url);
      const assets = [...new Map(anchors(body, page.url).filter((a) => (/checklist/i.test(a.text) || /\.(pdf|csv|txt|xlsx?)(?:$|\?)/i.test(a.url)) && !/odds/i.test(a.text) && trusted(a.url)).map((a) => [a.url, a])).values()];
      for (const asset of assets) {
        const downloaded = await response(asset.url);
        const bytes = new Uint8Array(await downloaded.arrayBuffer());
        if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) throw new Error("Invalid Topps Hockey source size.");
        const digest = sha256(bytes);
        const now = new Date().toISOString();
        const { data: existing } = await db.from("checklist_source_catalog").select("status,source_sha256").eq("manufacturer", "Topps").eq("sport", "Hockey").eq("source_url", asset.url).maybeSingle();
        const unchanged = existing?.source_sha256 === digest;
        const status = unchanged && ["imported", "quarantined", "failed"].includes(String(existing?.status || "")) ? existing?.status : "discovered";
        const { error } = await db.from("checklist_source_catalog").upsert({ manufacturer: "Topps", sport: "Hockey", source_url: asset.url, source_sha256: digest, release_name: page.text, status, last_seen_at: now, last_checked_at: now, metadata: { productPageUrl: page.url, assetLabel: asset.text, finalUrl: downloaded.url || asset.url, sizeBytes: bytes.byteLength, provider: "topps_official_checklist_index", worker: "topps-hockey-v1" } }, { onConflict: "source_url" });
        if (error) throw new Error(error.message);
        results.push({ sourceUrl: asset.url, releaseName: page.text, status: unchanged ? "unchanged" : "queued", sha256: digest });
      }
    } catch (error) { results.push({ productPage: page.url, status: "failed", message: error instanceof Error ? error.message : String(error) }); }
  }
  const receipt = { schema: "tcos.toppsHockey.discovery.v1", manufacturer: "Topps", sport: "Hockey", generatedAt: new Date().toISOString(), pageCount: pages.length, results };
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const path = resolve(process.cwd(), OUTPUT); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({ pageCount: pages.length, sources: results.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
