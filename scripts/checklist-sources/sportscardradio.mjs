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
  saveItem,
  titleFromHtml,
  xmlLocs,
} from "./shared.mjs";

const ORIGIN = "https://www.sportscardradio.com";
const SEARCH_TERMS = [
  "checklist",
  "baseball checklist",
  "basketball checklist",
  "football checklist",
  "hockey checklist",
  "soccer checklist",
  "UFC checklist",
  "racing checklist",
];

function sportFromPage(title, html, url) {
  const categories = [...String(html).matchAll(/rel=["']category tag["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => decodeHtml(match[1]));
  return extractSport(`${title}\n${url}`, categories, null);
}

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];
  const sitemapQueue = new Set([
    `${ORIGIN}/wp-sitemap.xml`,
    `${ORIGIN}/sitemap_index.xml`,
    `${ORIGIN}/sitemap.xml`,
  ]);
  const seenSitemaps = new Set();

  for (const sitemap of sitemapQueue) {
    if (seenSitemaps.size >= MAX_DISCOVERY_PAGES || seenSitemaps.has(sitemap)) continue;
    seenSitemaps.add(sitemap);
    try {
      const { text } = await fetchText(sitemap, "application/xml,text/xml,*/*");
      for (const loc of xmlLocs(text)) {
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(loc)) sitemapQueue.add(loc);
        else if (/checklist|card-checklists|sports-card-checklists/i.test(loc)) urls.add(loc);
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
          if (/checklist/i.test(`${decodeHtml(row.title || "")} ${row.url || ""}`)) urls.add(row.url);
        }
        if (rows.length < 100) break;
      } catch (error) {
        if (page === 1) discoveryFailures.push({ stage: "rest", url: endpoint, error: String(error) });
        break;
      }
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
      if (!/checklist/i.test(`${title}\n${finalUrl}`)) continue;

      const checklist = extractChecklistFromHtml(html);
      const sport = sportFromPage(title, html, finalUrl);
      const season = extractSeason(title);
      const manufacturer = extractMaker(title, [], finalUrl);
      const product = extractProduct(title, manufacturer, sport);
      const downloads = await downloadPublicFiles(fileLinks(html, finalUrl), ["sportscardradio.com"]);
      items.push(saveItem({ url: finalUrl, title, sport, season, manufacturer, product, checklist }, downloads));
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
