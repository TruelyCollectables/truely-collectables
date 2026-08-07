import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_DISCOVERY_PAGES,
  MAX_ITEMS,
  decodeHtml,
  extractChecklistFromHtml,
  extractMaker,
  extractProduct,
  extractSeason,
  extractSport,
  fetchText,
  finishSource,
  hrefs,
  saveItem,
  titleFromHtml,
  xmlLocs,
} from "./shared.mjs";

const ORIGIN = "https://www.bigapplecollects.com";
const SEEDS = [`${ORIGIN}/checklists`, `${ORIGIN}/sitemap.xml`, `${ORIGIN}/sitemap_index.xml`];

function candidate(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)bigapplecollects\.com$/i.test(parsed.hostname)
      && /^\/checklists\/[^/]+\/?$/i.test(parsed.pathname)
      && parsed.pathname !== "/checklists/";
  } catch {
    return false;
  }
}

function embeddedChecklistUrls(html, base) {
  const out = new Set();
  const normalized = String(html).replace(/\\\//g, "/");
  for (const match of normalized.matchAll(/(?:https?:\/\/(?:www\.)?bigapplecollects\.com)?(\/checklists\/[a-z0-9][a-z0-9-]*)(?:["'?#<\\]|$)/gi)) {
    try {
      const url = new URL(match[1], base).toString();
      if (candidate(url)) out.add(url);
    } catch {}
  }
  return [...out];
}

function pageSport(title, html) {
  const context = `${title}\n${decodeHtml(html).slice(0, 2500)}`;
  return extractSport(context, [], /star wars|disney|marvel|entertainment|garbage pail|metazoo|minecraft/i.test(context) ? "non-sport" : null);
}

async function discover() {
  const urls = new Set();
  const discoveryFailures = [];
  const queue = [...SEEDS];
  const seen = new Set();

  while (queue.length && seen.size < MAX_DISCOVERY_PAGES && urls.size < MAX_ITEMS) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const { text, finalUrl } = await fetchText(url, /\.xml(?:\?|$)/i.test(url) ? "application/xml,text/xml,*/*" : undefined);
      if (/\.xml(?:\?|$)/i.test(url) || /<urlset|<sitemapindex/i.test(text.slice(0, 500))) {
        for (const loc of xmlLocs(text)) {
          if (candidate(loc)) urls.add(loc);
          else if (/\.xml(?:\?|$)/i.test(loc) && !seen.has(loc)) queue.push(loc);
        }
      } else {
        for (const linked of hrefs(text, finalUrl)) if (candidate(linked)) urls.add(linked);
        for (const linked of embeddedChecklistUrls(text, finalUrl)) urls.add(linked);
      }
    } catch (error) {
      discoveryFailures.push({ stage: "index-or-sitemap", url, error: String(error) });
    }
  }

  return { urls, discoveryFailures };
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const items = [];
  const failures = [];
  const { urls, discoveryFailures } = await discover();

  for (const url of [...urls].slice(0, MAX_ITEMS)) {
    try {
      const { text: html, finalUrl } = await fetchText(url);
      const title = titleFromHtml(html, finalUrl);
      if (!/checklist/i.test(title)) continue;
      const checklist = extractChecklistFromHtml(html);
      const sport = pageSport(title, html);
      const season = extractSeason(title);
      const manufacturer = extractMaker(title, [], finalUrl);
      const product = extractProduct(title, manufacturer, sport);
      items.push(saveItem({
        url: finalUrl,
        title,
        sport,
        season,
        manufacturer,
        product,
        checklist,
        categories: ["secondary-public-checklist-source"],
      }));
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
