import { mkdirSync } from "node:fs";
import {
  ITEMS,
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
} from "./shared.mjs";

const ORIGIN = "https://www.bigapplecollects.com";
const INDEX = `${ORIGIN}/checklists`;

function candidate(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.bigapplecollects.com"
      && /^\/checklists\/[^/]+\/?$/i.test(parsed.pathname)
      && parsed.pathname !== "/checklists/";
  } catch {
    return false;
  }
}

function pageSport(title, html) {
  const context = `${title}\n${decodeHtml(html).slice(0, 2500)}`;
  return extractSport(context, [], /star wars|disney|marvel|entertainment|garbage pail|metazoo|minecraft/i.test(context) ? "non-sport" : null);
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const items = [];
  const failures = [];
  const discoveryFailures = [];
  const urls = new Set();

  try {
    const { text: html, finalUrl } = await fetchText(INDEX);
    for (const url of hrefs(html, finalUrl)) if (candidate(url)) urls.add(url);
  } catch (error) {
    discoveryFailures.push({ stage: "checklist-index", url: INDEX, error: String(error) });
  }

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
