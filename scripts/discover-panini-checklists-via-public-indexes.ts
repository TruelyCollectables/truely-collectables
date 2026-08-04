import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Seed = { title: string; sport: string; year: string; sourcePage?: string; url: string };
type Failure = { url: string; error: string };

const SEED_PATH = resolve(process.cwd(), "data/panini-checklist-seeds.json");
const REPORT_DIR = resolve(process.cwd(), ".panini-index-discovery");
const OFFICIAL_ASSET_HOSTS = ["blog.paniniamerica.net", "assets.paniniamerica.net", "www.paniniamerica.net", "paniniamerica.net"];
const OFFICIAL_PAGE_HOSTS = ["blog.paniniamerica.net", "www.paniniamerica.net", "paniniamerica.net"];
const FILE_RE = /\.(pdf|xlsx?|csv|zip)(?:$|[?#])/i;
const CHECKLIST_RE = /(checklist|check-list|check_list|public[_-]?cl|media[_-]?checklist)/i;
const STARTED_AT = Date.now();
const RUNTIME_CAP_MS = 9 * 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CONCURRENCY = 8;
const MAX_PAGES = 900;

function allowed(host: string, hosts: string[]) {
  const value = host.toLowerCase();
  return hosts.some((candidate) => value === candidate || value.endsWith(`.${candidate}`));
}

function clean(value: string) {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/\]\([^)]*$/g, "")
    .replace(/[)>\],.;*]+$/g, "")
    .trim();
}

function linksFrom(body: string, base: string) {
  const links = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+/gi,
    /\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi,
    /<loc>\s*([^<]+?)\s*<\/loc>/gi,
    /<link>\s*([^<]+?)\s*<\/link>/gi,
    /(?:href|src)\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      try {
        const parsed = new URL(clean(match[1] || match[0]), base);
        parsed.hash = "";
        links.add(parsed.toString());
      } catch {
        // Ignore malformed search/index markup.
      }
    }
  }
  return [...links];
}

function titleFromUrl(url: string) {
  const file = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).pop() || "Official Panini Checklist";
  return file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function yearFrom(value: string) {
  const season = value.match(/\b(20\d{2})[-_/](\d{2})\b/);
  if (season) return `${season[1]}-${season[2]}`;
  return value.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || "Unknown";
}

function sportFrom(value: string) {
  const text = value.toLowerCase();
  const rows: Array<[string, string[]]> = [
    ["Baseball", ["baseball"]],
    ["Basketball", ["basketball", "nba", "wnba", "hoops"]],
    ["Football", ["football", "nfl", "gridiron"]],
    ["Hockey", ["hockey", "nhl"]],
    ["Soccer", ["soccer", "fifa", "uefa", "premier league", "world cup"]],
    ["Racing", ["nascar", "racing", "formula 1", "f1"]],
    ["Wrestling", ["wwe", "wrestling"]],
    ["UFC", ["ufc", "mma", "fight"]],
    ["Entertainment", ["marvel", "disney", "entertainment"]],
    ["Golf", ["golf"]],
    ["Multi-Sport", ["national", "father's day", "fathers day", "black friday", "boxing day", "multi-sport"]],
  ];
  return rows.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || "Miscellaneous";
}

