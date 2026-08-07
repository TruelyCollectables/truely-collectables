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

const ORIGIN = "https://www.sportscardradio.com";
const PUBLIC_INDEXES = [
  `${ORIGIN}/sports-card-checklists/`,
  `${ORIGIN}/baseball-card-checklists/`,
  `${ORIGIN}/basketball-card-checklists/`,
  `${ORIGIN}/football-card-checklists/`,
  `${ORIGIN}/hockey-card-checklists/`,
];
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

function sameSite(url) {
  try {
    const host = new URL(url).hostname;
    return host === "sportscardradio.com" || host.endsWith(".sportscardradio.com");
  } catch {
    return false;
  }
}

function checklistCandidate(url, label = "") {
  if (!sameSite(url)) return false;
  const text = `${url} ${label}`;
  return /checklist|card-checklists|sports-card-checklists/i.test(text)
    && !/wp-json|wp-admin|wp-login|feed\/|comments\/feed|\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?|$)/i.test(url);
}

function sportFromPage(title, html, url) {
  const categories = [...String(html).matchAll(/rel=["']category tag["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => decodeHtml(match[1]));
  return extractSport(`${title}\n${url}`, categories, null);
}

async function discoverFromPublicIndexes(urls, discoveryFailures) {
  const queue = [...PUBLIC_INDEXES];
  const seen = new Set();

  while (queue.length && seen.size < Math.min(MAX_DISCOVERY_PAGES, 250) && urls.size < MAX_ITEMS) {
    const indexUrl = queue.shift();
    if (!indexUrl || seen.has(indexUrl)) continue;
    seen.add(indexUrl);
    try {
      const { text: html, finalUrl } = await fetchText(indexUrl);
      for (const match of String(html).matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        let linked;
        try {
          linked = new URL(match[1].replace(/&amp;/gi, "&"), finalUrl).toString();
        } catch {
          continue;
        }
        const label = decodeHtml(match[2]);
        if (!checklistCandidate(linked, label)) continue;
        urls.add(linked);
        if (/card-checklists|sports-card-checklists|\/category\/.*checklist/i.test(linked) && !seen.has(linked)) queue.push(linked);
        if (urls.size >= MAX_ITEMS) break;
      }

      for (const linked of hrefs(html, finalUrl)) {
        if (checklistCandidate(linked)) urls.add(linked);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "public-index-html", url: indexUrl, error: String(error) });
    }
  }
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
        else if (checklistCandidate(loc)) urls.add(loc);
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
          if (checklistCandidate(row.url || "", decodeHtml(row.title || ""))) urls.add(row.url);
        }
        if (rows.length < 100) break;
      } catch (error) {
        if (page === 1) discoveryFailures.push({ stage: "rest", url: endpoint, error: String(error) });
        break;
      }
    }
  }

  if (urls.size === 0) await discoverFromPublicIndexes(urls, discoveryFailures);
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
      const checklist = extractChecklistFromHtml(html);
      const looksLikeChecklist = /checklist/i.test(`${title}\n${finalUrl}`) || Boolean(checklist);
      if (!looksLikeChecklist) continue;

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
