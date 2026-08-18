import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { postChecklistRegistryAction } from "./lib/checklist-registry-action-client";

const HOCKEY_CATEGORY_URL = "https://upperdeck.com/checklist-category/hockey/";
const START_DATE = new Date(
  process.env.HOCKEY_CHECKLIST_START_DATE || "2021-07-01T00:00:00Z",
);
const MIN_START_YEAR = 2021;
const MAX_CATEGORY_PAGES = Math.max(
  1,
  Math.min(50, Number(process.env.HOCKEY_CHECKLIST_MAX_CATEGORY_PAGES || 40)),
);
const OUTPUT = resolve(
  process.cwd(),
  process.env.HOCKEY_CHECKLIST_OUTPUT || ".hockey-checklist-reconcile/receipt.json",
);
const SHARD_COUNT = Math.max(
  1,
  Math.min(16, Number(process.env.HOCKEY_CHECKLIST_SHARD_COUNT || 1)),
);
const SHARD_INDEX = Number(process.env.HOCKEY_CHECKLIST_SHARD_INDEX || 0);

if (!Number.isInteger(SHARD_INDEX) || SHARD_INDEX < 0 || SHARD_INDEX >= SHARD_COUNT) {
  throw new Error(`Invalid hockey shard ${SHARD_INDEX}/${SHARD_COUNT}.`);
}

type HockeyCandidate = {
  sourceUrl: string;
  publishedAt: string | null;
  categoryPage: number;
};

type ImportResult = Record<string, unknown> & {
  sourceUrl?: string;
  status?: string;
  unchanged?: boolean;
};

function canonical(value: string, base: string) {
  const url = new URL(value, base);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function stripTags(value: string) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parsedDate(value: string | null | undefined) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function publishedAtFromBlock(block: string) {
  const datetime = block.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1];
  const parsedDatetime = parsedDate(datetime);
  if (parsedDatetime) return parsedDatetime.toISOString();

  const text = stripTags(block);
  const human = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i,
  )?.[0];
  const parsedHuman = parsedDate(human);
  return parsedHuman ? parsedHuman.toISOString() : null;
}

function sourceStartYearHint(sourceUrl: string) {
  try {
    const slug = new URL(sourceUrl).pathname.toLowerCase();
    const season = slug.match(/(?:^|[^0-9])(20\d{2})-(?:20)?\d{2}(?:[^0-9]|$)/);
    if (season) return Number(season[1]);
    const year = slug.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
    return year ? Number(year[1]) : null;
  } catch {
    return null;
  }
}

function checklistUrlFromBlock(block: string, base: string) {
  for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = canonical(match[1], base);
      const parsed = new URL(url);
      if (!/(^|\.)upperdeck\.com$/i.test(parsed.hostname)) continue;
      if (/^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) return url;
    } catch {
      // Ignore malformed links in unrelated page chrome.
    }
  }
  return null;
}

function categoryEntries(html: string, base: string, categoryPage: number) {
  const entries = new Map<string, HockeyCandidate>();

  for (const article of html.matchAll(/<article\b[\s\S]*?<\/article>/gi)) {
    const block = article[0];
    const sourceUrl = checklistUrlFromBlock(block, base);
    if (!sourceUrl) continue;
    entries.set(sourceUrl, {
      sourceUrl,
      publishedAt: publishedAtFromBlock(block),
      categoryPage,
    });
  }

  if (entries.size) return [...entries.values()];

  const matches = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    try {
      const sourceUrl = canonical(match[1], base);
      const parsed = new URL(sourceUrl);
      if (!/(^|\.)upperdeck\.com$/i.test(parsed.hostname)) continue;
      if (!/^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) continue;

      const index = match.index || 0;
      const nearby = html.slice(Math.max(0, index - 3_000), Math.min(html.length, index + 3_000));
      entries.set(sourceUrl, {
        sourceUrl,
        publishedAt: publishedAtFromBlock(nearby),
        categoryPage,
      });
    } catch {
      // Ignore malformed links in unrelated page chrome.
    }
  }

  return [...entries.values()];
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent": "TCOS-Hockey-Checklist-Reconcile/1.1 (+private registry automation; contact sales@truelycollectables.com)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) {
    throw new Error(`Unexpected content type ${type || "unknown"} fetching ${url}`);
  }
  const html = await response.text();
  if (html.length < 1_000) throw new Error(`Incomplete HTML (${html.length} bytes) fetching ${url}`);
  return html;
}

