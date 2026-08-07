import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_ITEMS,
  decodeHtml,
  downloadPublicFiles,
  extractMaker,
  extractProduct,
  extractSeason,
  extractSport,
  fetchText,
  fileLinks,
  finishSource,
  hrefs,
  normalizeUrl,
  saveItem,
  titleFromHtml,
} from "./shared.mjs";

const ORIGIN = "https://cloutsnchara.com";
const INDEX = `${ORIGIN}/checklists/`;
const MAX_ARCHIVE_PAGES = Number(process.env.CLOUTSNCHARA_MAX_PAGES || 100);
const DELAY_MS = Number(process.env.PUBLIC_SOURCE_DELAY_MS || 250);

const CATEGORY_UNIVERSE = new Map([
  ["hockey", "hockey"],
  ["baseball", "baseball"],
  ["basketball", "basketball"],
  ["footballchecklist", "football"],
  ["football", "football"],
  ["golf", "golf"],
  ["multisport", "multi-sport"],
  ["multi-sport", "multi-sport"],
  ["wrestling", "wrestling"],
  ["racing", "racing"],
  ["nonsport", "non-sport"],
  ["non-sport", "non-sport"],
]);

function pause() {
  return DELAY_MS > 0 ? new Promise((resolve) => setTimeout(resolve, DELAY_MS)) : Promise.resolve();
}

function articleUrl(value) {
  const normalized = normalizeUrl(value, ORIGIN);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  if (!/(^|\.)cloutsnchara\.com$/i.test(parsed.hostname)) return null;
  if (!parsed.pathname.startsWith("/checklist/")) return null;
  if (parsed.pathname === "/checklist/") return null;
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "/")}`;
}

function categoriesFromHtml(html) {
  const values = [];
  for (const match of String(html).matchAll(/href=["'][^"']*\/checklist_category\/([^\/"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    values.push(decodeHtml(match[2]) || match[1]);
  }
  for (const match of String(html).matchAll(/rel=["']category tag["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    values.push(decodeHtml(match[1]));
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function universeFromHtml(html, categories, title) {
  for (const match of String(html).matchAll(/\/checklist_category\/([^\/"'#?]+)/gi)) {
    const mapped = CATEGORY_UNIVERSE.get(match[1].toLowerCase());
    if (mapped) return mapped;
  }
  const sport = extractSport(title, categories, null);
  if (sport) return sport;
  if (categories.some((value) => /non[- ]?sport/i.test(value))) return "non-sport";
  return null;
}

function sourceRevision(html) {
  return String(html).match(/property=["']article:modified_time["'][^>]+content=["']([^"']+)/i)?.[1]
    || String(html).match(/<time[^>]+datetime=["']([^"']+)/i)?.[1]
    || null;
}

function extractChecklistRows(html) {
  const raw = String(html);
  const marker = raw.search(/(?:Filter Checklist|Filtered List Found|class=["'][^"']*checklist)/i);
  const region = marker >= 0 ? raw.slice(marker) : raw;
  const footer = region.search(/CloutsnChara Sports Cards is dedicated|<footer\b|class=["'][^"']*site-footer/i);
  const bounded = footer >= 0 ? region.slice(0, footer) : region;
  const rows = [];

  for (const match of bounded.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const text = decodeHtml(match[1]).replace(/\s+/g, " ").trim();
    if (!text || text.length < 5 || text.length > 1000) continue;
    if (/^(?:Home|Shop|Box|Login|Register|All|Hockey|Baseball|Basketball|Football|Golf|Racing|Wrestling|Non-Sport|Multi-Sport)$/i.test(text)) continue;
    const hasCardNumber = /(?:^|\s)(?:[A-Z]{1,12}[- ]?)?\d{1,5}[A-Z]?(?:\s|$)/.test(text);
    const hasCardFeature = /\b(?:base set|rookie|insert|parallel|script|autograph|auto|memorabilia|relic|jersey|patch|materials?|signature|numbered|1\/1|\/\d{1,4}|#\d+)\b/i.test(text);
    if (!hasCardNumber && !hasCardFeature) continue;
    rows.push(text);
  }

  if (!rows.length) {
    const plain = decodeHtml(bounded);
    for (const line of plain.split(/\n/).map((value) => value.replace(/\s+/g, " ").trim())) {
      if (!line || line.length < 5 || line.length > 1000) continue;
      if (!/(?:^|\s)(?:[A-Z]{1,12}[- ]?)?\d{1,5}[A-Z]?(?:\s|$)/.test(line)) continue;
      if (!/\b(?:base set|rookie|insert|parallel|script|autograph|auto|memorabilia|relic|jersey|patch|signature|point|pack|team)\b/i.test(line)) continue;
      rows.push(line);
    }
  }

  return [...new Set(rows)];
}

function checklistPayload(rows) {
  if (!rows.length) return "";
  return [
    "row_id\tsource_row",
    ...rows.map((row, index) => `${index + 1}\t${row.replace(/\t/g, " ")}`),
  ].join("\n");
}

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];
  let emptyPages = 0;

  for (let page = 1; page <= MAX_ARCHIVE_PAGES && urls.size < MAX_ITEMS; page++) {
    const url = page === 1 ? INDEX : `${INDEX}page/${page}/`;
    try {
      const { text: html, finalUrl } = await fetchText(url);
      let found = 0;
      for (const link of hrefs(html, finalUrl)) {
        const article = articleUrl(link);
        if (article && !urls.has(article)) {
          urls.add(article);
          found += 1;
        }
      }
      emptyPages = found === 0 ? emptyPages + 1 : 0;
      if (page > 5 && emptyPages >= 4) break;
    } catch (error) {
      discoveryFailures.push({ stage: "archive", url, error: String(error) });
      emptyPages += 1;
      if (page > 5 && emptyPages >= 4) break;
    }
    await pause();
  }

  return { urls, discoveryFailures };
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const { urls, discoveryFailures } = await discover();
  const items = [];
  const failures = [];

  for (const url of [...urls].slice(0, MAX_ITEMS)) {
    try {
      const { text: html, finalUrl } = await fetchText(url);
      const title = titleFromHtml(html, finalUrl);
      const categories = categoriesFromHtml(html);
      const universe = universeFromHtml(html, categories, title);
      const sport = universe && universe !== "non-sport" ? universe : null;
      const season = extractSeason(title);
      const manufacturer = extractMaker(title, categories, finalUrl);
      const product = extractProduct(title, manufacturer, sport || universe);
      const rows = extractChecklistRows(html);
      const checklist = checklistPayload(rows);
      const downloads = await downloadPublicFiles(fileLinks(html, finalUrl), [
        "cloutsnchara.com",
        "upperdeck.com",
        "upperdeckblog.com",
      ]);
      items.push(saveItem({
        url: finalUrl,
        title,
        universe,
        sport,
        season,
        manufacturer,
        product,
        categories,
        sourceRevision: sourceRevision(html),
        checklist,
        checklistRows: rows.length,
      }, downloads));
    } catch (error) {
      failures.push({ url, error: String(error) });
    }
    await pause();
  }

  finishSource({ items, failures, discoveryFailures, discovered: urls.size });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
