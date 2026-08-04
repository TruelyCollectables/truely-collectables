import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const OFFICIAL_INDEX = "https://www.topps.com/pages/checklists";
const RENDERED_INDEX = "https://r.jina.ai/http://www.topps.com/pages/checklists";
const OUT = resolve(process.cwd(), process.env.TOPPS_ARCHIVE_ROOT || ".topps-archive");
const CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.TOPPS_ARCHIVE_CONCURRENCY || 6)));
const MAX_BYTES = 50 * 1024 * 1024;

const officialAssetHosts = new Set(["cdn.shopify.com", "topps.com", "www.topps.com", "www-next.topps.com"]);

function clean(v: string) {
  return v.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&reg;/gi, "®").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}
function slug(v: string) {
  return clean(v).normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function isOfficialAsset(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (officialAssetHosts.has(host) || host.endsWith(".topps.com"));
  } catch {
    return false;
  }
}
function classify(title: string) {
  const t = title.toLowerCase();
  if (/baseball|mlb|bowman(?! university)|pro debut/.test(t)) return "Baseball";
  if (/football|nfl|bowman university.*football|resurgence football|signature class football/.test(t)) return "Football";
  if (/hockey|nhl/.test(t)) return "Hockey";
  if (/basketball|nba|wnba|g-league|nbl|mcdonald's all american|overtime elite/.test(t)) return "Basketball";
  if (/soccer|uefa|ucl|premier league|bundesliga|mls|manchester united/.test(t)) return "Soccer";
  if (/wwe|wrestling/.test(t)) return "Wrestling";
  if (/formula 1|f1|racing|paddock pass/.test(t)) return "Racing";
  if (/ufc/.test(t)) return "UFC";
  return "Non-Sport";
}
function yearOf(title: string) {
  return title.match(/\b(20\d{2})(?:[-/]\d{2})?\b/)?.[1] || "Unknown-Year";
}
function safeFilename(url: string, fallback: string) {
  try {
    const value = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "");
    if (value) return value.replace(/[^A-Za-z0-9._-]+/g, "-");
  } catch {}
  return `${slug(fallback)}.bin`;
}
function mime(url: string, header: string) {
  const normalized = header.split(";")[0].trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return normalized;
  const extension = extname(new URL(url).pathname).toLowerCase();
  return ({
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
  } as Record<string, string>)[extension] || "application/octet-stream";
}
async function fetchRenderedCatalog() {
  const response = await fetch(RENDERED_INDEX, {
    headers: {
      Accept: "text/plain,text/markdown,*/*",
      "User-Agent": "TCOS-Topps-Archive/2.0 (+private preservation archive; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Rendered Topps catalog failed: HTTP ${response.status} ${response.statusText}`);
  const text = await response.text();
  if (text.length < 10_000) throw new Error(`Rendered Topps catalog was incomplete (${text.length} bytes)`);
  return text;
}
function discoverFromMarkdown(markdown: string) {
  const found: Array<{ title: string; sport: string; year: string; assetUrl: string; source: string }> = [];
  for (const match of markdown.matchAll(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g)) {
    const title = clean(match[1]);
    const assetUrl = match[2].replace(/&amp;/g, "&");
    if (!title || !/checklist|topps|bowman|star wars|wwe|ufc|formula|uefa|bundesliga|mls|basketball|football|baseball|hockey/i.test(title)) continue;
    if (!isOfficialAsset(assetUrl)) continue;
    if (!/cdn\.shopify\.com/i.test(assetUrl) && !/\/pages\/checklists\//i.test(assetUrl)) continue;
    found.push({ title, sport: classify(title), year: yearOf(title), assetUrl, source: RENDERED_INDEX });
  }
  return [...new Map(found.map((item) => [item.assetUrl, item])).values()];
}
async function download(url: string) {
  if (!isOfficialAsset(url)) throw new Error("Refused non-official Topps asset host");
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf,text/csv,text/plain,text/html,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,*/*",
      Referer: OFFICIAL_INDEX,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  const finalUrl = response.url || url;
  if (!isOfficialAsset(finalUrl)) throw new Error("Refused redirect away from official Topps asset hosts");
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error("empty file");
  if (bytes.length > MAX_BYTES) throw new Error(`file exceeds ${MAX_BYTES} bytes`);
  return { bytes, finalUrl, mimeType: mime(finalUrl, response.headers.get("content-type") || "") };
}
async function pool<T>(items: T[], worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) break;
      await worker(items[index]);
    }
  }));
}
async function main() {
  mkdirSync(OUT, { recursive: true });
  const rendered = await fetchRenderedCatalog();
  const discovered = discoverFromMarkdown(rendered);
  if (!discovered.length) throw new Error("Rendered Topps catalog contained zero official checklist links");

  const files: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  await pool(discovered, async (item) => {
    try {
      const downloaded = await download(item.assetUrl);
      const hash = sha256(downloaded.bytes);
      const filename = safeFilename(downloaded.finalUrl, item.title);
      const relativePath = [item.sport, item.year, slug(item.title), `${hash.slice(0, 12)}-${filename}`].join("/");
      const outputPath = resolve(OUT, relativePath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, downloaded.bytes);
      files.push({ ...item, finalUrl: downloaded.finalUrl, archivePath: relativePath, filename, sha256: hash, sizeBytes: downloaded.bytes.length, mimeType: downloaded.mimeType });
    } catch (error) {
      failures.push({ ...item, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const bySport = files.reduce<Record<string, number>>((accumulator, item) => {
    const sport = String(item.sport);
    accumulator[sport] = (accumulator[sport] || 0) + 1;
    return accumulator;
  }, {});
  const manifest = {
    schema: "tcos.topps.sourceArchiveManifest.v1",
    generatedAt: new Date().toISOString(),
    officialCatalog: OFFICIAL_INDEX,
    discoveryTransport: RENDERED_INDEX,
    catalogBoundary: "Topps states checklists are unavailable before 2018",
    totals: { discoveredAssets: discovered.length, archived: files.length, failedAssets: failures.length },
    bySport,
    files,
    failures,
  };
  writeFileSync(resolve(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(OUT, "README.txt"), `TCOS Topps source archive\nGenerated: ${manifest.generatedAt}\nArchived: ${files.length}\nFailed assets: ${failures.length}\nDiscovery: browser-rendered official Topps catalog\n\nEvery downloaded file was required to resolve to an official Topps or Shopify CDN host and is named with the first 12 SHA-256 characters.\n`);
  console.log(JSON.stringify(manifest.totals));
  if (!files.length) throw new Error("No Topps checklist files were archived");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
