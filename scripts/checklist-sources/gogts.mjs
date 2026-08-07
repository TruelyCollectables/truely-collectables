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
  saveItem,
  titleFromHtml,
  xmlLocs,
} from "./shared.mjs";

const ORIGIN = "https://gogts.net";
const INDEX_SEEDS = [
  `${ORIGIN}/checklists/`,
  `${ORIGIN}/trading-card-checklists/baseball-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/football-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/basketball-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/hockey-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/soccer-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/racing-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/entertainment-checklists/`,
  `${ORIGIN}/trading-card-checklists/wrestling-card-checklists/`,
  `${ORIGIN}/trading-card-checklists/multi-other-sport-checklists/`,
];

function sameSite(url) {
  try {
    const host = new URL(url).hostname;
    return host === "gogts.net" || host.endsWith(".gogts.net");
  } catch {
    return false;
  }
}

function checklistPage(url, label = "") {
  if (!sameSite(url)) return false;
  const parsed = new URL(url);
  const text = `${parsed.pathname} ${label}`;
  return /checklist/i.test(text)
    && !/trading-card-checklists\/?$/i.test(parsed.pathname)
    && !/\/page\/\d+\/?$/i.test(parsed.pathname)
    && !/\.(?:pdf|xlsx?|csv|tsv|jpg|jpeg|png|gif|webp|svg)(?:\?|$)/i.test(url);
}

function categoryNames(html) {
  return [...String(html).matchAll(/rel=["']category tag["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => decodeHtml(match[1]))
    .filter(Boolean);
}

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];
  const queue = [...INDEX_SEEDS];
  const seen = new Set();

  while (queue.length && seen.size < MAX_DISCOVERY_PAGES && urls.size < MAX_ITEMS) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const { text: html, finalUrl } = await fetchText(url);
      for (const match of String(html).matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let linked;
        try {
          linked = new URL(match[1].replace(/&amp;/gi, "&"), finalUrl).toString();
        } catch {
          continue;
        }
        const label = decodeHtml(match[2]);
        if (checklistPage(linked, label)) urls.add(linked);
        if (sameSite(linked) && /(?:\/page\/\d+\/?$|trading-card-checklists\/[^/]+\/?$)/i.test(new URL(linked).pathname) && !seen.has(linked)) queue.push(linked);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "public-index", url, error: String(error) });
    }
  }

  const sitemapQueue = new Set([`${ORIGIN}/wp-sitemap.xml`, `${ORIGIN}/sitemap_index.xml`, `${ORIGIN}/sitemap.xml`]);
  const seenSitemaps = new Set();
  for (const sitemap of sitemapQueue) {
    if (seenSitemaps.size >= MAX_DISCOVERY_PAGES || seenSitemaps.has(sitemap) || urls.size >= MAX_ITEMS) continue;
    seenSitemaps.add(sitemap);
    try {
      const { text } = await fetchText(sitemap, "application/xml,text/xml,*/*");
      for (const loc of xmlLocs(text)) {
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(loc)) sitemapQueue.add(loc);
        else if (checklistPage(loc)) urls.add(loc);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "sitemap", url: sitemap, error: String(error) });
    }
  }

  if (urls.size < 100) {
    for (let page = 1; page <= 100 && urls.size < MAX_ITEMS; page++) {
      const endpoint = `${ORIGIN}/wp-json/wp/v2/search?search=checklist&subtype=post&per_page=100&page=${page}&_fields=id,title,url`;
      try {
        const rows = await fetchJson(endpoint);
        if (!Array.isArray(rows) || !rows.length) break;
        for (const row of rows) if (checklistPage(row.url || "", decodeHtml(row.title || ""))) urls.add(row.url);
        if (rows.length < 100) break;
      } catch (error) {
        if (page === 1) discoveryFailures.push({ stage: "rest-search", url: endpoint, error: String(error) });
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
      const categories = categoryNames(html);
      const checklist = extractChecklistFromHtml(html);
      const sport = extractSport(title, categories, categories.some((value) => /entertainment|non-sport/i.test(value)) ? "non-sport" : null);
      const season = extractSeason(title);
      const manufacturer = extractMaker(title, categories, finalUrl);
      const product = extractProduct(title, manufacturer, sport);
      const downloads = await downloadPublicFiles(fileLinks(html, finalUrl), ["gogts.net"]);
      items.push(saveItem({
        url: finalUrl,
        title,
        sport,
        season,
        manufacturer,
        product,
        checklist,
        categories: [...categories, "public-download-source"],
      }, downloads));
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
