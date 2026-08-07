import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_ITEMS,
  decodeHtml,
  downloadPublicFiles,
  extractChecklistFromHtml,
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

const ORIGIN = "https://www.beckett.com";
const CATEGORY = `${ORIGIN}/news/category/checklists-new/`;
const REFERENCE_CATEGORY = `${ORIGIN}/news/category/sports-card-reference/`;
const MAX_ARCHIVE_PAGES = Number(process.env.BECKETT_MAX_PAGES || 100);
const DELAY_MS = Number(process.env.PUBLIC_SOURCE_DELAY_MS || 150);
const CALENDAR_SEEDS = [
  `${ORIGIN}/news/sports-card-release-calendar-dates/`,
  `${ORIGIN}/news/2026-baseball-card-release-dates-checklists-and-set-information/`,
  `${ORIGIN}/news/2026-football-cards-release-dates-checklists-and-set-information/`,
  `${ORIGIN}/news/2026-basketball-card-release-dates-checklists-and-set-information/`,
  `${ORIGIN}/news/2025-26-hockey-cards-release-dates-checklists-and-set-information/`,
  `${ORIGIN}/news/2026-soccer-card-release-dates-checklists-and-set-information/`,
  `${ORIGIN}/news/2026-non-sports-cards-release-dates-checklists-and-set-information/`,
  `${ORIGIN}/news/2026-tcg-release-dates-checklists-and-set-information/`,
];

function pause() {
  return DELAY_MS > 0 ? new Promise((resolve) => setTimeout(resolve, DELAY_MS)) : Promise.resolve();
}

function articleUrl(value) {
  const normalized = normalizeUrl(value, ORIGIN);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  if (parsed.hostname !== "www.beckett.com" && parsed.hostname !== "beckett.com") return null;
  if (!parsed.pathname.startsWith("/news/")) return null;
  if (/\/category\/|\/tag\/|\/author\/|\/page\//.test(parsed.pathname)) return null;
  return normalized.replace(/\/$/, "") + "/";
}

function categoriesFromHtml(html) {
  const values = [];
  for (const match of String(html).matchAll(/rel=["']category tag["'][^>]*>([\s\S]*?)<\/a>/gi)) values.push(decodeHtml(match[1]));
  for (const match of String(html).matchAll(/class=["'][^"']*(?:breadcrumb|cat-links)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p)>/gi)) values.push(decodeHtml(match[1]));
  return values.filter(Boolean);
}

async function discoverArchive(category, stage, pageLimit = MAX_ARCHIVE_PAGES) {
  const urls = new Set();
  const failures = [];
  let emptyPages = 0;

  for (let page = 1; page <= pageLimit && urls.size < MAX_ITEMS; page++) {
    const url = page === 1 ? category : `${category}page/${page}/`;
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
      failures.push({ stage, url, error: String(error) });
      emptyPages += 1;
      if (page > 5 && emptyPages >= 4) break;
    }
    await pause();
  }

  return { urls, failures };
}

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];

  const checklistArchive = await discoverArchive(CATEGORY, "checklist-archive");
  checklistArchive.urls.forEach((url) => urls.add(url));
  discoveryFailures.push(...checklistArchive.failures);

  const referenceArchive = await discoverArchive(REFERENCE_CATEGORY, "release-reference-archive", Math.min(MAX_ARCHIVE_PAGES, 30));
  referenceArchive.urls.forEach((url) => urls.add(url));
  discoveryFailures.push(...referenceArchive.failures);

  for (const calendar of CALENDAR_SEEDS) {
    try {
      const { text: html, finalUrl } = await fetchText(calendar);
      for (const link of hrefs(html, finalUrl)) {
        const article = articleUrl(link);
        if (article) urls.add(article);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "release-calendar", url: calendar, error: String(error) });
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
      const plainLead = decodeHtml(html).slice(0, 10000);
      const checklist = extractChecklistFromHtml(html);
      const looksLikeSet = /\b(?:18|19|20)\d{2}\b/.test(title)
        && /\b(?:cards?|checklist|set)\b/i.test(`${title}\n${plainLead}`);
      if (!looksLikeSet && !checklist) continue;

      const sport = extractSport(`${title}\n${finalUrl}`, categories, null);
      const season = extractSeason(title);
      const manufacturer = extractMaker(title, categories, finalUrl);
      const product = extractProduct(title, manufacturer, sport);
      const downloads = await downloadPublicFiles(fileLinks(html, finalUrl), [
        "beckett.com",
        "beckett-www.s3.amazonaws.com",
      ]);
      items.push(saveItem({ url: finalUrl, title, sport, season, manufacturer, product, categories, checklist }, downloads));
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
