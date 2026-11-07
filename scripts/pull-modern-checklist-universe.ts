import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const START_YEAR = Number(process.env.MODERN_CHECKLIST_START_YEAR || 2001);
const END_YEAR = Number(process.env.MODERN_CHECKLIST_END_YEAR || new Date().getUTCFullYear());
const MAX_CANDIDATES = Number(process.env.MODERN_CHECKLIST_MAX_CANDIDATES || 12000);
const ROOT = resolve(process.cwd(), ".modern-checklist-universe");
const PAGES = resolve(ROOT, "checklists");
const FILES = resolve(ROOT, "files");
const UA = "Mozilla/5.0 (compatible; TCOS-Modern-Checklist-Collector/1.0)";

const YEARS = Array.from({ length: END_YEAR - START_YEAR + 1 }, (_, i) => END_YEAR - i);
const BRANDS = [
  "Topps", "Bowman", "Panini", "Donruss", "Score", "Prizm", "Select", "Optic",
  "Upper Deck", "Fleer", "SkyBox", "O-Pee-Chee", "Parkhurst", "Leaf", "Pro Set",
  "Pacific", "Press Pass", "Sage", "Wild Card", "Classic", "SportKings", "In The Game",
  "Rittenhouse", "Cryptozoic", "Inkworks", "Breygent", "ArtBox"
];
const SPORTS = ["baseball", "football", "basketball", "hockey", "soccer", "racing", "golf", "wrestling", "mma", "non-sport"];
const ALLOWED = /beckett\.com\/news|checklistinsider\.com|cardboardconnection\.com|tcdb\.com|laststicker\.com|topps\.com|paniniamerica\.net|upperdeck\.com|leaftradingcards\.com|web\.archive\.org/i;
const FILE_RE = /\.(?:pdf|xlsx?|xlsm|csv|zip)(?:$|\?)/i;

mkdirSync(PAGES, { recursive: true });
mkdirSync(FILES, { recursive: true });

