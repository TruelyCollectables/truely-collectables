import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_DISCOVERY_PAGES,
  MAX_ITEMS,
  decodeHtml,
  downloadPublicFiles,
  extractChecklistFromHtml,
  extractMaker,
  extractProduct,
  extractSeason,
  extractSport,
  fetchJson,
  fetchText,
  fileLinks,
  finishSource,
  hrefs,
  normalizeUrl,
  saveItem,
  titleFromHtml,
  xmlLocs,
} from "./shared.mjs";

const ORIGIN = "https://www.cardboardconnection.com";
const SEARCH_TERMS = [
  "checklist", "panini", "donruss", "topps", "upper deck", "fleer", "score", "leaf",
  "prizm", "contenders", "select", "national treasures", "immaculate", "flawless", "mosaic",
  "chronicles", "obsidian", "origins", "certified", "absolute", "prestige", "playoff",
];
const INDEX_SEEDS = [
  "/latest-news",
  "/product-reviews",
  "/sports-cards-sets/nfl-football-cards",
  "/sports-cards-sets/basketball-cards",
  "/sports-cards-sets/baseball-cards",
  "/sports-cards-sets/hockey-cards",
  "/sports-cards-sets/soccer-cards",
  "/sports-cards-sets/racing-cards",
];

function candidate(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)cardboardconnection\.com$/i.test(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase();
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|css|js|xml|json)$/i.test(path)) return false;
    if (/\/(?:author|tag|page)\//.test(path)) return false;
    return /checklist|panini|donruss|topps|upper-deck|fleer|score|leaf|prizm|contenders|select|national-treasures|immaculate|flawless|mosaic|chronicles|obsidian|origins|certified|absolute|prestige|playoff/.test(path);
  } catch {
    return false;
  }
}

function categoriesFromHtml(html) {
  return [...String(html).matchAll(/rel=["']category tag["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => decodeHtml(match[1]));
}

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];
  const sitemapQueue = new Set([
    `${ORIGIN}/sitemap_index.xml`,
    `${ORIGIN}/wp-sitemap.xml`,
    `${ORIGIN}/sitemap.xml`,
  ]);
  const seenSitemaps = new Set();

  for (const sitemap of sitemapQueue) {
    if (seenSitemaps.size >= 250 || seenSitemaps.has(sitemap)) continue;
    seenSitemaps.add(sitemap);
    try {
      const { text } = await fetchText(sitemap, "application/xml,text/xml,*/*");
      for (const loc of xmlLocs(text)) {
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(loc)) sitemapQueue.add(loc);
        else if (candidate(loc)) urls.add(loc);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "sitemap", url: sitemap, error: String(error) });
    }
  }

  for (const term of SEARCH_TERMS) {
    for (let page = 1; page <= 100 && urls.size < MAX_ITEMS; page++) {
      const endpoint = `${ORIGIN}/wp-json/wp/v2/search?search=${encodeURIComponent(term)}&subtype=post&per_page=100&page=${page}&_fields=id,title,url,subtype`;
      try {
        const rows = await fetchJson(endpoint);
        if (!Array.isArray(rows) || !rows.length) break;
        for (const row of rows) {
          const normalized = normalizeUrl(row.url, ORIGIN);
          if (normalized && candidate(normalized)) urls.add(normalized);
        }
        if (rows.length < 100) break;
      } catch (error) {
        if (page === 1) discoveryFailures.push({ stage: "rest", url: endpoint, error: String(error) });
        break;
      }
    }
  }

  const indexUrls = new Set(INDEX_SEEDS.map((path) => `${ORIGIN}${path}`));
  for (let page = 2; page <= Math.min(MAX_DISCOVERY_PAGES, 200); page++) {
    indexUrls.add(`${ORIGIN}/latest-news/page/${page}`);
  }
  for (const term of SEARCH_TERMS) {
    for (let page = 1; page <= 25; page++) indexUrls.add(`${ORIGIN}/?s=${encodeURIComponent(term)}&paged=${page}`);
  }
  let attempted = 0;
  for (const indexUrl of indexUrls) {
    if (attempted >= MAX_DISCOVERY_PAGES || urls.size >= MAX_ITEMS) break;
    attempted += 1;
    try {
      const { text, finalUrl } = await fetchText(indexUrl);
      for (const link of hrefs(text, finalUrl)) if (candidate(link)) urls.add(link);
    } catch (error) {
      discoveryFailures.push({ stage: "index", url: indexUrl, error: String(error) });
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
      const plainLead = decodeHtml(html).slice(0, 8000);
      const checklist = extractChecklistFromHtml(html);
      const looksLikeSet = /\b(?:18|19|20)\d{2}\b/.test(title)
        && /\b(?:cards?|checklist|set)\b/i.test(`${title}\n${plainLead}`);
      if (!looksLikeSet && !checklist) continue;

      const sport = extractSport(`${title}\n${finalUrl}`, categories, null);
      const season = extractSeason(title);
      const manufacturer = extractMaker(title, categories, finalUrl);
      const product = extractProduct(title, manufacturer, sport);
      const downloads = await downloadPublicFiles(fileLinks(html, finalUrl), ["cardboardconnection.com"]);
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
