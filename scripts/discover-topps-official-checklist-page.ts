import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Seed = {
  title: string;
  sport: string;
  year: string;
  sourcePage?: string;
  url: string;
};

const SEED_PATH = resolve(process.cwd(), "data/topps-checklist-seeds.json");
const REPORT_DIR = resolve(process.cwd(), ".topps-official-discovery");
const REPORT_PATH = resolve(REPORT_DIR, "report.json");
const SOURCE_PAGES = [
  "https://www.topps.com/pages/checklists",
  "https://www-next.topps.com/pages/checklists",
];
const FILE_RE = /\.(pdf|xlsx?|xlsm|csv)(?:$|[?#])/i;

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

function normalizeUrl(raw: string, sourcePage: string): string | null {
  try {
    const url = new URL(decodeHtml(raw), sourcePage);
    const host = url.hostname.toLowerCase();
    if (!(host === "cdn.shopify.com" || host === "topps.com" || host.endsWith(".topps.com"))) {
      return null;
    }
    if (!FILE_RE.test(url.toString())) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function inferYear(value: string): string {
  const season = value.match(/\b(20\d{2})\s*[-/]\s*(\d{2})\b/);
  if (season) return `${season[1]}-${season[2]}`;
  return value.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? "Unknown";
}

function inferSport(value: string): string {
  const text = value.toLowerCase();
  const rules: Array<[string, string[]]> = [
    ["Baseball", ["baseball", "bowman", "mlb"]],
    ["Basketball", ["basketball", "nba", "wnba", "hoops", "g-league", "nbl"]],
    ["Football", ["football", "nfl", "resurgence", "composite"]],
    ["Hockey", ["hockey", "nhl"]],
    ["Soccer", ["soccer", "uefa", "premier league", "bundesliga", "mls", "fifa", "ucl", "ucc"]],
    ["Racing", ["racing", "nascar", "formula 1", "formula-1", "f1", "paddock"]],
    ["Wrestling", ["wwe", "wrestling"]],
    ["UFC", ["ufc", "mma", "knockout"]],
    ["Golf", ["golf"]],
    ["Entertainment", ["star wars", "marvel", "disney", "pixar", "garbage pail", "gpk", "wacky", "vee friends", "veefriends", "spongebob", "dune", "stranger things", "clerks"]],
    ["Multi-Sport", ["national", "olympic", "multi-sport"]],
  ];
  return rules.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? "Miscellaneous";
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 TCOS-Topps-Official-Checklist-Crawler/1.0",
      Accept: "text/html,application/xhtml+xml,*/*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function main(): Promise<void> {
  const existing = JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed[];
  const byUrl = new Map(existing.map((seed) => [seed.url, seed]));
  const failures: Array<{ sourcePage: string; error: string }> = [];
  const pageStats: Array<{ sourcePage: string; anchors: number; accepted: number; added: number }> = [];

  for (const sourcePage of SOURCE_PAGES) {
    try {
      const html = await fetchPage(sourcePage);
      let anchors = 0;
      let accepted = 0;
      let added = 0;
      const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const match of html.matchAll(anchorRe)) {
        anchors += 1;
        const url = normalizeUrl(match[1], sourcePage);
        if (!url) continue;
        accepted += 1;
        if (byUrl.has(url)) continue;
        const visibleTitle = decodeHtml(match[2]);
        const fileTitle = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
          .replace(/\.[^.]+$/, "")
          .replace(/[_+]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const title = visibleTitle || fileTitle || "Official Topps Checklist";
        byUrl.set(url, {
          title,
          sport: inferSport(`${title} ${url}`),
          year: inferYear(`${title} ${url}`),
          sourcePage,
          url,
        });
        added += 1;
      }
      pageStats.push({ sourcePage, anchors, accepted, added });
    } catch (error) {
      failures.push({ sourcePage, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const seeds = [...byUrl.values()].sort((a, b) =>
    `${a.year}|${a.sport}|${a.title}|${a.url}`.localeCompare(`${b.year}|${b.sport}|${b.title}|${b.url}`),
  );
  writeFileSync(SEED_PATH, `${JSON.stringify(seeds, null, 2)}\n`);
  mkdirSync(REPORT_DIR, { recursive: true });
  const report = {
    schema: "tcos.toppsOfficialChecklistDiscovery.v1",
    generatedAt: new Date().toISOString(),
    knownBefore: existing.length,
    newlyDiscovered: seeds.length - existing.length,
    discoveredTotal: seeds.length,
    pages: pageStats,
    failures,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