function decode(v: string) {
  return v.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&#039;/gi, "'").replace(/&nbsp;/gi, " ");
}
function clean(v: string) {
  return decode(v.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h1|h2|h3|tr|article|section)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function slug(v: string) {
  return v.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 170) || "checklist";
}
function normalize(v: string, base?: string) {
  try { const u = new URL(decode(v), base); u.hash = ""; return u.toString(); } catch { return null; }
}
function inferYear(v: string) {
  const years = [...v.matchAll(/\b(20(?:0[1-9]|1\d|2[0-6]))\b/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}
function inferBrand(v: string) {
  const lower = v.toLowerCase();
  return BRANDS.find((b) => lower.includes(b.toLowerCase())) || "Unknown";
}
function relevant(v: string) {
  const year = inferYear(v);
  return !!year && year >= START_YEAR && year <= END_YEAR && /checklist|card list|set list|trading cards?/i.test(v) && BRANDS.some((b) => v.toLowerCase().includes(b.toLowerCase()));
}
async function fetchText(url: string) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow", signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { text: await r.text(), via: "direct" };
  } catch (e) {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "user-agent": UA, accept: "text/plain,text/markdown,*/*" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`direct=${e instanceof Error ? e.message : String(e)} reader=HTTP ${r.status}`);
    return { text: await r.text(), via: "jina-reader" };
  }
}
function links(html: string, base: string) {
  const out: Array<{ url: string; label: string }> = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalize(m[1], base); if (url) out.push({ url, label: clean(m[2]) });
  }
  return out;
}
function files(html: string, base: string) {
  const out = new Set<string>();
  for (const row of links(html, base)) if (FILE_RE.test(row.url)) out.add(row.url);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:pdf|xlsx?|xlsm|csv|zip)(?:\?[^\s"'<>]*)?/gi)) {
    const u = normalize(m[0]); if (u) out.add(u);
  }
  return [...out];
}
function rssItems(xml: string) {
  const out: Array<{ title: string; link: string }> = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const title = clean(item[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "");
    const link = clean(item[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (link) out.push({ title, link });
  }
  return out;
}
async function latestWayback(url: string) {
  try {
    const cdx = `https://web.archive.org/cdx/search/cdx?output=json&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=digest&limit=5&url=${encodeURIComponent(url)}`;
    const r = await fetch(cdx, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) return null;
    const data = JSON.parse(await r.text()) as string[][];
    const row = data.at(-1);
    return row?.[0] && row?.[1] ? `https://web.archive.org/web/${row[0]}id_/${row[1]}` : null;
  } catch { return null; }
}

async function main() {
  const candidates = new Map<string, { url: string; discoveredFrom: string; year: number; brand: string }>();
  const discoveryFailures: any[] = [];
  const queries: Array<{ year: number; query: string }> = [];
  for (const year of YEARS) {
    for (const brand of BRANDS) queries.push({ year, query: `${year} ${brand} trading card checklist` });
    for (const sport of SPORTS) queries.push({ year, query: `${year} ${sport} trading card checklist` });
  }

  let q = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (q < queries.length && candidates.size < MAX_CANDIDATES) {
      const row = queries[q++];
      const searchUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(row.query)}`;
      try {
        const r = await fetch(searchUrl, { headers: { "user-agent": UA, accept: "application/rss+xml,application/xml,*/*" }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        for (const item of rssItems(await r.text())) {
          const u = normalize(item.link);
          const combined = `${item.title} ${u || ""}`;
          if (!u || !ALLOWED.test(u) || !relevant(combined)) continue;
          const year = inferYear(combined);
          if (!year) continue;
          candidates.set(u, { url: u, discoveredFrom: `Bing RSS: ${row.query}`, year, brand: inferBrand(combined) });
        }
      } catch (e) { discoveryFailures.push({ url: searchUrl, error: e instanceof Error ? e.message : String(e) }); }
    }
  });
  await Promise.all(workers);

  const pages: any[] = [];
  const fileRows: any[] = [];
  const pageFailures: any[] = [];
  const ordered = [...candidates.values()].sort((a, b) => b.year - a.year || a.brand.localeCompare(b.brand));

  for (const candidate of ordered.slice(0, MAX_CANDIDATES)) {
    try {
      const { text, via } = await fetchText(candidate.url);
      const title = clean(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.url).slice(0, 300);
      const plain = clean(text);
      const year = inferYear(`${title} ${candidate.url}`) || candidate.year;
      if (year < START_YEAR || year > END_YEAR || !relevant(`${title} ${plain.slice(0, 5000)}`)) continue;
      const brand = inferBrand(`${title} ${plain.slice(0, 1000)}`);
      const local = `${year}-${String(pages.length + 1).padStart(5, "0")}-${slug(title)}.txt`;
      writeFileSync(resolve(PAGES, local), `SOURCE: ${candidate.url}\nDISCOVERED_FROM: ${candidate.discoveredFrom}\nVIA: ${via}\nYEAR: ${year}\nBRAND: ${brand}\nTITLE: ${title}\n\n${plain}\n`);
      const found = files(text, candidate.url);
      pages.push({ year, brand, title, url: candidate.url, discoveredFrom: candidate.discoveredFrom, via, filename: local, textBytes: Buffer.byteLength(plain), linkedFiles: found.length });

      for (const fileUrl of found) {
        let done = false; let lastError = "";
        const attempts = [{ url: fileUrl, via: "direct" }];
        const archived = await latestWayback(fileUrl); if (archived) attempts.push({ url: archived, via: "wayback" });
        for (const attempt of attempts) {
          try {
            const r = await fetch(attempt.url, { headers: { "user-agent": UA, referer: candidate.url }, redirect: "follow", signal: AbortSignal.timeout(90000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.length < 100) throw new Error(`Only ${bytes.length} bytes`);
            const original = basename(new URL(fileUrl).pathname) || `checklist${extname(fileUrl)}`;
            const file = `${year}-${String(fileRows.length + 1).padStart(5, "0")}-${slug(title)}-${slug(original)}${extname(original)}`;
            writeFileSync(resolve(FILES, file), bytes);
            fileRows.push({ year, brand, title, sourcePage: candidate.url, url: fileUrl, via: attempt.via, filename: file, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
            done = true; break;
          } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
        }
        if (!done) fileRows.push({ year, brand, title, sourcePage: candidate.url, url: fileUrl, error: lastError });
      }
    } catch (e) { pageFailures.push({ ...candidate, error: e instanceof Error ? e.message : String(e) }); }
  }

  const byYear = YEARS.map((year) => ({
    year,
    discoveredCandidates: ordered.filter((r) => r.year === year).length,
    checklistSnapshots: pages.filter((r) => r.year === year).length,
    downloadedFiles: fileRows.filter((r) => r.year === year && !r.error).length,
    failedFiles: fileRows.filter((r) => r.year === year && r.error).length,
  }));
  const byBrand = [...new Set(pages.map((r) => r.brand))].sort().map((brand) => ({
    brand,
    checklistSnapshots: pages.filter((r) => r.brand === brand).length,
    downloadedFiles: fileRows.filter((r) => r.brand === brand && !r.error).length,
  }));

  const manifest = {
    schema: "tcos.modernChecklistUniverse.v1",
    generatedAt: new Date().toISOString(),
    scope: { startYear: START_YEAR, endYear: END_YEAR, order: "descending", deferredVintageThrough: 2000 },
    totals: {
      discoveredCandidates: candidates.size,
      checklistSnapshots: pages.length,
      linkedFileCandidates: fileRows.length,
      downloadedFiles: fileRows.filter((r) => !r.error).length,
      failedFiles: fileRows.filter((r) => r.error).length,
      failedPages: pageFailures.length,
      discoveryFailures: discoveryFailures.length,
    },
    byYear,
    byBrand,
    pages,
    files: fileRows,
    pageFailures,
    discoveryFailures,
  };
  writeFileSync(resolve(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(resolve(ROOT, "coverage-summary.md"), [
    "# TCOS Modern Checklist Coverage",
    "",
    `Scope: ${END_YEAR} backward through ${START_YEAR}.`,
    "Vintage and pre-2001 sets are deferred.",
    "",
    `Discovered candidates: ${manifest.totals.discoveredCandidates}`,
    `Checklist snapshots: ${manifest.totals.checklistSnapshots}`,
    `Downloaded files: ${manifest.totals.downloadedFiles}`,
    `Failed files: ${manifest.totals.failedFiles}`,
    "",
    "## By year",
    ...byYear.map((r) => `- ${r.year}: ${r.checklistSnapshots} snapshots, ${r.downloadedFiles} files, ${r.failedFiles} failed files`),
  ].join("\n") + "\n");
  console.log(JSON.stringify(manifest.totals));
  if (!pages.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : String(e)); process.exitCode = 1; });
