import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Seed = { title: string; sport?: string; category?: string; year: string; sourcePage?: string; url: string };
type Config = {
  name: "Topps" | "Panini" | "Leaf" | "Upper Deck";
  seedPath: string;
  startUrls: string[];
  trustedHosts: string[];
  crawlHosts: string[];
  maxPages: number;
  checklistPagePattern?: RegExp;
};

const configs: Config[] = [
  {
    name: "Topps",
    seedPath: "data/topps-checklist-seeds.json",
    startUrls: [
      "https://www.topps.com/pages/checklists",
      "https://www.topps.com/pages/checklists/",
    ],
    trustedHosts: ["topps.com", "www.topps.com", "cdn.shopify.com"],
    crawlHosts: ["topps.com", "www.topps.com"],
    maxPages: 1000,
  },
  {
    name: "Panini",
    seedPath: "data/panini-checklist-seeds.json",
    startUrls: [
      "https://blog.paniniamerica.net/wp-sitemap.xml",
      "https://blog.paniniamerica.net/sitemap_index.xml",
      "https://blog.paniniamerica.net/wp-json/wp/v2/search?search=checklist&per_page=100&page=1",
      "https://blog.paniniamerica.net/wp-json/wp/v2/posts?search=checklist&per_page=100&page=1&_fields=link,date,title,content",
      "https://blog.paniniamerica.net/?s=checklist",
      "https://www.paniniamerica.net/checklist.html",
    ],
    trustedHosts: ["paniniamerica.net", "www.paniniamerica.net", "blog.paniniamerica.net", "assets.paniniamerica.net"],
    crawlHosts: ["paniniamerica.net", "www.paniniamerica.net", "blog.paniniamerica.net"],
    maxPages: 5000,
    checklistPagePattern: /^\/(?!wp-admin|wp-login)(?:[^?#]*checklist[^?#]*|wp-json\/wp\/v2\/(?:posts|search))(?:\/)?$/i,
  },
  {
    name: "Leaf",
    seedPath: "data/leaf-checklist-seeds.json",
    startUrls: [
      "https://www.leaftradingcards.com/",
      "https://www.leaftradingcards.com/sitemap.xml",
    ],
    trustedHosts: ["leaftradingcards.com", "www.leaftradingcards.com", "cdn.prod.website-files.com", "docs.google.com", "drive.google.com"],
    crawlHosts: ["leaftradingcards.com", "www.leaftradingcards.com"],
    maxPages: 1000,
  },
  {
    name: "Upper Deck",
    seedPath: "data/upper-deck-checklist-seeds.json",
    startUrls: [
      "https://upperdeck.com/checklists/",
      "https://upperdeck.com/checklist-category/hockey/",
      "https://upperdeck.com/category/checklist/",
      "https://upperdeck.com/wp-sitemap.xml",
    ],
    trustedHosts: ["upperdeck.com", "www.upperdeck.com"],
    crawlHosts: ["upperdeck.com", "www.upperdeck.com"],
    maxPages: 1500,
    checklistPagePattern: /^\/checklist\/[^/]+\/?$/i,
  },
];

const FILE_RE = /\.(pdf|xlsx?|csv|tsv|json|xml|html?|zip)(?:$|[?#])/i;
const CHECKLIST_RE = /(checklist|check-list|check_list|public[_-]?cl|\bcl(?:[_-]|\b))/i;

function hostAllowed(host: string, allowed: string[]) {
  const value = host.toLowerCase();
  return allowed.some((item) => value === item || value.endsWith(`.${item}`));
}

function decodeHtml(value: string) {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractLinks(body: string, base: string) {
  const links = new Set<string>();
  const normalized = decodeHtml(body);
  const patterns = [
    /(?:href|src)\s*=\s*["']([^"']+)["']/gi,
    /https:\/\/[^\s"'<>\\]+/gi,
    /<loc>\s*([^<]+?)\s*<\/loc>/gi,
    /"(?:link|url|guid|rendered)"\s*:\s*"(https?:[^"\\]*(?:\\.[^"\\]*)*)"/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const raw = decodeHtml(match[1] || match[0]);
      try {
        const url = new URL(raw, base);
        url.hash = "";
        links.add(url.toString());
      } catch {
        // Ignore malformed links.
      }
    }
  }
  return [...links];
}

function guessYear(value: string) {
  const range = value.match(/\b(20\d{2})[-_/](\d{2})\b/);
  if (range) return `${range[1]}-${range[2]}`;
  return value.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || "Unknown";
}

function guessCategory(value: string) {
  const text = value.toLowerCase();
  const categories: Array<[string, string[]]> = [
    ["Baseball", ["baseball", "bowman"]], ["Basketball", ["basketball", "nba", "wnba", "nbl", "hoops"]],
    ["Football", ["football", "nfl", "ufl", "gridiron"]], ["Hockey", ["hockey", "nhl", "pwhl", "ahl", "chl", "o-pee-chee", "parkhurst"]],
    ["Soccer", ["soccer", "uefa", "premier league", "mls", "fifa"]], ["Wrestling", ["wwe", "wrestling", "aew"]],
    ["Racing", ["formula 1", "formula-1", "f1", "racing", "nascar"]], ["UFC", ["ufc", "mma", "fight"]],
    ["Golf", ["golf"]], ["Celebrity", ["pop century", "celebrity"]],
    ["Entertainment", ["star wars", "marvel", "disney", "pixar", "spongebob", "stranger things", "dune", "garbage pail", "wacky packages", "dc", "entertainment"]],
    ["Multi-Sport", ["multi-sport", "multisport", "national silver", "national vip", "father's day", "fathers day", "black friday", "sports heroes", "game used", "goodwin champions"]],
  ];
  for (const [category, needles] of categories) if (needles.some((needle) => text.includes(needle))) return category;
  return "Miscellaneous";
}

function titleFromUrl(url: string) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const file = pathname.split("/").filter(Boolean).pop() || "Official Checklist";
  return file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TCOS-Checklist-Discovery/3.0; +https://totallycollectibles.com)",
      Accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: new URL(url).origin + "/",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text") && !contentType.includes("html") && !contentType.includes("json") && !contentType.includes("xml")) return "";
  return response.text();
}

function enqueueWordPressPagination(config: Config, page: string, body: string, queue: string[], seenPages: Set<string>) {
  if (config.name !== "Panini") return;
  const parsed = new URL(page);
  if (!parsed.pathname.startsWith("/wp-json/wp/v2/")) return;
  const current = Number(parsed.searchParams.get("page") || "1");
  if (!Number.isFinite(current) || current >= 100) return;
  const items = body.trim().startsWith("[") ? (body.match(/"(?:id|link)"\s*:/g)?.length ?? 0) : 0;
  if (items < 1) return;
  const next = new URL(parsed);
  next.searchParams.set("page", String(current + 1));
  if (!seenPages.has(next.toString()) && !queue.includes(next.toString())) queue.push(next.toString());
}

async function discover(config: Config) {
  const seedFile = resolve(process.cwd(), config.seedPath);
  const existing = JSON.parse(readFileSync(seedFile, "utf8")) as Seed[];
  const byUrl = new Map(existing.map((seed) => [seed.url, seed]));
  const queue = [...config.startUrls];
  const seenPages = new Set<string>();
  const pageFailures: Array<{ url: string; error: string; startPage: boolean }> = [];
  let newFiles = 0;

  while (queue.length && seenPages.size < config.maxPages) {
    const page = queue.shift()!;
    if (seenPages.has(page)) continue;
    seenPages.add(page);
    try {
      const body = await fetchText(page);
      enqueueWordPressPagination(config, page, body, queue, seenPages);
      for (const link of extractLinks(body, page)) {
        const parsed = new URL(link);
        const isFile = FILE_RE.test(parsed.pathname) && CHECKLIST_RE.test(link);
        const isChecklistPage = Boolean(config.checklistPagePattern?.test(parsed.pathname));
        if ((isFile || isChecklistPage) && hostAllowed(parsed.hostname, config.trustedHosts)) {
          if (!byUrl.has(link)) {
            const title = titleFromUrl(link);
            const category = guessCategory(`${title} ${page}`);
            byUrl.set(link, {
              title,
              year: guessYear(`${title} ${link} ${page}`),
              url: link,
              sourcePage: page,
              ...(config.name === "Leaf" ? { category } : { sport: category }),
            });
            newFiles += 1;
          }
          if (isChecklistPage && !FILE_RE.test(parsed.pathname) && !seenPages.has(link) && !queue.includes(link)) queue.push(link);
          continue;
        }
        if (!hostAllowed(parsed.hostname, config.crawlHosts)) continue;
        const path = parsed.pathname.toLowerCase();
        const useful = /checklist|product|products|collection|collections|category|brand|license|page\/|sitemap|wp-json\/wp\/v2|\?s=/.test(`${path}${parsed.search}`) || parsed.searchParams.has("page") || parsed.searchParams.has("s");
        if (useful && !seenPages.has(link) && !queue.includes(link)) queue.push(link);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const apiEnd = config.name === "Panini" && /wp-json\/wp\/v2/.test(page) && /HTTP 400/.test(message) && Number(new URL(page).searchParams.get("page") || "1") > 1;
      if (!apiEnd) pageFailures.push({ url: page, error: message, startPage: config.startUrls.includes(page) });
    }
  }

  const seeds = [...byUrl.values()].sort((a, b) => `${a.year}|${a.title}`.localeCompare(`${b.year}|${b.title}`));
  writeFileSync(seedFile, JSON.stringify(seeds, null, 2) + "\n");
  const hitPageLimit = seenPages.size >= config.maxPages && queue.length > 0;
  const successfulStartPages = config.startUrls.length - pageFailures.filter((failure) => failure.startPage).length;
  const catalogScanComplete = queue.length === 0 && !hitPageLimit && pageFailures.length === 0 && seenPages.size > 0;
  const discoveryStatus = catalogScanComplete ? "catalog-scan-complete" : successfulStartPages > 0 ? "still-discovering" : "discovery-blocked";
  return {
    manufacturer: config.name,
    seedPath: config.seedPath,
    startUrls: config.startUrls,
    pagesScanned: seenPages.size,
    pagesRemaining: queue.length,
    pageLimit: config.maxPages,
    hitPageLimit,
    successfulStartPages,
    catalogScanComplete,
    discoveryStatus,
    knownBefore: existing.length,
    newlyDiscovered: newFiles,
    discoveredTotal: seeds.length,
    pageFailures,
  };
}

async function main() {
  const reports = [];
  for (const config of configs) reports.push(await discover(config));
  const output = { schema: "tcos.checklistDiscoveryReport.v3", generatedAt: new Date().toISOString(), manufacturers: reports };
  const dir = resolve(process.cwd(), ".checklist-discovery");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "report.json"), JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(reports.map((row) => ({ manufacturer: row.manufacturer, pagesScanned: row.pagesScanned, pageFailures: row.pageFailures.length, newlyDiscovered: row.newlyDiscovered, discoveredTotal: row.discoveredTotal, catalogScanComplete: row.catalogScanComplete, discoveryStatus: row.discoveryStatus }))));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
