import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_ITEMS,
  decodeHtml,
  extractChecklistFromHtml,
  extractMaker,
  extractProduct,
  extractSeason,
  fetchText,
  finishSource,
  hrefs,
  normalizeUrl,
  saveItem,
  titleFromHtml,
} from "./shared-safe.mjs";

const ORIGIN = "https://www.keymancollectibles.com";
const SEEDS = [
  `${ORIGIN}/cards.htm`,
  `${ORIGIN}/baseballcardchecklist.htm`,
  `${ORIGIN}/toppsbaseballcards.htm`,
  `${ORIGIN}/upperdeckbaseballcards.htm`,
  `${ORIGIN}/postbaseballcards.htm`,
  `${ORIGIN}/toppstradedbaseballcardsets.htm`,
  `${ORIGIN}/exhibitbaseballcards.htm`,
  `${ORIGIN}/exhibitbaseballcards3.htm`,
];

function candidate(url) {
  const parsed = new URL(url);
  if (!/(^|\.)keymancollectibles\.com$/i.test(parsed.hostname)) return false;
  const path = parsed.pathname.toLowerCase();
  if (!/\.html?$/.test(path)) return false;
  if (/\/(newsletter|articles|priceguide|baseballgloves|baseballbats|autographs|tickets|stadiums|photos|magazines)\//.test(path)) return false;
  return /(baseballcards?|cards\.htm|cardchecklist|topps|fleer|donruss|upperdeck|score|bowman|post|exhibit|pinnacle|stadiumclub|miscellaneoussets)/.test(path);
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const queue = [...SEEDS];
  const seen = new Set();
  const items = [];
  const failures = [];

  while (queue.length && seen.size < MAX_ITEMS) {
    const url = queue.shift();
    if (!url || seen.has(url) || !candidate(url)) continue;
    seen.add(url);

    try {
      const { text: html, finalUrl } = await fetchText(url);
      for (const link of hrefs(html, finalUrl)) {
        const normalized = normalizeUrl(link, ORIGIN);
        if (normalized && candidate(normalized) && !seen.has(normalized) && queue.length + seen.size < MAX_ITEMS * 2) {
          queue.push(normalized);
        }
      }

      const title = titleFromHtml(html, finalUrl);
      const plain = decodeHtml(html);
      const looksLikeSet = /\b(?:18|19|20)\d{2}\b/.test(title)
        && /\b(?:baseball cards?|card set|card checklist)\b/i.test(`${title}\n${plain.slice(0, 4000)}`);
      const checklist = extractChecklistFromHtml(html);
      if (!looksLikeSet && !checklist) continue;

      const season = extractSeason(title);
      const manufacturer = extractMaker(title, [], finalUrl);
      const sport = "baseball";
      const product = extractProduct(title, manufacturer, sport);
      items.push(saveItem({ url: finalUrl, title, sport, season, manufacturer, product, checklist }));
    } catch (error) {
      failures.push({ url, error: String(error) });
    }
  }

  finishSource({ items, failures, discoveryFailures: [], discovered: seen.size });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
