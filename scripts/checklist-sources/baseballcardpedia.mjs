import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_ITEMS,
  decodeHtml,
  extractChecklistFromWiki,
  extractMaker,
  extractProduct,
  extractSeason,
  fetchJson,
  finishSource,
  saveItem,
} from "./shared.mjs";

const ORIGIN = "https://www.baseballcardpedia.com";
const API = `${ORIGIN}/api.php`;

async function discoverSetTitles() {
  const titles = new Set();
  const discoveryFailures = [];
  let plcontinue = null;
  do {
    const params = new URLSearchParams({
      action: "query",
      prop: "links",
      titles: "All Sets by Name",
      plnamespace: "0",
      pllimit: "max",
      format: "json",
      origin: "*",
    });
    if (plcontinue) params.set("plcontinue", plcontinue);
    try {
      const data = await fetchJson(`${API}?${params}`);
      for (const page of Object.values(data.query?.pages || {})) {
        for (const link of page.links || []) titles.add(link.title);
      }
      plcontinue = data.continue?.plcontinue || null;
    } catch (error) {
      discoveryFailures.push({ stage: "all-sets-by-name", error: String(error) });
      break;
    }
  } while (plcontinue && titles.size < MAX_ITEMS);
  return { titles, discoveryFailures };
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const { titles, discoveryFailures } = await discoverSetTitles();
  const items = [];
  const failures = [];

  for (const title of [...titles].slice(0, MAX_ITEMS)) {
    try {
      const params = new URLSearchParams({
        action: "parse",
        page: title,
        prop: "wikitext|categories|displaytitle|revid",
        redirects: "1",
        format: "json",
        origin: "*",
      });
      const data = await fetchJson(`${API}?${params}`);
      const parse = data.parse;
      if (!parse?.wikitext?.["*"]) continue;

      const categories = (parse.categories || []).map((row) => row["*"]).filter(Boolean);
      const cleanTitle = decodeHtml(parse.displaytitle || parse.title || title);
      const checklist = extractChecklistFromWiki(parse.wikitext["*"]);
      const season = extractSeason(cleanTitle);
      const manufacturer = extractMaker(cleanTitle, categories);
      const sport = "baseball";
      const product = extractProduct(cleanTitle, manufacturer, sport);
      const canonicalTitle = String(parse.title || title).replace(/ /g, "_");
      const url = `${ORIGIN}/index.php/${encodeURIComponent(canonicalTitle)}`;

      items.push(saveItem({
        url,
        title: cleanTitle,
        sport,
        season,
        manufacturer,
        product,
        categories,
        sourceRevision: parse.revid ? String(parse.revid) : null,
        checklist,
      }));
    } catch (error) {
      failures.push({ title, error: String(error) });
    }
  }

  finishSource({ items, failures, discoveryFailures, discovered: titles.size });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
