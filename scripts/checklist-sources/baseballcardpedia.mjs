import { mkdirSync } from "node:fs";
import {
  ITEMS,
  MAX_ITEMS,
  decodeHtml,
  extractChecklistFromHtml,
  extractChecklistFromWiki,
  extractMaker,
  extractProduct,
  extractSeason,
  fetchJson,
  fetchText,
  finishSource,
  hrefs,
  saveItem,
  titleFromHtml,
} from "./shared.mjs";

const ORIGIN = "https://www.baseballcardpedia.com";
const API = `${ORIGIN}/api.php`;
const ALL_SETS_URL = `${ORIGIN}/index.php/All_Sets_by_Name`;

function titleFromSetUrl(url) {
  try {
    const parsed = new URL(url);
    const marker = "/index.php/";
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    return decodeURIComponent(parsed.pathname.slice(index + marker.length)).replace(/_/g, " ").trim() || null;
  } catch {
    return null;
  }
}

function isSetPage(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)baseballcardpedia\.com$/i.test(parsed.hostname)) return false;
    if (!parsed.pathname.startsWith("/index.php/")) return false;
    const title = titleFromSetUrl(url) || "";
    if (!/\b(?:18|19|20)\d{2}\b/.test(title)) return false;
    if (/^(?:All Sets|Main Page|Special:|Category:|File:|Template:|Talk:|Help:)/i.test(title)) return false;
    return true;
  } catch {
    return false;
  }
}

async function discoverSetCandidates() {
  const candidates = new Map();
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
        for (const link of page.links || []) {
          const title = String(link.title || "").trim();
          if (!title || !/\b(?:18|19|20)\d{2}\b/.test(title)) continue;
          const url = `${ORIGIN}/index.php/${encodeURIComponent(title.replace(/ /g, "_"))}`;
          candidates.set(url, { title, url, discovery: "mediawiki-api" });
        }
      }
      plcontinue = data.continue?.plcontinue || null;
    } catch (error) {
      discoveryFailures.push({ stage: "all-sets-mediawiki-api", url: `${API}?${params}`, error: String(error) });
      break;
    }
  } while (plcontinue && candidates.size < MAX_ITEMS);

  if (candidates.size === 0) {
    try {
      const { text: html, finalUrl } = await fetchText(ALL_SETS_URL);
      for (const url of hrefs(html, finalUrl)) {
        if (!isSetPage(url)) continue;
        const title = titleFromSetUrl(url);
        if (title) candidates.set(url, { title, url, discovery: "all-sets-html" });
        if (candidates.size >= MAX_ITEMS) break;
      }
    } catch (error) {
      discoveryFailures.push({ stage: "all-sets-html", url: ALL_SETS_URL, error: String(error) });
    }
  }

  return { candidates: [...candidates.values()], discoveryFailures };
}

async function parseViaApi(title) {
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
  if (!parse?.wikitext?.["*"]) throw new Error("MediaWiki parse response did not include wikitext");
  return {
    title: decodeHtml(parse.displaytitle || parse.title || title),
    categories: (parse.categories || []).map((row) => row["*"]).filter(Boolean),
    checklist: extractChecklistFromWiki(parse.wikitext["*"]),
    sourceRevision: parse.revid ? String(parse.revid) : null,
    url: `${ORIGIN}/index.php/${encodeURIComponent(String(parse.title || title).replace(/ /g, "_"))}`,
  };
}

async function parseViaHtml(candidate) {
  const { text: html, finalUrl } = await fetchText(candidate.url);
  return {
    title: titleFromHtml(html, candidate.title),
    categories: [],
    checklist: extractChecklistFromHtml(html),
    sourceRevision: null,
    url: finalUrl,
  };
}

async function main() {
  mkdirSync(ITEMS, { recursive: true });
  const { candidates, discoveryFailures } = await discoverSetCandidates();
  const items = [];
  const failures = [];

  for (const candidate of candidates.slice(0, MAX_ITEMS)) {
    try {
      let parsed;
      try {
        parsed = await parseViaApi(candidate.title);
      } catch {
        parsed = await parseViaHtml(candidate);
      }

      const season = extractSeason(parsed.title);
      const manufacturer = extractMaker(parsed.title, parsed.categories);
      const sport = "baseball";
      const product = extractProduct(parsed.title, manufacturer, sport);

      items.push(saveItem({
        url: parsed.url,
        title: parsed.title,
        sport,
        season,
        manufacturer,
        product,
        categories: parsed.categories,
        sourceRevision: parsed.sourceRevision,
        checklist: parsed.checklist,
      }));
    } catch (error) {
      failures.push({ title: candidate.title, url: candidate.url, error: String(error) });
    }
  }

  finishSource({ items, failures, discoveryFailures, discovered: candidates.length });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
