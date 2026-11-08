import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const GROUP = process.env.CHECKLIST_GAP_GROUP || "upper-deck";
const MAX_PAGES = Number(process.env.CHECKLIST_GAP_MAX_PAGES || 80);
const MAX_ARTICLES = Number(process.env.CHECKLIST_GAP_MAX_ARTICLES || 5000);
const ROOT = resolve(process.cwd(), `.missing-checklists-${GROUP}`);
const PAGES = resolve(ROOT, "checklists");
const FILES = resolve(ROOT, "files");
const UA = "Mozilla/5.0 (compatible; TCOS-Checklist-Gap-Collector/1.0)";

const CONFIGS: Record<string, { labels: string[]; brandSlugs: string[]; queries: string[] }> = {
  "upper-deck": {
    labels: ["Upper Deck", "Fleer", "SkyBox", "O-Pee-Chee", "Parkhurst", "SP", "Exquisite", "Goodwin"],
    brandSlugs: ["upper-deck"],
    queries: ["Upper Deck checklist", "Fleer checklist", "SkyBox checklist", "O-Pee-Chee checklist", "Parkhurst checklist"],
  },
  leaf: {
    labels: ["Leaf", "Pro Set", "Razor"],
    brandSlugs: ["leaf"],
    queries: ["Leaf Trading Cards checklist", "Pro Set checklist", "Razor checklist"],
  },
  "independent-sports": {
    labels: ["Pacific", "Press Pass", "Sage", "Wild Card", "Classic", "Score Board", "SportKings", "In The Game"],
    brandSlugs: ["press-pass", "sage", "pacific"],
    queries: ["Pacific trading cards checklist", "Press Pass checklist", "Sage checklist", "Wild Card checklist", "Classic cards checklist", "In The Game checklist"],
  },
  "nonsport-gaming": {
    labels: ["Rittenhouse", "Cryptozoic", "Inkworks", "Breygent", "ArtBox", "Wizards", "Pokemon", "Magic", "Yu-Gi-Oh"],
    brandSlugs: ["rittenhouse", "cryptozoic"],
    queries: ["Rittenhouse Archives checklist", "Cryptozoic checklist", "Inkworks checklist", "Breygent checklist", "non-sport trading card checklist", "TCG checklist"],
  },
};

const config = CONFIGS[GROUP];
if (!config) throw new Error(`Unknown CHECKLIST_GAP_GROUP=${GROUP}`);
mkdirSync(PAGES, { recursive: true });
mkdirSync(FILES, { recursive: true });

function decode(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&#039;/gi, "'").replace(/&nbsp;/gi, " ");
}
function clean(input: string) {
  return decode(input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h1|h2|h3|tr|article|section)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function slug(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 170) || "checklist";
}
function normalize(value: string, base?: string) {
  try { const u = new URL(decode(value), base); u.hash = ""; return u.toString(); } catch { return null; }
}
async function fetchText(url: string) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow", signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { text: await r.text(), via: "direct" };
  } catch (error) {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "user-agent": UA, accept: "text/plain,text/markdown,*/*" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`direct=${error instanceof Error ? error.message : String(error)} reader=HTTP ${r.status}`);
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
function fileLinks(html: string, base: string) {
  const out = new Set<string>();
  for (const row of links(html, base)) if (/\.(?:pdf|xlsx?|xlsm|csv|zip)(?:$|\?)/i.test(row.url)) out.add(row.url);
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:pdf|xlsx?|xlsm|csv|zip)(?:\?[^\s"'<>]*)?/gi)) { const u = normalize(m[0]); if (u) out.add(u); }
  return [...out];
}
function relevant(value: string) {
  const lower = value.toLowerCase();
  return config.labels.some((label) => lower.includes(label.toLowerCase())) && /checklist|card list|set list|trading card|cards/i.test(value);
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
    const row = data.at(-1); return row?.[0] && row?.[1] ? `https://web.archive.org/web/${row[0]}id_/${row[1]}` : null;
  } catch { return null; }
}

