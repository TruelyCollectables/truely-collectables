import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type Seed = { title: string; sport?: string; year: string; sourcePage?: string; url: string };
type Manufacturer = {
  name: "Topps" | "Panini";
  seedPath: string;
  trustedHosts: string[];
  crawlHosts: string[];
  startUrls: string[];
  searches: string[];
  maxPages: number;
};

const manufacturers: Manufacturer[] = [
  {
    name: "Topps",
    seedPath: "data/topps-checklist-seeds.json",
    trustedHosts: ["topps.com", "www.topps.com", "cdn.shopify.com"],
    crawlHosts: ["topps.com", "www.topps.com"],
    startUrls: [
      "https://www.topps.com/pages/checklists",
      "https://www.topps.com/sitemap.xml",
      "https://www.topps.com/sitemap_pages_1.xml",
      "https://www.topps.com/sitemap_products_1.xml",
    ],
    searches: [
      "site:topps.com checklist Topps PDF OR XLS OR XLSX",
      "site:cdn.shopify.com Topps checklist xlsx OR pdf",
      "site:topps.com/pages/checklists Topps",
    ],
    maxPages: 800,
  },
  {
    name: "Panini",
    seedPath: "data/panini-checklist-seeds.json",
    trustedHosts: ["paniniamerica.net", "www.paniniamerica.net", "blog.paniniamerica.net", "assets.paniniamerica.net"],
    crawlHosts: ["paniniamerica.net", "www.paniniamerica.net", "blog.paniniamerica.net"],
    startUrls: [
      "https://blog.paniniamerica.net/wp-sitemap.xml",
      "https://blog.paniniamerica.net/sitemap_index.xml",
      "https://blog.paniniamerica.net/?s=checklist",
      "https://www.paniniamerica.net/checklist.html",
    ],
    searches: [
      "site:blog.paniniamerica.net checklist Panini PDF OR XLS OR XLSX",
      "site:assets.paniniamerica.net checklist PDF OR XLS OR XLSX",
      "site:paniniamerica.net checklist Panini",
    ],
    maxPages: 1800,
  },
];

const FILE_RE = /\.(pdf|xlsx?|csv|tsv|json|xml|html?|zip)(?:$|[?#])/i;
const CHECKLIST_RE = /(checklist|check-list|check_list|public[_-]?cl|\bcl(?:[_-]|\b))/i;

function allowed(host: string, hosts: string[]) {
  const value = host.toLowerCase();
  return hosts.some((host) => value === host || value.endsWith(`.${host}`));
}

function clean(value: string) {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&")
    .replace(/[)>\],.;]+$/g, "")
    .trim();
}

function linksFrom(body: string, base: string) {
  const links = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+/gi,
    /\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi,
    /<loc>\s*([^<]+?)\s*<\/loc>/gi,
    /(?:href|src)\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      try {
        const url = new URL(clean(match[1] || match[0]), base);
        url.hash = "";
        links.add(url.toString());
      } catch {
        // Ignore malformed links.
      }
    }
  }
  return [...links];
}

function titleFromUrl(url: string) {
  const file = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).pop() || "Official Checklist";
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
    ["Baseball", ["baseball", "bowman"]],
    ["Basketball", ["basketball", "nba", "wnba", "hoops"]],
    ["Football", ["football", "nfl", "gridiron"]],
    ["Hockey", ["hockey", "nhl"]],
    ["Soccer", ["soccer", "fifa", "uefa", "premier league"]],
    ["Racing", ["nascar", "racing", "formula 1", "f1"]],
    ["Wrestling", ["wwe", "wrestling"]],
    ["UFC", ["ufc", "mma"]],
    ["Entertainment", ["marvel", "star wars", "disney", "entertainment"]],
    ["Multi-Sport", ["national", "father's day", "fathers day", "black friday", "multi-sport"]],
  ];
  return rows.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || "Miscellaneous";
}

async function request(url: string, accept = "text/plain") {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "TCOS-Checklist-Archive/1.0 (+https://totallycollectibles.com)",
      "X-Return-Format": "markdown",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function reader(target: string) {
  return request(`https://r.jina.ai/${target}`);
}

async function search(query: string) {
  return request(`https://s.jina.ai/${encodeURIComponent(query)}`);
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function runManufacturer(config: Manufacturer) {
  const seedPath = resolve(process.cwd(), config.seedPath);
  const existing = JSON.parse(readFileSync(seedPath, "utf8")) as Seed[];
  const seeds = new Map(existing.map((seed) => [seed.url, seed]));
  const queue = [...config.startUrls];
  const seen = new Set<string>();
  const failures: Array<{ url: string; error: string }> = [];
  let newlyDiscovered = 0;

  for (const query of config.searches) {
    try {
      const body = await search(query);
      for (const link of linksFrom(body, "https://s.jina.ai/")) {
        const parsed = new URL(link);
        if (allowed(parsed.hostname, config.trustedHosts) && !queue.includes(link)) queue.push(link);
      }
    } catch (error) {
      failures.push({ url: `search:${query}`, error: error instanceof Error ? error.message : String(error) });
    }
    await sleep(3_250);
  }

  while (queue.length && seen.size < config.maxPages) {
    const page = queue.shift()!;
    if (seen.has(page)) continue;
    seen.add(page);
    try {
      const parsedPage = new URL(page);
      if (!allowed(parsedPage.hostname, [...config.trustedHosts, ...config.crawlHosts])) continue;
      const body = await reader(page);
      for (const link of linksFrom(body, page)) {
        const parsed = new URL(link);
        const isOfficialFile = allowed(parsed.hostname, config.trustedHosts) && FILE_RE.test(parsed.pathname) && CHECKLIST_RE.test(link);
        if (isOfficialFile && !seeds.has(link)) {
          const title = titleFromUrl(link);
          seeds.set(link, {
            title,
            year: yearFrom(`${title} ${link} ${page}`),
            sport: sportFrom(`${title} ${link} ${page}`),
            sourcePage: page,
            url: link,
          });
          newlyDiscovered += 1;
        }
        if (!allowed(parsed.hostname, config.crawlHosts)) continue;
        const useful = /checklist|product|collection|category|brand|page\/|sitemap|wp-json|\?s=/.test(`${parsed.pathname}${parsed.search}`);
        if (useful && !seen.has(link) && !queue.includes(link)) queue.push(link);
      }
    } catch (error) {
      failures.push({ url: page, error: error instanceof Error ? error.message : String(error) });
    }
    await sleep(3_250);
  }

  const output = [...seeds.values()].sort((a, b) => `${a.year}|${a.title}`.localeCompare(`${b.year}|${b.title}`));
  writeFileSync(seedPath, JSON.stringify(output, null, 2) + "\n");
  return {
    manufacturer: config.name,
    knownBefore: existing.length,
    newlyDiscovered,
    discoveredTotal: output.length,
    pagesProcessed: seen.size,
    pagesRemaining: queue.length,
    hitPageLimit: queue.length > 0 && seen.size >= config.maxPages,
    failures,
  };
}

async function main() {
  const reports = [];
  for (const config of manufacturers) reports.push(await runManufacturer(config));
  const dir = resolve(process.cwd(), ".checklist-reader-discovery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "report.json"), JSON.stringify({ schema: "tcos.readerDiscovery.v1", generatedAt: new Date().toISOString(), manufacturers: reports }, null, 2) + "\n");
  console.log(JSON.stringify(reports.map(({ manufacturer, newlyDiscovered, discoveredTotal, pagesProcessed, pagesRemaining }) => ({ manufacturer, newlyDiscovered, discoveredTotal, pagesProcessed, pagesRemaining }))));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
