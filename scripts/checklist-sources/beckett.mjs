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
const MAX_ARCHIVE_PAGES = Number(process.env.BECKETT_MAX_PAGES || 100);

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

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];
  let emptyPages = 0;

  for (let page = 1; page <= MAX_ARCHIVE_PAGES && urls.size < MAX_ITEMS; page++) {
    const url = page === 1 ? CATEGORY : `${CATEGORY}page/${page}/`;
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
  }

  finishSource({ items, failures, discoveryFailures, discovered: urls.size });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