async function main() {
  const candidates = new Map<string, { url: string; discoveredFrom: string }>();
  const discoveryFailures: any[] = [];

  for (const brand of config.brandSlugs) {
    let empty = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? `https://www.checklistinsider.com/brand/${brand}` : `https://www.checklistinsider.com/brand/${brand}/page/${page}`;
      try {
        const { text } = await fetchText(url);
        let added = 0;
        for (const row of links(text, url)) {
          if (!/checklistinsider\.com\//i.test(row.url) || /\/brand\//i.test(row.url)) continue;
          if (!relevant(`${row.url} ${row.label}`)) continue;
          if (!candidates.has(row.url)) { candidates.set(row.url, { url: row.url, discoveredFrom: url }); added++; }
        }
        console.log(JSON.stringify({ phase: "brand", group: GROUP, brand, page, added, total: candidates.size }));
        empty = added ? 0 : empty + 1; if (page > 3 && empty >= 3) break;
      } catch (error) { discoveryFailures.push({ url, error: error instanceof Error ? error.message : String(error) }); empty++; if (page > 3 && empty >= 3) break; }
    }
  }

  const years = Array.from({ length: 76 }, (_, i) => 1950 + i);
  const queries = [...config.queries, ...years.flatMap((year) => config.queries.map((q) => `${year} ${q}`))];
  let qIndex = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (qIndex < queries.length && candidates.size < MAX_ARTICLES) {
      const query = queries[qIndex++];
      const searchUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
      try {
        const r = await fetch(searchUrl, { headers: { "user-agent": UA, accept: "application/rss+xml,application/xml,*/*" }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        for (const item of rssItems(await r.text())) {
          const u = normalize(item.link); if (!u || !relevant(`${item.title} ${u}`)) continue;
          if (/beckett\.com\/news|checklistinsider\.com|cardboardconnection\.com|tcdb\.com|laststicker\.com|upperdeck\.com|leaftradingcards\.com/i.test(u)) candidates.set(u, { url: u, discoveredFrom: `Bing RSS: ${query}` });
        }
      } catch (error) { discoveryFailures.push({ url: searchUrl, error: error instanceof Error ? error.message : String(error) }); }
    }
  });
  await Promise.all(workers);

  const articleRows: any[] = [];
  const fileRows: any[] = [];
  const pageFailures: any[] = [];
  let index = 0;
  for (const candidate of [...candidates.values()].slice(0, MAX_ARTICLES)) {
    index++;
    try {
      const { text, via } = await fetchText(candidate.url);
      const title = clean(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.url).slice(0, 300);
      const plain = clean(text);
      if (!relevant(`${title} ${plain.slice(0, 5000)}`)) continue;
      const filename = `${String(articleRows.length + 1).padStart(5, "0")}-${slug(title)}.txt`;
      writeFileSync(resolve(PAGES, filename), `SOURCE: ${candidate.url}\nDISCOVERED_FROM: ${candidate.discoveredFrom}\nVIA: ${via}\nTITLE: ${title}\n\n${plain}\n`);
      const found = fileLinks(text, candidate.url);
      articleRows.push({ title, url: candidate.url, discoveredFrom: candidate.discoveredFrom, via, filename, textBytes: Buffer.byteLength(plain), linkedFiles: found.length });
      for (const fileUrl of found) {
        let downloaded = false; let lastError = ""; const attempts = [{ url: fileUrl, via: "direct" }]; const archived = await latestWayback(fileUrl); if (archived) attempts.push({ url: archived, via: "wayback" });
        for (const attempt of attempts) {
          try {
            const r = await fetch(attempt.url, { headers: { "user-agent": UA, referer: candidate.url }, redirect: "follow", signal: AbortSignal.timeout(90000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const bytes = Buffer.from(await r.arrayBuffer()); if (bytes.length < 100) throw new Error(`Only ${bytes.length} bytes`);
            const original = basename(new URL(fileUrl).pathname) || `checklist${extname(fileUrl)}`;
            const local = `${String(fileRows.length + 1).padStart(5, "0")}-${slug(title)}-${slug(original)}${extname(original)}`;
            writeFileSync(resolve(FILES, local), bytes);
            fileRows.push({ title, sourcePage: candidate.url, url: fileUrl, via: attempt.via, filename: local, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
            downloaded = true; break;
          } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
        }
        if (!downloaded) fileRows.push({ title, sourcePage: candidate.url, url: fileUrl, error: lastError });
      }
      if (index % 25 === 0) console.log(JSON.stringify({ phase: "archive", group: GROUP, processed: index, snapshots: articleRows.length, files: fileRows.filter((r) => !r.error).length }));
    } catch (error) { pageFailures.push({ url: candidate.url, error: error instanceof Error ? error.message : String(error) }); }
  }

  const manifest = {
    schema: "tcos.missingChecklistUniverse.v1",
    generatedAt: new Date().toISOString(),
    group: GROUP,
    labels: config.labels,
    totals: {
      discoveredCandidates: candidates.size,
      checklistSnapshots: articleRows.length,
      linkedFileCandidates: fileRows.length,
      downloadedFiles: fileRows.filter((r) => !r.error).length,
      failedFiles: fileRows.filter((r) => r.error).length,
      failedPages: pageFailures.length,
      discoveryFailures: discoveryFailures.length,
    },
    articles: articleRows,
    files: fileRows,
    pageFailures,
    discoveryFailures,
  };
  writeFileSync(resolve(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest.totals));
  if (!articleRows.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); process.exitCode = 1; });
