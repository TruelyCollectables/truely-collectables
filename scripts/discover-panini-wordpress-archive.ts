import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Seed = {
  title: string;
  sport: string;
  year: string;
  sourcePage?: string;
  url: string;
};

type WpPost = {
  link?: string;
  date?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
};

type WpMedia = {
  link?: string;
  date?: string;
  source_url?: string;
  title?: { rendered?: string };
  caption?: { rendered?: string };
};

const SEED_PATH = resolve(process.cwd(), "data/panini-checklist-seeds.json");
const REPORT_DIR = resolve(process.cwd(), ".panini-wordpress-discovery");
const REPORT_PATH = resolve(REPORT_DIR, "report.json");
const API_ROOT = "https://blog.paniniamerica.net/wp-json/wp/v2";
const FILE_RE = /\.(pdf|xlsx?|xlsm|csv)(?:$|[?#])/i;
const SEARCH_TERMS = ["checklist", "quality control", "checklist reveal", "product checklist"];

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(raw: string, base: string): string | null {
  try {
    const value = decodeHtml(raw).replace(/\\\//g, "/").replace(/[)>\],.;*]+$/g, "");
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "blog.paniniamerica.net" ||
      host === "assets.paniniamerica.net" ||
      host === "paniniamerica.net" ||
      host.endsWith(".paniniamerica.net");
    if (!allowed || !FILE_RE.test(url.toString())) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractFileUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /href\s*=\s*["']([^"']+)["']/gi,
    /https?:\/\/[^\s"'<>\\]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const url = normalizeUrl(match[1] ?? match[0], base);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

function inferYear(value: string): string {
  const season = value.match(/\b(20\d{2})\s*[-/]\s*(\d{2})\b/);
  if (season) return `${season[1]}-${season[2]}`;
  return value.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? "Unknown";
}

function inferSport(value: string): string {
  const text = value.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["Baseball", ["baseball", "mlb", "donruss baseball"]],
    ["Basketball", ["basketball", "nba", "wnba", "hoops", "prizm basketball"]],
    ["Football", ["football", "nfl", "gridiron", "prizm football"]],
    ["Hockey", ["hockey", "nhl"]],
    ["Soccer", ["soccer", "fifa", "premier league", "select soccer", "world cup"]],
    ["Racing", ["racing", "nascar"]],
    ["Wrestling", ["wwe", "wrestling"]],
    ["UFC", ["ufc", "mma"]],
    ["Golf", ["golf"]],
    ["Entertainment", ["entertainment", "disney", "marvel", "fortnite"]],
    ["Multi-Sport", ["national", "black friday", "boxing day", "father's day", "multi-sport"]],
  ];
  return rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? "Miscellaneous";
}

async function fetchJson<T>(url: string): Promise<{ data: T; totalPages: number }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TCOS-Panini-WordPress-Archive/1.0",
      Accept: "application/json,*/*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    data: (await response.json()) as T,
    totalPages: Number(response.headers.get("x-wp-totalpages") ?? "1") || 1,
  };
}

function addSeed(
  byUrl: Map<string, Seed>,
  url: string,
  sourcePage: string,
  titleHint: string,
  dateHint?: string,
): boolean {
  if (byUrl.has(url)) return false;
  const fileTitle = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = decodeHtml(titleHint) || fileTitle || "Official Panini Checklist";
  byUrl.set(url, {
    title,
    sport: inferSport(`${title} ${fileTitle} ${url}`),
    year: inferYear(`${title} ${fileTitle} ${dateHint ?? ""} ${url}`),
    sourcePage,
    url,
  });
  return true;
}

async function crawlPosts(byUrl: Map<string, Seed>) {
  const stats: Array<{ term: string; pages: number; posts: number; files: number; added: number }> = [];
  const failures: Array<{ endpoint: string; error: string }> = [];

  for (const term of SEARCH_TERMS) {
    let page = 1;
    let totalPages = 1;
    let posts = 0;
    let files = 0;
    let added = 0;
    do {
      const endpoint = `${API_ROOT}/posts?search=${encodeURIComponent(term)}&per_page=100&page=${page}&_fields=link,date,title,content`;
      try {
        const result = await fetchJson<WpPost[]>(endpoint);
        totalPages = Math.min(result.totalPages, 100);
        posts += result.data.length;
        for (const post of result.data) {
          const sourcePage = post.link ?? "https://blog.paniniamerica.net/";
          const html = post.content?.rendered ?? "";
          const urls = extractFileUrls(html, sourcePage);
          files += urls.length;
          for (const url of urls) {
            if (addSeed(byUrl, url, sourcePage, post.title?.rendered ?? "", post.date)) added += 1;
          }
        }
      } catch (error) {
        failures.push({ endpoint, error: error instanceof Error ? error.message : String(error) });
        break;
      }
      page += 1;
    } while (page <= totalPages);
    stats.push({ term, pages: page - 1, posts, files, added });
  }

  return { stats, failures };
}

async function crawlMedia(byUrl: Map<string, Seed>) {
  const stats: Array<{ term: string; pages: number; media: number; files: number; added: number }> = [];
  const failures: Array<{ endpoint: string; error: string }> = [];

  for (const term of SEARCH_TERMS) {
    let page = 1;
    let totalPages = 1;
    let media = 0;
    let files = 0;
    let added = 0;
    do {
      const endpoint = `${API_ROOT}/media?search=${encodeURIComponent(term)}&per_page=100&page=${page}&_fields=link,date,source_url,title,caption`;
      try {
        const result = await fetchJson<WpMedia[]>(endpoint);
        totalPages = Math.min(result.totalPages, 100);
        media += result.data.length;
        for (const item of result.data) {
          const sourcePage = item.link ?? "https://blog.paniniamerica.net/";
          const candidates = [item.source_url, ...extractFileUrls(item.caption?.rendered ?? "", sourcePage)].filter(
            (value): value is string => Boolean(value),
          );
          for (const candidate of candidates) {
            const url = normalizeUrl(candidate, sourcePage);
            if (!url) continue;
            files += 1;
            if (addSeed(byUrl, url, sourcePage, item.title?.rendered ?? "", item.date)) added += 1;
          }
        }
      } catch (error) {
        failures.push({ endpoint, error: error instanceof Error ? error.message : String(error) });
        break;
      }
      page += 1;
    } while (page <= totalPages);
    stats.push({ term, pages: page - 1, media, files, added });
  }

  return { stats, failures };
}

async function main(): Promise<void> {
  const existing = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed[];
  const byUrl = new Map(existing.map((seed) => [seed.url, seed]));

  const postResults = await crawlPosts(byUrl);
  const mediaResults = await crawlMedia(byUrl);

  const seeds = [...byUrl.values()].sort((a, b) =>
    `${a.year}|${a.sport}|${a.title}|${a.url}`.localeCompare(`${b.year}|${b.sport}|${b.title}|${b.url}`),
  );
  writeFileSync(SEED_PATH, `${JSON.stringify(seeds, null, 2)}\n`);
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    schema: "tcos.paniniWordPressDiscovery.v1",
    generatedAt: new Date().toISOString(),
    knownBefore: existing.length,
    newlyDiscovered: seeds.length - existing.length,
    discoveredTotal: seeds.length,
    posts: postResults.stats,
    media: mediaResults.stats,
    failures: [...postResults.failures, ...mediaResults.failures],
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
