import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_DISCOVERY_PAGES,
  MAX_ITEMS,
  decodeHtml,
  extractMaker,
  extractProduct,
  extractSeason,
  fetchText,
  finishSource,
  hrefs,
  normalizeUrl,
  saveItem,
  titleFromHtml,
} from "./shared.mjs";

const ORIGIN = "https://www.breakninja.com";
const ROOT_INDEX = `${ORIGIN}/sports.html`;
const MAX_PRODUCTS = Number(process.env.BREAKNINJA_MAX_PRODUCTS || MAX_ITEMS || 2500);
const MAX_TEAM_PAGES = Number(process.env.BREAKNINJA_MAX_TEAM_PAGES || 80);
const PRODUCT_CONCURRENCY = boundedInteger(process.env.BREAKNINJA_PRODUCT_CONCURRENCY, 4, 1, 12);
const TEAM_CONCURRENCY = boundedInteger(process.env.BREAKNINJA_TEAM_CONCURRENCY, 8, 1, 20);
const CHECKPOINT_EVERY = boundedInteger(process.env.BREAKNINJA_CHECKPOINT_EVERY, 25, 1, 500);
const REQUEST_DELAY_MS = boundedInteger(
  process.env.BREAKNINJA_REQUEST_DELAY_MS,
  125,
  0,
  5000,
);
const FETCH_ATTEMPTS = boundedInteger(process.env.BREAKNINJA_FETCH_ATTEMPTS, 3, 1, 5);

const PATH_UNIVERSES = new Map([
  ["baseball", "baseball"],
  ["basketball", "basketball"],
  ["football", "football"],
  ["hockey", "hockey"],
  ["soccer", "soccer"],
  ["racing", "racing"],
  ["wrestling", "wrestling"],
  ["ufc", "mma"],
  ["mma", "mma"],
  ["boxing", "boxing"],
  ["golf", "golf"],
  ["tennis", "tennis"],
  ["multisport", "multi-sport"],
  ["multi-sport", "multi-sport"],
  ["non-sport", "non-sport"],
  ["nonsport", "non-sport"],
  ["pokemon", "pokemon"],
  ["tcg", "tcg"],
  ["yugioh", "yu-gi-oh"],
]);

let requestGate = Promise.resolve();
let nextRequestAt = 0;

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function reserveRequestSlot() {
  const reservation = requestGate.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await sleep(wait);
    nextRequestAt = Date.now() + REQUEST_DELAY_MS;
  });
  requestGate = reservation.catch(() => {});
  await reservation;
}

function transientFetchError(error) {
  return /HTTP (?:408|425|429|5\d\d)\b|aborted|timeout|fetch failed|ECONNRESET|EAI_AGAIN/i.test(String(error));
}