async function discoverHockeyCandidates() {
  const candidates = new Map<string, HockeyCandidate>();
  const pages: Array<{
    page: number;
    url: string;
    entryCount: number;
    eligibleCount: number;
    newestPublishedAt: string | null;
    oldestPublishedAt: string | null;
  }> = [];

  for (let page = 1; page <= MAX_CATEGORY_PAGES; page += 1) {
    const pageUrl = page === 1 ? HOCKEY_CATEGORY_URL : `${HOCKEY_CATEGORY_URL}page/${page}/`;
    let html: string;
    try {
      html = await fetchHtml(pageUrl);
    } catch (error) {
      if (page > 1 && /HTTP 404\b/i.test(error instanceof Error ? error.message : String(error))) break;
      throw error;
    }

    const entries = categoryEntries(html, pageUrl, page);
    if (!entries.length) break;

    const dated = entries
      .map((entry) => parsedDate(entry.publishedAt))
      .filter((value): value is Date => Boolean(value));
    const pageClearlyOld = dated.length > 0 && dated.every((value) => value < START_DATE);
    const eligible = entries.filter((entry) => {
      const yearHint = sourceStartYearHint(entry.sourceUrl);
      if (yearHint !== null && yearHint < MIN_START_YEAR) return false;
      const published = parsedDate(entry.publishedAt);
      if (published) return published >= START_DATE;
      return !pageClearlyOld;
    });

    for (const entry of eligible) candidates.set(entry.sourceUrl, entry);

    const times = dated.map((value) => value.getTime());
    pages.push({
      page,
      url: pageUrl,
      entryCount: entries.length,
      eligibleCount: eligible.length,
      newestPublishedAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      oldestPublishedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    });

    if (pageClearlyOld) break;
  }

  return {
    candidates: [...candidates.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
    pages,
  };
}

function writeReceipt(value: Record<string, unknown>) {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = new Date().toISOString();
  const discovery = await discoverHockeyCandidates();
  if (!discovery.candidates.length) {
    throw new Error("Upper Deck hockey archive produced zero in-scope checklist pages.");
  }

  const selected = discovery.candidates.filter((_, index) => index % SHARD_COUNT === SHARD_INDEX);
  const results: ImportResult[] = [];
  const baseReceipt = {
    schema: "tcos.hockeyChecklistReconcileShardReceipt.v1",
    startedAt,
    source: HOCKEY_CATEGORY_URL,
    boundary: START_DATE.toISOString(),
    latestExpected: "2026-27 MVP",
    categoryPages: discovery.pages,
    candidateCount: discovery.candidates.length,
    shardCount: SHARD_COUNT,
    shardIndex: SHARD_INDEX,
    selectedCandidateCount: selected.length,
    selectedSourceUrls: selected.map((candidate) => candidate.sourceUrl),
  };
  writeReceipt({ ...baseReceipt, status: "running", results });

  for (const candidate of selected) {
    try {
      const content = await fetchHtml(candidate.sourceUrl);
      const response = await postChecklistRegistryAction({
        operation: "upper_deck_source",
        sourceUrl: candidate.sourceUrl,
        content,
        autoImport: true,
      });
      const result = response.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Checklist Registry returned an invalid Upper Deck result.");
      }
      results.push({
        ...(result as Record<string, unknown>),
        categoryPage: candidate.categoryPage,
        publishedAt: candidate.publishedAt,
      });
    } catch (caught) {
      results.push({
        sourceUrl: candidate.sourceUrl,
        categoryPage: candidate.categoryPage,
        publishedAt: candidate.publishedAt,
        status: "failed",
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }

    writeReceipt({ ...baseReceipt, status: "running", completedCount: results.length, results });
  }

  const counts = results.reduce<Record<string, number>>((acc, result) => {
    const status = String(result.status || "unknown");
    acc[status] = (acc[status] || 0) + 1;
    if (result.unchanged === true) acc.unchanged = (acc.unchanged || 0) + 1;
    return acc;
  }, {});
  const unresolved = results.filter((result) => !["imported", "unchanged"].includes(String(result.status || "")));
  const completedAt = new Date().toISOString();
  const receipt = {
    ...baseReceipt,
    completedAt,
    status: unresolved.length ? "failed" : "passed",
    completedCount: results.length,
    counts,
    unresolvedCount: unresolved.length,
    unresolved,
    results,
  };
  writeReceipt(receipt);
  console.log(JSON.stringify(receipt, null, 2));

  if (unresolved.length) {
    console.error(`Hockey Registry shard ${SHARD_INDEX}/${SHARD_COUNT} incomplete: ${unresolved.length} source(s) unresolved.`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: hockey shard ${SHARD_INDEX}/${SHARD_COUNT} imported/current ${results.length}/${selected.length} selected sources.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
