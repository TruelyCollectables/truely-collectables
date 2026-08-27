import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const ROOT = resolve(process.cwd(), ".panini-public-universe");
const PAGES = resolve(ROOT, "checklists");
const FILES = resolve(ROOT, "files");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const MAX_ARTICLES = Number(process.env.PANINI_PUBLIC_MAX_ARTICLES || 5000);
const MAX_CATEGORY_PAGES = Number(process.env.PANINI_PUBLIC_MAX_CATEGORY_PAGES || 70);
const YEARS = Array.from({ length: 18 }, (_, index) => 2009 + index);
const SPORTS = [
  "baseball",
  "basketball",
  "football",
  "hockey",
  "soccer",
  "racing",
  "wrestling",
  "ufc",
  "mma",
  "golf",
  "entertainment",
];
const BRAND_PATTERN =
  /\b(?:panini|donruss|score|prizm|contenders|select|mosaic|optic|immaculate|flawless|chronicles|prestige|phoenix|absolute|certified|spectra|crown royale|court kings|revolution|obsidian|origins|noir|national treasures|luminance|legacy|zenith)\b/i;
const CHECKLIST_PATTERN = /\b(?:checklist|card list|set list|team set|base set)\b/i;
const FILE_PATTERN = /\.(?:xlsx?|xlsm|csv|pdf|zip)(?:$|\?)/i;

type Candidate = {
  url: string;
  source: string;
  discoveredFrom: string;
};

type Failure = {
  url: string;
  source: string;
  error: string;
};

mkdirSync(PAGES, { recursive: true });
mkdirSync(FILES, { recursive: true });

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#039;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#8217;/g, "'");
}

function cleanHtml(input: string) {
  return decodeEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h1|h2|h3|h4|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 180) || "panini-checklist"
  );
}

