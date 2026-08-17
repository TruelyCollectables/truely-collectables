import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { postChecklistRegistryAction } from "./lib/checklist-registry-action-client";

const CURRENT_CHECKLISTS_URL = "https://upperdeck.com/checklists/";
const YEAR_ARCHIVE_ROOT = "https://upperdeck.com/checklist-year/";
const AUTO_IMPORT = process.env.CHECKLIST_DISCOVERY_AUTO_IMPORT === "true";
const CURRENT_YEAR = new Date().getUTCFullYear();
const EARLIEST_ARCHIVE_YEAR = Math.max(
  1990,
  Math.min(CURRENT_YEAR, Number(process.env.CHECKLIST_DISCOVERY_EARLIEST_YEAR || 2015)),
);
const MAX_YEAR_PAGES = Math.max(
  1,
  Math.min(20, Number(process.env.CHECKLIST_DISCOVERY_MAX_YEAR_PAGES || 12)),
);
const TARGET_NEW = Math.max(1, Math.min(100, Number(process.env.CHECKLIST_DISCOVERY_TARGET_NEW || 100)));
const MAX_ATTEMPTS = Math.max(
  TARGET_NEW,
  Math.min(500, Number(process.env.CHECKLIST_DISCOVERY_MAX_ATTEMPTS || 250)),
);
const MAX_CANDIDATES = 2_000;
const OUTPUT = resolve(
  process.cwd(),
  process.env.CHECKLIST_DISCOVERY_OUTPUT || ".checklist-discovery/latest-receipt.json",
);

function canonical(value: string, base: string) {
  const url = new URL(value, base);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function links(html: string, base: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = canonical(match[1], base);
      const parsed = new URL(url);
      if (!/(^|\.)upperdeck\.com$/i.test(parsed.hostname)) continue;
      if (/^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) found.add(url);
    } catch {
      // Ignore unrelated malformed links.
    }
  }
  return [...found];
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent": "TCOS-Checklist-Discovery/1.0 (+private registry automation; contact sales@truelycollectables.com)",
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

async function discoverCandidates() {
  const found = new Set<string>();

  try {
    links(await fetchHtml(CURRENT_CHECKLISTS_URL), CURRENT_CHECKLISTS_URL).forEach((url) => found.add(url));
  } catch (error) {
    console.warn(`Current Upper Deck checklist index could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (let year = CURRENT_YEAR; year >= EARLIEST_ARCHIVE_YEAR && found.size < MAX_CANDIDATES; year -= 1) {
    let previousSize = -1;
    for (let page = 1; page <= MAX_YEAR_PAGES && found.size < MAX_CANDIDATES; page += 1) {
      const base = `${YEAR_ARCHIVE_ROOT}${year}/`;
      const pageUrl = page === 1 ? base : `${base}page/${page}/`;
      try {
        const pageLinks = links(await fetchHtml(pageUrl), pageUrl);
        if (!pageLinks.length) break;
        previousSize = found.size;
        pageLinks.forEach((url) => found.add(url));
        if (previousSize === found.size) break;
      } catch (error) {
        console.warn(`Upper Deck ${year} archive page ${page} stopped: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }

  return [...found].slice(0, MAX_CANDIDATES);
}

async function selectUnseenSources(candidates: string[]) {
  let remaining = [...candidates];
  const selected: string[] = [];

  while (remaining.length && selected.length < MAX_ATTEMPTS) {
    const limit = Math.min(60, MAX_ATTEMPTS - selected.length);
    const response = await postChecklistRegistryAction({
      operation: "upper_deck_select_sources",
      sourceUrls: remaining,
      limit,
    });
    const result = response.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("Checklist Registry returned an invalid Upper Deck selection result.");
    }
    const row = result as Record<string, unknown>;
    const batch = row.sourceUrls;
    const unseenCount = Number(row.unseenCount || 0);
    if (!Array.isArray(batch) || batch.some((value) => typeof value !== "string")) {
      throw new Error("Checklist Registry returned invalid Upper Deck source URLs.");
    }
    if (!batch.length || unseenCount <= 0) break;

    const unseenBatch = (batch as string[]).slice(0, Math.min(unseenCount, batch.length, limit));
    selected.push(...unseenBatch);

    const consumed = new Set(batch as string[]);
    remaining = remaining.filter((value) => !consumed.has(value));
  }

  return selected.slice(0, MAX_ATTEMPTS);
}

async function main() {
  const startedAt = new Date().toISOString();
  const candidates = await discoverCandidates();
  const sourceUrls = await selectUnseenSources(candidates);
  const results: Array<Record<string, unknown>> = [];
  let successfulNew = 0;

  for (const sourceUrl of sourceUrls) {
    if (successfulNew >= TARGET_NEW) break;
    try {
      const content = await fetchHtml(sourceUrl);
      const response = await postChecklistRegistryAction({
        operation: "upper_deck_source",
        sourceUrl,
        content,
        autoImport: AUTO_IMPORT,
      });
      const result = response.result;
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Checklist Registry returned an invalid Upper Deck result.");
      }
      results.push(result as Record<string, unknown>);
      successfulNew += 1;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      results.push({ sourceUrl, status: "failed", message });
    }
  }

  const backlogExhausted = successfulNew < TARGET_NEW && sourceUrls.length < MAX_ATTEMPTS;
  const receipt = {
    schema: "tcos.checklist.discoveryReceipt.v3",
    startedAt,
    completedAt: new Date().toISOString(),
    mode: AUTO_IMPORT ? "automatic_import" : "validation_only",
    currentIndex: CURRENT_CHECKLISTS_URL,
    archiveRoot: YEAR_ARCHIVE_ROOT,
    archiveYears: { newest: CURRENT_YEAR, oldest: EARLIEST_ARCHIVE_YEAR },
    targetNew: TARGET_NEW,
    successfulNew,
    backlogExhausted,
    limits: {
      maxYearPages: MAX_YEAR_PAGES,
      maxAttempts: MAX_ATTEMPTS,
      maxCandidates: MAX_CANDIDATES,
    },
    candidateCount: candidates.length,
    unseenCandidateCount: sourceUrls.length,
    attemptedCount: results.length,
    results,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));

  if (successfulNew < TARGET_NEW && !backlogExhausted) {
    console.error(`Checklist catch-up target missed: found ${successfulNew} net-new checklists; target is ${TARGET_NEW}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
