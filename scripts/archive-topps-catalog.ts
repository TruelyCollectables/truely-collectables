import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const INDEX_URL = "https://www.topps.com/pages/checklists";
const OUT = resolve(process.cwd(), process.env.TOPPS_ARCHIVE_ROOT || ".topps-archive");
const MAX_PRODUCTS = Math.max(1, Math.min(3000, Number(process.env.TOPPS_ARCHIVE_MAX_PRODUCTS || 3000)));
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.TOPPS_ARCHIVE_CONCURRENCY || 6)));
const MAX_BYTES = 50 * 1024 * 1024;

const trustedHosts = new Set(["topps.com", "www.topps.com", "www-next.topps.com", "cdn.shopify.com"]);

function clean(v: string) { return v.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&reg;/gi, "®").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim(); }
function slug(v: string) { return clean(v).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown"; }
function sha256(bytes: Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
function absolute(value: string, base: string) { const u = new URL(value, base); u.hash = ""; return u.toString(); }
function trusted(url: string) { const u = new URL(url); return u.protocol === "https:" && (trustedHosts.has(u.hostname.toLowerCase()) || u.hostname.toLowerCase().endsWith(".topps.com")); }
function anchors(html: string, base: string) {
  const out: Array<{ url: string; text: string }> = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { out.push({ url: absolute(m[1], base), text: clean(m[2]) }); } catch {}
  }
  return out;
}
function classify(title: string) {
  const t = title.toLowerCase();
  if (/baseball|mlb|bowman(?! university)|pro debut/.test(t)) return "Baseball";
  if (/football|nfl|bowman university.*football|resurgence football|signature class football/.test(t)) return "Football";
  if (/hockey|nhl/.test(t)) return "Hockey";
  if (/basketball|nba|wnba|g-league|nbl|mcdonald's all american/.test(t)) return "Basketball";
  if (/soccer|uefa|ucl|premier league|bundesliga|mls|manchester united/.test(t)) return "Soccer";
  if (/wwe|wrestling/.test(t)) return "Wrestling";
  if (/formula 1|f1|racing/.test(t)) return "Racing";
  if (/ufc/.test(t)) return "UFC";
  return "Non-Sport";
}
function yearOf(title: string) { return title.match(/\b(20\d{2})(?:[-/]\d{2})?\b/)?.[1] || "Unknown-Year"; }
function safeFilename(url: string, fallback: string) {
  try { const f = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || ""); if (f) return f.replace(/[^A-Za-z0-9._-]+/g, "-"); } catch {}
  return `${slug(fallback)}.bin`;
}
function mime(url: string, header: string) {
  const h = header.split(";")[0].trim().toLowerCase(); if (h && h !== "application/octet-stream") return h;
  const e = extname(new URL(url).pathname).toLowerCase();
  return ({ ".pdf":"application/pdf", ".csv":"text/csv", ".txt":"text/plain", ".xls":"application/vnd.ms-excel", ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".zip":"application/zip" } as Record<string,string>)[e] || "application/octet-stream";
}
async function fetchChecked(url: string, accept: string) {
  if (!trusted(url)) throw new Error("untrusted URL");
  const r = await fetch(url, { headers: { Accept: accept, "Cache-Control": "no-cache", "User-Agent": "TCOS-Topps-Archive/1.0 (+private preservation archive; contact sales@truelycollectables.com)" }, redirect: "follow", signal: AbortSignal.timeout(90000) });
  if (!trusted(r.url || url)) throw new Error("untrusted redirect");
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return r;
}
async function html(url: string) { const r = await fetchChecked(url, "text/html,*/*"); const text = await r.text(); if (text.length < 1000) throw new Error("incomplete HTML"); return text; }
async function download(url: string) { const r = await fetchChecked(url, "application/pdf,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,*/*"); const bytes = new Uint8Array(await r.arrayBuffer()); if (!bytes.length) throw new Error("empty file"); if (bytes.length > MAX_BYTES) throw new Error(`file exceeds ${MAX_BYTES} bytes`); return { bytes, finalUrl: r.url || url, mimeType: mime(r.url || url, r.headers.get("content-type") || "") }; }

async function pool<T>(items: T[], worker: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) { const i = next++; if (i >= items.length) break; await worker(items[i], i); }
  }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const indexHtml = await html(INDEX_URL);
  const products = new Map<string, { url: string; title: string }>();
  for (const a of anchors(indexHtml, INDEX_URL)) {
    const u = new URL(a.url);
    if (!trusted(a.url) || !/^\/(pages|products)\//i.test(u.pathname)) continue;
    if (!a.text || /checklists?$/i.test(a.text)) continue;
    products.set(a.url, { url: a.url, title: a.text });
  }
  const productList = [...products.values()].slice(0, MAX_PRODUCTS);
  const discovered: Array<{ productUrl: string; title: string; sport: string; year: string; assetUrl: string; label: string }> = [];
  const productFailures: Array<Record<string, unknown>> = [];
  await pool(productList, async (p) => {
    try {
      const page = await html(p.url);
      for (const a of anchors(page, p.url)) {
        if (!trusted(a.url)) continue;
        if (!/checklist/i.test(a.text) && !/\.(pdf|csv|txt|xlsx?|zip)(?:$|\?)/i.test(a.url)) continue;
        if (/odds/i.test(a.text)) continue;
        discovered.push({ productUrl: p.url, title: p.title, sport: classify(p.title), year: yearOf(p.title), assetUrl: a.url, label: a.text });
      }
    } catch (e) { productFailures.push({ productUrl: p.url, title: p.title, error: e instanceof Error ? e.message : String(e) }); }
  });
  const unique = [...new Map(discovered.map(x => [x.assetUrl, x])).values()];
  const files: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  await pool(unique, async (item) => {
    try {
      const d = await download(item.assetUrl);
      const hash = sha256(d.bytes);
      const name = safeFilename(d.finalUrl, item.title);
      const rel = [item.sport, item.year, slug(item.title), `${hash.slice(0,12)}-${name}`].join("/");
      const path = resolve(OUT, rel); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, d.bytes);
      files.push({ ...item, finalUrl: d.finalUrl, archivePath: rel, filename: name, sha256: hash, sizeBytes: d.bytes.length, mimeType: d.mimeType });
    } catch (e) { failures.push({ ...item, error: e instanceof Error ? e.message : String(e) }); }
  });
  const bySport = files.reduce<Record<string, number>>((a, x) => { const s = String(x.sport); a[s] = (a[s] || 0) + 1; return a; }, {});
  const manifest = { schema: "tcos.topps.sourceArchiveManifest.v1", generatedAt: new Date().toISOString(), source: INDEX_URL, catalogBoundary: "Topps states checklists are unavailable before 2018", totals: { products: productList.length, discoveredAssets: unique.length, archived: files.length, failedAssets: failures.length, failedProductPages: productFailures.length }, bySport, files, failures, productFailures };
  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(resolve(OUT, "README.txt"), `TCOS Topps source archive\nGenerated: ${manifest.generatedAt}\nArchived: ${files.length}\nFailed assets: ${failures.length}\n\nOriginal files are stored by sport/year/release and named with the first 12 SHA-256 characters.\n`);
  console.log(JSON.stringify(manifest.totals));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
