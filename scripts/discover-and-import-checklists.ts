import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { postChecklistRegistryAction } from "./lib/checklist-registry-action-client";

const ARCHIVE_ROOT = "https://upperdeck.com/category/checklist/";
const AUTO_IMPORT = process.env.CHECKLIST_DISCOVERY_AUTO_IMPORT === "true";
const MAX_PAGES = Math.max(1, Number(process.env.CHECKLIST_DISCOVERY_MAX_PAGES || 50));
const MAX_SOURCES = Math.max(1, Math.min(60, Number(process.env.CHECKLIST_DISCOVERY_MAX_SOURCES || 60)));
const MAX_CANDIDATES = 2_000;
const OUTPUT = resolve(
  process.cwd(),
  process.env.CHECKLIST_DISCOVERY_OUTPUT || ".checklist-discovery/latest-receipt.json",
);

function canonical(value: string) {
  const url = new URL(value, ARCHIVE_ROOT);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function links(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const url = canonical(match[1]);
      const parsed = new URL(url);
      if (parsed.hostname === "upperdeck.com" && /^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) {
        found.add(url);
      }
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
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) {
    throw new Error(`Unexpected content type ${type || "unknown"}`);
  }
  const html = await response.text();
  if (html.length < 1_000) throw new Error(`Incomplete HTML (${html.length} bytes)`);
  return html;
}

async function discoverCandidates() {
  const found = new Set<string>();
  for (let page = 1; page <= MAX_PAGES && found.size < MAX_CANDIDATES; page += 1) {
    const pageUrl = page === 1 ? ARCHIVE_ROOT : `${ARCHIVE_ROOT}page/${page}/`;
    const pageLinks = links(await fetchHtml(pageUrl));
    if (!pageLinks.length) break;
    const before = found.size;
    pageLinks.forEach((url) => found.add(url));
    if (before === found.size) break;
  }
  return [...found].slice(0, MAX_CANDIDATES);
}

async function selectDailySources(candidates: string[]) {
  const response = await postChecklistRegistryAction({
    operation: "upper_deck_select_sources",
    sourceUrls: candidates,
    limit: MAX_SOURCES,
  });
  const result = response.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Checklist Registry returned an invalid Upper Deck selection result.");
  }
  const selected = (result as Record<string, unknown>).sourceUrls;
  if (!Array.isArray(selected) || selected.some((value) => typeof value !== "string")) {
    throw new Error("Checklist Registry returned invalid Upper Deck source URLs.");
  }
  return selected as string[];
}

async function main() {
  const startedAt = new Date().toISOString();
  const candidates = await discoverCandidates();
  const sourceUrls = await selectDailySources(candidates);
  const results: Array<Record<string, unknown>> = [];

  for (const sourceUrl of sourceUrls) {
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
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      results.push({ sourceUrl, status: "failed", message });
    }
  }

  const receipt = {
    schema: "tcos.checklist.discoveryReceipt.v1",
    startedAt,
    completedAt: new Date().toISOString(),
    mode: AUTO_IMPORT ? "automatic_import" : "validation_only",
    archiveRoot: ARCHIVE_ROOT,
    limits: { maxPages: MAX_PAGES, maxSources: MAX_SOURCES, maxCandidates: MAX_CANDIDATES },
    candidateCount: candidates.length,
    selectedCount: sourceUrls.length,
    results,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