function normalizeUrl(value: string, base?: string) {
  try {
    const parsed = new URL(decodeEntities(value), base);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function sourceName(url: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.includes("paniniamerica.net")) return "Panini official";
  if (host.includes("beckett.com")) return "Beckett public";
  if (host.includes("cardboardconnection.com")) return "Cardboard Connection";
  if (host.includes("checklistinsider.com")) return "Checklist Insider";
  if (host.includes("tcdb.com")) return "TCDB";
  if (host.includes("laststicker.com")) return "LastSticker";
  if (host.includes("web.archive.org")) return "Internet Archive";
  return host;
}

async function fetchResponse(
  url: string,
  options: { referer?: string; accept?: string; timeout?: number } = {},
) {
  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...(options.referer ? { referer: options.referer } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(options.timeout || 45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function fetchText(url: string) {
  try {
    const response = await fetchResponse(url);
    return { text: await response.text(), finalUrl: response.url, via: "direct" };
  } catch (directError) {
    const readerUrl = `https://r.jina.ai/${url}`;
    try {
      const response = await fetchResponse(readerUrl, {
        accept: "text/plain,text/markdown,*/*",
        timeout: 60_000,
      });
      return { text: await response.text(), finalUrl: url, via: "jina-reader" };
    } catch (readerError) {
      throw new Error(
        `direct=${directError instanceof Error ? directError.message : String(directError)}; ` +
          `reader=${readerError instanceof Error ? readerError.message : String(readerError)}`,
      );
    }
  }
}

function extractLinks(html: string, baseUrl: string) {
  const rows: Array<{ url: string; text: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = normalizeUrl(match[1], baseUrl);
    if (!url) continue;
    rows.push({ url, text: cleanHtml(match[2]) });
  }
  return rows;
}

function extractRawFileLinks(html: string, baseUrl: string) {
  const urls = new Set<string>();
  for (const row of extractLinks(html, baseUrl)) {
    if (FILE_PATTERN.test(row.url)) urls.add(row.url);
  }
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:xlsx?|xlsm|csv|pdf|zip)(?:\?[^\s"'<>]*)?/gi)) {
    const normalized = normalizeUrl(match[0]);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

function addCandidate(
  map: Map<string, Candidate>,
  url: string,
  discoveredFrom: string,
  label = "",
) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;
  const combined = `${normalized} ${label}`;
  if (!FILE_PATTERN.test(normalized) && !(BRAND_PATTERN.test(combined) && CHECKLIST_PATTERN.test(combined))) {
    return;
  }
  map.set(normalized, {
    url: normalized,
    source: sourceName(normalized),
    discoveredFrom,
  });
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let next = 0;
  async function runner() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => runner()));
  return output;
}

async function discoverFromCategory(
  candidates: Map<string, Candidate>,
  root: string,
  maxPages: number,
) {
  let consecutiveEmpty = 0;
  for (let page = 1; page <= maxPages && candidates.size < MAX_ARTICLES; page++) {
    const url = page === 1 ? root : `${root.replace(/\/$/, "")}/page/${page}/`;
    try {
      const { text } = await fetchText(url);
      let added = 0;
      for (const link of extractLinks(text, url)) {
        const before = candidates.size;
        addCandidate(candidates, link.url, url, link.text);
        if (candidates.size > before) added += 1;
      }
      console.log(JSON.stringify({ phase: "category", url, added, total: candidates.size }));
      consecutiveEmpty = added === 0 ? consecutiveEmpty + 1 : 0;
      if (page > 3 && consecutiveEmpty >= 3) break;
    } catch (error) {
      consecutiveEmpty += 1;
      console.log(
        JSON.stringify({
          phase: "category-failure",
          url,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (page > 3 && consecutiveEmpty >= 3) break;
    }
  }
}

function rssItems(xml: string) {
  const rows: Array<{ title: string; link: string }> = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const title = decodeEntities(item[1].match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || "");
    const link = decodeEntities(item[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    if (link) rows.push({ title, link });
  }
  return rows;
}

async function discoverFromBing(candidates: Map<string, Candidate>) {
  const queries: string[] = [];
  for (const year of YEARS) {
    queries.push(`site:beckett.com/news ${year} Panini checklist`);
    queries.push(`site:cardboardconnection.com ${year} Panini checklist`);
    queries.push(`site:checklistinsider.com ${year} Panini checklist`);
    queries.push(`site:tcdb.com ${year} Panini checklist`);
    queries.push(`site:laststicker.com/cards/panini ${year}`);
    queries.push(`site:assets.paniniamerica.net/checklist ${year}`);
  }
  for (const sport of SPORTS) {
    queries.push(`site:beckett.com/news Panini ${sport} checklist`);
    queries.push(`site:cardboardconnection.com Panini ${sport} checklist`);
  }

  await mapLimit(queries, 5, async (query) => {
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    try {
      const response = await fetchResponse(url, { accept: "application/rss+xml,application/xml,text/xml,*/*" });
      const xml = await response.text();
      let added = 0;
      for (const item of rssItems(xml)) {
        const before = candidates.size;
        addCandidate(candidates, item.link, `Bing RSS: ${query}`, item.title);
        if (candidates.size > before) added += 1;
      }
      console.log(JSON.stringify({ phase: "bing", query, added, total: candidates.size }));
    } catch (error) {
      console.log(
        JSON.stringify({
          phase: "bing-failure",
          query,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

async function discoverFromWayback(candidates: Map<string, Candidate>) {
  const patterns = [
    "www.beckett.com/news/*panini*",
    "www.cardboardconnection.com/*panini*",
    "www.checklistinsider.com/*panini*",
    "assets.paniniamerica.net/checklist/*",
  ];
  await mapLimit(patterns, 2, async (pattern) => {
    const cdx =
      "https://web.archive.org/cdx/search/cdx?output=json&fl=timestamp,original,statuscode,mimetype" +
      `&filter=statuscode:200&collapse=urlkey&from=2009&to=2026&limit=10000&url=${encodeURIComponent(pattern)}`;
    try {
      const response = await fetchResponse(cdx, { accept: "application/json,*/*", timeout: 90_000 });
      const data = JSON.parse(await response.text()) as string[][];
      let added = 0;
      for (const row of data.slice(1)) {
        const [timestamp, original] = row;
        if (!timestamp || !original) continue;
        const before = candidates.size;
        addCandidate(candidates, original, `Wayback CDX ${timestamp}`, original);
        if (candidates.size > before) added += 1;
      }
      console.log(JSON.stringify({ phase: "wayback", pattern, added, total: candidates.size }));
    } catch (error) {
      console.log(
        JSON.stringify({
          phase: "wayback-failure",
          pattern,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}

async function latestWaybackFile(url: string) {
  const cdx =
    "https://web.archive.org/cdx/search/cdx?output=json&fl=timestamp,original,statuscode" +
    `&filter=statuscode:200&collapse=digest&limit=5&url=${encodeURIComponent(url)}`;
  try {
    const response = await fetchResponse(cdx, { accept: "application/json,*/*", timeout: 60_000 });
    const data = JSON.parse(await response.text()) as string[][];
    const row = data.at(-1);
    if (!row?.[0] || !row?.[1]) return null;
    return `https://web.archive.org/web/${row[0]}id_/${row[1]}`;
  } catch {
    return null;
  }
}

async function downloadFile(
  url: string,
  title: string,
  sourcePage: string,
  ordinal: number,
) {
  const attempts: Array<{ url: string; via: string }> = [{ url, via: "direct" }];
  const archived = await latestWaybackFile(url);
  if (archived) attempts.push({ url: archived, via: "wayback" });

  let lastError = "unknown";
  for (const attempt of attempts) {
    try {
      const response = await fetchResponse(attempt.url, {
        referer: sourcePage,
        accept: "application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/zip,*/*",
        timeout: 90_000,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100) throw new Error(`Only ${bytes.length} bytes`);
      const originalName = basename(new URL(url).pathname) || `checklist${extname(url)}`;
      const filename = `${String(ordinal).padStart(5, "0")}-${slug(title)}-${slug(originalName)}${extname(originalName)}`;
      writeFileSync(resolve(FILES, filename), bytes);
      return {
        url,
        sourcePage,
        title,
        filename,
        via: attempt.via,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { url, sourcePage, title, error: lastError };
}

function inferYear(value: string) {
  return value.match(/\b(19\d{2}|20\d{2})(?:-\d{2})?\b/)?.[0] || "Unknown";
}

function inferSport(value: string) {
  const lower = value.toLowerCase();
  for (const sport of SPORTS) {
    if (lower.includes(sport)) return sport;
  }
  if (lower.includes("wwe")) return "wrestling";
  if (lower.includes("nascar")) return "racing";
  return "miscellaneous";
}

function extractChecklistText(text: string) {
  const clean = text.includes("<") ? cleanHtml(text) : decodeEntities(text).replace(/\r/g, "").trim();
  const lower = clean.toLowerCase();
  const markers = [
    "full checklist",
    "base set checklist",
    "checklist –",
    "checklist -",
    " checklist",
  ];
  let start = -1;
  for (const marker of markers) {
    const index = lower.indexOf(marker);
    if (index >= 0 && (start < 0 || index < start)) start = index;
  }
  const selected = start >= 0 ? clean.slice(Math.max(0, start - 250)) : clean;
  return selected.slice(0, 4_000_000);
}

async function main() {
  const candidates = new Map<string, Candidate>();
  const categoryRoots = [
    "https://www.beckett.com/news/category/checklists-new/",
    "https://www.beckett.com/news/category/new/",
    "https://www.beckett.com/news/category/baseball-card-checklists/",
    "https://www.beckett.com/news/category/baseball/baseball-card-checklists/",
    "https://www.beckett.com/news/category/checklists-beckett-football/",
    "https://www.beckett.com/news/category/beckett-football/checklists-beckett-football/",
    "https://www.beckett.com/news/category/basketball-card-checklists/",
    "https://www.beckett.com/news/category/beckett-basketball/checklists-beckett-basketball/",
    "https://www.beckett.com/news/category/hockey-card-checklists/",
    "https://www.beckett.com/news/category/beckett-hockey/checklists-beckett-hockey/",
    "https://www.beckett.com/news/category/soccer-card-checklists/",
    "https://www.beckett.com/news/category/beckett-soccer/checklists-beckett-soccer/",
    "https://www.beckett.com/news/category/beckett-racing/checklists-beckett-racing/",
    "https://www.beckett.com/news/category/wrestling-card-checklists/",
    "https://www.beckett.com/news/category/ufc-and-mma-cards/",
    "https://www.checklistinsider.com/brand/panini",
    "https://www.cardboardconnection.com/?s=panini+checklist",
  ];

  for (const root of categoryRoots) {
    await discoverFromCategory(candidates, root, MAX_CATEGORY_PAGES);
  }
  await Promise.all([discoverFromBing(candidates), discoverFromWayback(candidates)]);

  const selected = [...candidates.values()].slice(0, MAX_ARTICLES);
  const failures: Failure[] = [];
  const pages: any[] = [];
  const fileCandidates = new Map<string, { url: string; title: string; sourcePage: string }>();

  await mapLimit(selected, 8, async (candidate, index) => {
    if (FILE_PATTERN.test(candidate.url)) {
      fileCandidates.set(candidate.url, {
        url: candidate.url,
        title: basename(new URL(candidate.url).pathname),
        sourcePage: candidate.discoveredFrom,
      });
      return;
    }
    try {
      const fetched = await fetchText(candidate.url);
      const title = cleanHtml(
        fetched.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
          fetched.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
          fetched.text.match(/^#\s+(.+)$/m)?.[1] ||
          candidate.url,
      );
      const checklistText = extractChecklistText(fetched.text);
      const identifying = `${title}\n${candidate.url}\n${checklistText.slice(0, 20_000)}`;
      if (!BRAND_PATTERN.test(identifying) || !CHECKLIST_PATTERN.test(identifying)) return;
      const filename = `${String(index + 1).padStart(5, "0")}-${slug(title)}.txt`;
      writeFileSync(
        resolve(PAGES, filename),
        `SOURCE: ${candidate.url}\nTITLE: ${title}\nSOURCE TYPE: ${candidate.source}\nRETRIEVAL: ${fetched.via}\n\n${checklistText}\n`,
      );
      const foundFiles = extractRawFileLinks(fetched.text, candidate.url);
      for (const url of foundFiles) {
        fileCandidates.set(url, { url, title, sourcePage: candidate.url });
      }
      pages.push({
        title,
        url: candidate.url,
        source: candidate.source,
        discoveredFrom: candidate.discoveredFrom,
        retrieval: fetched.via,
        year: inferYear(title),
        sport: inferSport(title),
        filename,
        textBytes: Buffer.byteLength(checklistText),
        linkedFiles: foundFiles.length,
      });
      if (pages.length % 25 === 0) {
        console.log(JSON.stringify({ phase: "pages", archived: pages.length, candidates: selected.length }));
      }
    } catch (error) {
      failures.push({
        url: candidate.url,
        source: candidate.source,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  const downloadable = [...fileCandidates.values()];
  const files = await mapLimit(downloadable, 5, async (candidate, index) =>
    downloadFile(candidate.url, candidate.title, candidate.sourcePage, index + 1),
  );

  const bySource: Record<string, number> = {};
  const byYear: Record<string, number> = {};
  const bySport: Record<string, number> = {};
  for (const row of pages) {
    bySource[row.source] = (bySource[row.source] || 0) + 1;
    byYear[row.year] = (byYear[row.year] || 0) + 1;
    bySport[row.sport] = (bySport[row.sport] || 0) + 1;
  }

  const manifest = {
    schema: "tcos.paniniPublicUniverse.v1",
    generatedAt: new Date().toISOString(),
    scope: {
      years: [YEARS[0], YEARS.at(-1)],
      sources: [
        "Panini official public assets",
        "Beckett public checklist articles",
        "Cardboard Connection public checklist articles",
        "Checklist Insider public checklist articles",
        "TCDB public set pages",
        "LastSticker public sticker checklists",
        "Internet Archive public snapshots",
      ],
      note: "Public sources only. No login, paywall, or access-control bypass was used.",
    },
    totals: {
      discoveredCandidates: candidates.size,
      selectedCandidates: selected.length,
      checklistSnapshots: pages.length,
      linkedFileCandidates: downloadable.length,
      downloadedFiles: files.filter((row) => !("error" in row)).length,
      failedFiles: files.filter((row) => "error" in row).length,
      failedPages: failures.length,
    },
    bySource,
    byYear,
    bySport,
    pages,
    files,
    failures,
  };
  writeFileSync(resolve(ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    resolve(ROOT, "MISSING.md"),
    [
      "# Panini checklist gaps",
      "",
      `Generated: ${manifest.generatedAt}`,
      "",
      "This archive contains every public Panini checklist artifact found by the current sweep.",
      "Remaining gaps include sets absent from public indexes, pages removed before archiving, blocked files with no Wayback copy, and any login-only or licensed catalogs.",
      "",
      `- Checklist snapshots: ${manifest.totals.checklistSnapshots}`,
      `- Downloaded files: ${manifest.totals.downloadedFiles}`,
      `- Failed file downloads: ${manifest.totals.failedFiles}`,
      `- Failed page retrievals: ${manifest.totals.failedPages}`,
      "",
      "See manifest.json for exact URLs and failures.",
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify(manifest.totals));
  if (pages.length === 0 && files.filter((row) => !("error" in row)).length === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