async function request(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml,application/xml,text/html,text/plain,*/*",
      "User-Agent": "TCOS-Panini-Index-Discovery/1.0 (+https://totallycollectibles.com)",
      "X-Return-Format": "markdown",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function reader(target: string) {
  return request(`https://r.jina.ai/${target}`);
}

function bingRss(query: string, first = 1) {
  return `https://www.bing.com/search?format=rss&count=50&first=${first}&q=${encodeURIComponent(query)}`;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const existing = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed[];
  const seeds = new Map(existing.map((seed) => [seed.url, seed]));
  const pageQueue: string[] = [];
  const queued = new Set<string>();
  const seen = new Set<string>();
  const failures: Failure[] = [];
  let newlyDiscovered = 0;

  const queuePage = (url: string) => {
    try {
      const parsed = new URL(url);
      if (!allowed(parsed.hostname, OFFICIAL_PAGE_HOSTS) || queued.has(parsed.toString()) || seen.has(parsed.toString())) return;
      queued.add(parsed.toString());
      pageQueue.push(parsed.toString());
    } catch {
      // Ignore malformed URLs.
    }
  };

  const addFile = (url: string, sourcePage: string) => {
    try {
      const parsed = new URL(clean(url));
      if (!allowed(parsed.hostname, OFFICIAL_ASSET_HOSTS)) return;
      if (!FILE_RE.test(`${parsed.pathname}${parsed.search}`) || !CHECKLIST_RE.test(parsed.toString())) return;
      parsed.hash = "";
      const normalized = parsed.toString();
      if (seeds.has(normalized)) return;
      const title = titleFromUrl(normalized);
      seeds.set(normalized, {
        title,
        sport: sportFrom(`${title} ${normalized} ${sourcePage}`),
        year: yearFrom(`${title} ${normalized} ${sourcePage}`),
        sourcePage,
        url: normalized,
      });
      newlyDiscovered += 1;
    } catch {
      // Ignore malformed file URLs.
    }
  };

  // Official entry points, feeds, search pages, and yearly archives.
  for (const url of [
    "https://www.paniniamerica.net/checklist.html",
    "https://blog.paniniamerica.net/?s=checklist",
    "https://blog.paniniamerica.net/?s=checklist&feed=rss2",
    "https://blog.paniniamerica.net/feed/?s=checklist",
    "https://blog.paniniamerica.net/wp-sitemap.xml",
    "https://blog.paniniamerica.net/sitemap_index.xml",
  ]) queuePage(url);
  for (let page = 2; page <= 80; page += 1) queuePage(`https://blog.paniniamerica.net/page/${page}/?s=checklist`);

  const queries: string[] = [];
  for (let year = 2009; year <= new Date().getUTCFullYear(); year += 1) {
    queries.push(`site:blog.paniniamerica.net ${year} Panini checklist`);
    queries.push(`site:blog.paniniamerica.net/wp-content/uploads/${year} checklist pdf`);
  }
  for (const sport of ["football", "basketball", "baseball", "hockey", "soccer", "racing", "ufc", "wwe", "national", "black friday", "boxing day"]) {
    queries.push(`site:blog.paniniamerica.net Panini ${sport} checklist`);
  }
  queries.push("site:assets.paniniamerica.net Panini checklist pdf");
  queries.push("site:paniniamerica.net checklist pdf");

  // Public indexes locate pages; every accepted page/file must still be hosted by Panini.
  const indexJobs: Array<{ url: string; label: string }> = [];
  for (const query of queries) {
    for (const first of [1, 51, 101]) indexJobs.push({ url: bingRss(query, first), label: `bing:${query}:${first}` });
  }

  for (let offset = 0; offset < indexJobs.length && Date.now() - STARTED_AT < RUNTIME_CAP_MS; offset += CONCURRENCY) {
    const batch = indexJobs.slice(offset, offset + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((job) => request(job.url)));
    results.forEach((result, index) => {
      const job = batch[index];
      if (result.status === "rejected") {
        failures.push({ url: job.label, error: String(result.reason) });
        return;
      }
      for (const link of linksFrom(result.value, job.url)) {
        try {
          const parsed = new URL(link);
          if (allowed(parsed.hostname, OFFICIAL_PAGE_HOSTS)) queuePage(link);
          if (allowed(parsed.hostname, OFFICIAL_ASSET_HOSTS)) addFile(link, job.label);
        } catch {
          // Ignore malformed index links.
        }
      }
    });
  }

  while (pageQueue.length && seen.size < MAX_PAGES && Date.now() - STARTED_AT < RUNTIME_CAP_MS) {
    const batch: string[] = [];
    while (pageQueue.length && batch.length < CONCURRENCY) {
      const page = pageQueue.shift()!;
      queued.delete(page);
      if (seen.has(page)) continue;
      seen.add(page);
      batch.push(page);
    }
    if (!batch.length) continue;
    const results = await Promise.allSettled(batch.map((page) => reader(page)));
    results.forEach((result, index) => {
      const page = batch[index];
      if (result.status === "rejected") {
        failures.push({ url: page, error: String(result.reason) });
        return;
      }
      for (const link of linksFrom(result.value, page)) {
        try {
          const parsed = new URL(link);
          if (allowed(parsed.hostname, OFFICIAL_ASSET_HOSTS)) addFile(link, page);
          if (allowed(parsed.hostname, OFFICIAL_PAGE_HOSTS) && /checklist|panini|product|page\/|\?s=|sitemap|feed/.test(`${parsed.pathname}${parsed.search}`.toLowerCase())) {
            queuePage(link);
          }
        } catch {
          // Ignore malformed links.
        }
      }
    });

    const output = [...seeds.values()].sort((a, b) => `${a.year}|${a.sport}|${a.title}`.localeCompare(`${b.year}|${b.sport}|${b.title}`));
    writeFileSync(SEED_PATH, JSON.stringify(output, null, 2) + "\n");
  }

  const output = [...seeds.values()].sort((a, b) => `${a.year}|${a.sport}|${a.title}`.localeCompare(`${b.year}|${b.sport}|${b.title}`));
  writeFileSync(SEED_PATH, JSON.stringify(output, null, 2) + "\n");
  const report = {
    schema: "tcos.paniniIndexDiscovery.v1",
    generatedAt: new Date().toISOString(),
    runtimeMs: Date.now() - STARTED_AT,
    knownBefore: existing.length,
    newlyDiscovered,
    discoveredTotal: output.length,
    officialPagesProcessed: seen.size,
    pagesRemaining: pageQueue.length,
    runtimeCapped: Date.now() - STARTED_AT >= RUNTIME_CAP_MS,
    hitPageLimit: seen.size >= MAX_PAGES && pageQueue.length > 0,
    failures,
  };
  writeFileSync(resolve(REPORT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ newlyDiscovered, discoveredTotal: output.length, officialPagesProcessed: seen.size, pagesRemaining: pageQueue.length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
