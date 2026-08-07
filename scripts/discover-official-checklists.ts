import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Seed = {
  title: string;
  sport?: string;
  category?: string;
  universe?: string;
  year: string;
  sourcePage?: string;
  url: string;
};

type Manufacturer = {
  id: string;
  name: string;
  seedPath: string;
  startUrls: string[];
  officialHosts: string[];
  crawlHosts: string[];
  maxPages: number;
  sourcePatterns: string[];
  includeStartUrlsAsSources?: boolean;
  classificationField: "sport" | "category" | "universe";
  defaultClassification: string;
};

type Policy = {
  schema: string;
  manufacturers: Manufacturer[];
};

const POLICY_PATH = resolve(
  process.cwd(),
  process.env.CHECKLIST_MANUFACTURER_POLICY ||
    "data/official-checklist-manufacturers.json",
);
const REPORT_PATH = resolve(
  process.cwd(),
  process.env.CHECKLIST_DISCOVERY_REPORT ||
    ".checklist-discovery/official-discovery-report.json",
);
const SELECTED = new Set(
  (process.env.CHECKLIST_DISCOVERY_MANUFACTURERS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const FILE_RE = /\.(pdf|xlsx?|csv|tsv|json|xml|html?|zip)(?:$|[?#])/i;
const SOURCE_WORD_RE = /(checklist|check-list|check_list|card.?list|card.?gallery|card.?search|expansion|product)/i;

function hostAllowed(host: string, allowed: string[]) {
  const value = host.toLowerCase();
  return allowed.some(
    (candidate) =>
      value === candidate.toLowerCase() ||
      value.endsWith(`.${candidate.toLowerCase()}`),
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function canonicalUrl(value: string, base: string) {
  const url = new URL(decodeHtml(value), base);
  if (url.protocol !== "https:") return null;
  url.hash = "";
  return url.toString();
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
      try {
        const url = canonicalUrl(match[1] || match[0], base);
        if (url) links.add(url);
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
  return value.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || "Current";
}

function guessClassification(value: string, fallback: string) {
  if (["pokemon", "yu-gi-oh", "magic-the-gathering", "lorcana"].includes(fallback)) {
    return fallback;
  }
  const text = value.toLowerCase();
  const categories: Array<[string, string[]]> = [
    ["Baseball", ["baseball", "bowman"]],
    ["Basketball", ["basketball", "nba", "wnba", "hoops"]],
    ["Football", ["football", "nfl", "ufl", "gridiron"]],
    ["Hockey", ["hockey", "nhl", "pwhl", "ahl", "chl", "o-pee-chee", "parkhurst"]],
    ["Soccer", ["soccer", "uefa", "premier league", "mls", "fifa"]],
    ["Wrestling", ["wwe", "wrestling", "aew"]],
    ["Racing", ["formula 1", "formula-1", "f1", "racing", "nascar"]],
    ["MMA", ["ufc", "mma", "fight"]],
    ["Golf", ["golf"]],
    ["Celebrity", ["pop century", "celebrity"]],
    ["Entertainment", ["star wars", "marvel", "disney", "pixar", "spongebob", "stranger things", "dune", "garbage pail", "wacky packages", "dc", "entertainment"]],
    ["Multi-Sport", ["multi-sport", "multisport", "national silver", "national vip", "father's day", "black friday", "sports heroes", "goodwin champions"]],
  ];
  for (const [category, needles] of categories) {
    if (needles.some((needle) => text.includes(needle))) return category;
  }
  return fallback;
}

function titleFromUrl(url: string) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const file = pathname.split("/").filter(Boolean).at(-1) || "Official Checklist";
  return file
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addSeed(
  byUrl: Map<string, Seed>,
  manufacturer: Manufacturer,
  url: string,
  sourcePage?: string,
) {
  if (byUrl.has(url)) return false;
  const title = titleFromUrl(url);
  const classification = guessClassification(
    `${title} ${url} ${sourcePage || ""}`,
    manufacturer.defaultClassification,
  );
  const seed: Seed = {
    title,
    year: guessYear(`${title} ${url} ${sourcePage || ""}`),
    url,
    ...(sourcePage ? { sourcePage } : {}),
  };
  if (manufacturer.classificationField === "sport") seed.sport = classification;
  if (manufacturer.classificationField === "category") seed.category = classification;
  if (manufacturer.classificationField === "universe") seed.universe = classification;
  byUrl.set(url, seed);
  return true;
}

function isSourceCandidate(manufacturer: Manufacturer, url: URL) {
  const target = `${url.pathname}${url.search}`;
  const configured = manufacturer.sourcePatterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(target);
    } catch {
      return target.toLowerCase().includes(pattern.toLowerCase());
    }
  });
  return configured || (FILE_RE.test(target) && SOURCE_WORD_RE.test(target));
}

function isUsefulCrawlUrl(url: URL) {
  return /checklist|card|product|products|collection|collections|category|brand|license|page\/|sitemap|wp-json\/wp\/v2|\?s=/i.test(
    `${url.pathname}${url.search}`,
  );
}

async function fetchText(url: string, manufacturer: Manufacturer) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json,*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: new URL(url).origin + "/",
      "User-Agent": "TCOS-Official-Checklist-Discovery/4.0 (+private registry automation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const finalUrl = response.url || url;
  const finalHost = new URL(finalUrl).hostname;
  if (!hostAllowed(finalHost, [...manufacturer.officialHosts, ...manufacturer.crawlHosts])) {
    throw new Error(`Redirected outside official host allowlist: ${finalHost}`);
  }
  const type = response.headers.get("content-type") || "";
  if (!/(text|html|json|xml)/i.test(type)) return { body: "", finalUrl };
  return { body: await response.text(), finalUrl };
}

async function discover(manufacturer: Manufacturer) {
  const seedFile = resolve(process.cwd(), manufacturer.seedPath);
  let existing: Seed[] = [];
  try {
    existing = JSON.parse(readFileSync(seedFile, "utf8")) as Seed[];
  } catch {
    existing = [];
  }
  const byUrl = new Map(existing.map((seed) => [seed.url, seed]));
  const queue = [...manufacturer.startUrls];
  const seen = new Set<string>();
  const failures: Array<{ url: string; error: string }> = [];
  let newlyDiscovered = 0;

  if (manufacturer.includeStartUrlsAsSources) {
    for (const startUrl of manufacturer.startUrls) {
      const parsed = new URL(startUrl);
      if (hostAllowed(parsed.hostname, manufacturer.officialHosts)) {
        if (addSeed(byUrl, manufacturer, startUrl)) newlyDiscovered += 1;
      }
    }
  }

  while (queue.length && seen.size < manufacturer.maxPages) {
    const requested = queue.shift();
    if (!requested || seen.has(requested)) continue;
    seen.add(requested);
    try {
      const { body, finalUrl } = await fetchText(requested, manufacturer);
      for (const link of extractLinks(body, finalUrl)) {
        const parsed = new URL(link);
        if (
          hostAllowed(parsed.hostname, manufacturer.officialHosts) &&
          isSourceCandidate(manufacturer, parsed)
        ) {
          if (addSeed(byUrl, manufacturer, link, finalUrl)) newlyDiscovered += 1;
        }
        if (
          hostAllowed(parsed.hostname, manufacturer.crawlHosts) &&
          isUsefulCrawlUrl(parsed) &&
          !seen.has(link) &&
          !queue.includes(link)
        ) {
          queue.push(link);
        }
      }
    } catch (error) {
      failures.push({
        url: requested,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const seeds = [...byUrl.values()].sort((left, right) =>
    `${right.year}|${right.title}|${right.url}`.localeCompare(
      `${left.year}|${left.title}|${left.url}`,
      undefined,
      { numeric: true, sensitivity: "base" },
    ),
  );
  mkdirSync(dirname(seedFile), { recursive: true });
  writeFileSync(seedFile, `${JSON.stringify(seeds, null, 2)}\n`, "utf8");

  return {
    manufacturerId: manufacturer.id,
    manufacturer: manufacturer.name,
    seedPath: manufacturer.seedPath,
    knownBefore: existing.length,
    newlyDiscovered,
    discoveredTotal: seeds.length,
    pagesScanned: seen.size,
    pagesRemaining: queue.length,
    hitPageLimit: queue.length > 0 && seen.size >= manufacturer.maxPages,
    failures,
  };
}

async function main() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as Policy;
  if (policy.schema !== "tcos.officialManufacturerChecklistPolicy.v1") {
    throw new Error(`Unsupported manufacturer policy schema: ${policy.schema}`);
  }
  const manufacturers = policy.manufacturers.filter(
    (manufacturer) => SELECTED.size === 0 || SELECTED.has(manufacturer.id),
  );
  if (!manufacturers.length) throw new Error("No configured manufacturers were selected.");

  const reports = [];
  for (const manufacturer of manufacturers) {
    reports.push(await discover(manufacturer));
  }
  const output = {
    schema: "tcos.officialManufacturerChecklistDiscovery.v1",
    generatedAt: new Date().toISOString(),
    policy: "official_manufacturer_only",
    manufacturers: reports,
  };
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