async function fetchPublic(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      await reserveRequestSlot();
      return await fetchText(url);
    } catch (error) {
      lastError = error;
      if (attempt >= FETCH_ATTEMPTS || !transientFetchError(error)) throw error;
      await sleep(500 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function forEachConcurrent(values, limit, worker) {
  const items = [...values];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function sameHost(value) {
  try {
    const parsed = new URL(value);
    return /(^|\.)breakninja\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function canonical(value) {
  const normalized = normalizeUrl(value, ORIGIN);
  if (!normalized || !sameHost(normalized)) return null;
  const parsed = new URL(normalized);
  parsed.protocol = "https:";
  parsed.hostname = "www.breakninja.com";
  parsed.hash = "";
  return parsed.toString();
}

function isProductUrl(value) {
  const url = canonical(value);
  if (!url) return false;
  const path = new URL(url).pathname;
  if (!/checklist/i.test(path)) return false;
  if (!/\.(?:html?|php)$/i.test(path)) return false;
  return /(?:^|[-_/])(?:\d{2}-\d{2}|(?:19|20)\d{2})(?:[-_/]|$)/i.test(path);
}

function isIndexUrl(value) {
  const url = canonical(value);
  if (!url) return false;
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (path === "/sports.html" || path === "/releases.html") return true;
  if (/box_break_group_checklists\.html$/.test(path)) return true;
  if (/checklists?\.html$/.test(path) && !/(?:19|20)\d{2}|\d{2}-\d{2}/.test(path)) return true;
  return false;
}

function universeFromUrl(url, title) {
  const parsed = new URL(url);
  for (const segment of parsed.pathname.toLowerCase().split("/").filter(Boolean)) {
    const mapped = PATH_UNIVERSES.get(segment);
    if (mapped) return mapped;
  }
  const haystack = `${parsed.pathname} ${title}`.toLowerCase();
  for (const [key, value] of PATH_UNIVERSES) if (haystack.includes(key)) return value;
  return null;
}

function sourceRevision(html) {
  return String(html).match(/Release Date:\s*([^<\n]+)/i)?.[1]?.trim() || null;
}

function normalizedHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function headerColumn(headers, patterns) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function tableRows(html, team) {
  const rows = [];
  for (const table of String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const parsed = [];
    for (const tr of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((cell) => decodeHtml(cell[1]).replace(/\s+/g, " ").trim());
      if (cells.length) parsed.push(cells);
    }

    const headerIndex = parsed.findIndex((cells) => {
      const headers = cells.map(normalizedHeader);
      return headerColumn(headers, [/^player$/, /^name$/]) >= 0
        && headerColumn(headers, [/^card set$/, /^set$/, /parallel/]) >= 0
        && headerColumn(headers, [/^copies$/, /^copy$/, /print run/, /serial/]) >= 0;
    });
    if (headerIndex < 0) continue;

    const headers = parsed[headerIndex].map(normalizedHeader);
    const playerIndex = headerColumn(headers, [/^player$/, /^name$/]);
    const numberIndex = headerColumn(headers, [/^number$/, /^card number$/, /^no$/, /^card no$/]);
    const cardSetIndex = headerColumn(headers, [/^card set$/, /^set$/, /parallel/]);
    const printRunIndex = headerColumn(headers, [/^copies$/, /^copy$/, /print run/, /serial/]);

    for (const cells of parsed.slice(headerIndex + 1)) {
      const player = cells[playerIndex]?.trim() || "";
      const cardNumber = numberIndex >= 0 ? cells[numberIndex]?.trim() || "" : "";
      const cardSet = cells[cardSetIndex]?.trim() || "";
      const printRun = cells[printRunIndex]?.trim() || "";
      if (!player || !cardSet || /^player$/i.test(player)) continue;
      rows.push({ player, cardNumber, cardSet, printRun, team: team || "" });
    }
  }
  return rows;
}

function childPages(html, mainUrl) {
  const parsed = new URL(mainUrl);
  const extension = parsed.pathname.match(/\.(?:html?|php)$/i)?.[0] || "";
  const stem = parsed.pathname.slice(0, -extension.length).toLowerCase();
  const out = new Set();
  for (const link of hrefs(html, mainUrl)) {
    const url = canonical(link);
    if (!url) continue;
    const child = new URL(url);
    const childPath = child.pathname.toLowerCase();
    if (childPath === parsed.pathname.toLowerCase()) continue;
    if (!childPath.startsWith(`${stem}-`)) continue;
    if (!/\.(?:html?|php)$/i.test(childPath)) continue;
    out.add(url);
  }
  return [...out].sort().slice(0, MAX_TEAM_PAGES);
}

function teamFromUrl(url, mainUrl) {
  const mainPath = new URL(mainUrl).pathname.replace(/\.(?:html?|php)$/i, "");
  const childPath = new URL(url).pathname.replace(/\.(?:html?|php)$/i, "");
  return decodeURIComponent(childPath.slice(mainPath.length).replace(/^-+/, "").replace(/-/g, " ")).trim();
}

function checklistPayload(rows) {
  if (!rows.length) return "";
  return [
    "row_id\tplayer\tcard_number\tcard_set\tprint_run\tteam",
    ...rows.map((row, index) => [index + 1, row.player, row.cardNumber, row.cardSet, row.printRun, row.team]
      .map((value) => String(value || "").replace(/[\t\r\n]+/g, " ").trim())
      .join("\t")),
  ].join("\n");
}

async function discover() {
  const queue = [ROOT_INDEX];
  const seen = new Set();
  const products = new Set();
  const discoveryFailures = [];

  while (queue.length && seen.size < MAX_DISCOVERY_PAGES && products.size < MAX_PRODUCTS) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const { text: html, finalUrl } = await fetchPublic(url);
      for (const link of hrefs(html, finalUrl)) {
        const normalized = canonical(link);
        if (!normalized) continue;
        if (isProductUrl(normalized)) products.add(normalized);
        else if (isIndexUrl(normalized) && !seen.has(normalized)) queue.push(normalized);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "index", url, error: String(error) });
    }
  }

  return { products, discoveryFailures };
}

async function collectProduct(url, failures) {
  try {
    const { text: html, finalUrl } = await fetchPublic(url);
    const title = titleFromHtml(html, finalUrl);
    const universe = universeFromUrl(finalUrl, title);
    const sport = universe && !["non-sport", "pokemon", "tcg", "yu-gi-oh"].includes(universe) ? universe : null;
    const season = extractSeason(title);
    const manufacturer = extractMaker(title, [], finalUrl);
    const product = extractProduct(title, manufacturer, sport || universe);
    const rows = [...tableRows(html, "")];
    const childUrls = childPages(html, finalUrl);

    await forEachConcurrent(childUrls, TEAM_CONCURRENCY, async (childUrl) => {
      try {
        const { text: childHtml } = await fetchPublic(childUrl);
        rows.push(...tableRows(childHtml, teamFromUrl(childUrl, finalUrl)));
      } catch (error) {
        failures.push({ stage: "team-page", url: childUrl, parentUrl: finalUrl, error: String(error) });
      }
    });

    const uniqueRows = [...new Map(rows.map((row) => [
      [row.player, row.cardNumber, row.cardSet, row.printRun, row.team].join("|").toLowerCase(),
      row,
    ])).values()];
    const checklist = checklistPayload(uniqueRows);
    return saveItem({
      url: finalUrl,
      title,
      universe,
      sport,
      season,
      manufacturer,
      product,
      categories: universe ? [universe] : [],
      sourceRevision: sourceRevision(html),
      checklist,
      checklistRows: uniqueRows.length,
    });
  } catch (error) {
    failures.push({ stage: "product", url, error: String(error) });
    return null;
  }
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const { products, discoveryFailures } = await discover();
  const productUrls = [...products].sort().slice(0, MAX_PRODUCTS);
  const items = [];
  const failures = [];
  let completed = 0;
  let checkpointed = 0;

  await forEachConcurrent(productUrls, PRODUCT_CONCURRENCY, async (url) => {
    const item = await collectProduct(url, failures);
    if (item) items.push(item);
    completed += 1;

    if (items.length && completed - checkpointed >= CHECKPOINT_EVERY) {
      checkpointed = completed;
      finishSource({ items, failures, discoveryFailures, discovered: products.size });
      console.log(JSON.stringify({
        source: "breakninja",
        stage: "checkpoint",
        completedProducts: completed,
        archivedItems: items.length,
        checklistItems: items.filter((entry) => entry.status === "checklist-saved").length,
        discoveredCandidates: products.size,
      }));
    }
  });

  finishSource({ items, failures, discoveryFailures, discovered: products.size });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
