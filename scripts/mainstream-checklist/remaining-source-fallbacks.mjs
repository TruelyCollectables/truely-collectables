const nativeFetch = globalThis.fetch.bind(globalThis);

// These sources were proven to expose too few deterministic rows in production.
// Every replacement is for the exact same release. TCDB URLs are intentionally
// routed through tcdb-complete-fetch.mjs first, so all pages and related sets must
// pass exact declared-count reconciliation before this response can reach the parser.
const COMPLETE_SOURCE_REPLACEMENTS = new Map([
  ["https://www.sportscardspro.com/game/baseball-cards-2003-fleer-mystique", "https://www.tcdb.com/ViewSet.cfm/sid/1623/2003-Fleer-Mystique"],
  ["https://www.sportscardspro.com/game/football-cards-2003-leaf-limited", "https://www.tcdb.com/ViewSet.cfm/sid/4609/2003-Leaf-Limited"],
  ["https://www.sportscardspro.com/game/football-cards-2006-upper-deck-sweet-spot", "https://www.tcdb.com/ViewSet.cfm/sid/4774/2006-Upper-Deck-Sweet-Spot"],
  ["https://www.sportscardspro.com/game/football-cards-2009-upper-deck-philadelphia", "https://www.tcdb.com/ViewSet.cfm/sid/9430/2009-Philadelphia"],

  ["https://www.sportscardradio.com/2009-10-panini-classics-basketball-box-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/9958/2009-10-Panini-Classics"],
  ["https://www.sportscardradio.com/2009-10-panini-timeless-treasures-basketball-box-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/10014/2009-10-Panini-Timeless-Treasures"],
  ["https://www.sportscardradio.com/2011-upper-deck-all-time-greats-basketball-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/57798/2011-Upper-Deck-All-Time-Greats"],
  ["https://www.sportscardradio.com/2010-leaf-mma-trading-cards-ufc-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/72063/2010-Leaf-MMA"],

  ["https://www.psacard.com/psasetregistry/basketball/company-sets/2012-panini-kobe-anthology/composition/4713", "https://www.tcdb.com/ViewSet.cfm/sid/79183/2012-13-Panini-Kobe-Anthology"],

  ["https://www.cardboardconnection.com/2009-topps-updates-highlights-baseball", "https://www.tcdb.com/ViewSet.cfm/sid/9594/2009-Topps-Updates-%26-Highlights"],
  ["https://www.cardboardconnection.com/2012-topps-update-series-baseball", "https://www.tcdb.com/ViewSet.cfm/sid/72426/2012-Topps-Update"],
  ["https://www.cardboardconnection.com/2014-topps-heritage-baseball-cards", "https://www.tcdb.com/ViewSet.cfm/sid/84424/2014-Topps-Heritage"],
  ["https://www.cardboardconnection.com/2014-topps-update-baseball-cards", "https://www.tcdb.com/ViewSet.cfm/sid/94826/2014-Topps-Update"],
  ["https://www.cardboardconnection.com/2015-topps-heritage-baseball", "https://www.tcdb.com/ViewSet.cfm/sid/97895/2015-Topps-Heritage"],
  ["https://www.cardboardconnection.com/2016-topps-heritage-baseball-cards", "https://www.tcdb.com/ViewSet.cfm/sid/116351/2016-Topps-Heritage"],

  ["https://www.beckett.com/news/2024-panini-gold-standard-football-cards/", "https://www.tcdb.com/ViewSet.cfm/sid/449072/2024-Panini-Gold-Standard"],
  ["https://www.beckett.com/news/2023-24-donruss-optic-basketball-cards/", "https://www.tcdb.com/ViewSet.cfm/sid/415872/2023-24-Donruss-Optic"],
  ["https://www.beckett.com/news/2024-panini-prizm-football-cards/", "https://www.tcdb.com/ViewSet.cfm/sid/469503/2024-Panini-Prizm"],
  ["https://www.beckett.com/news/2024-bowman-chrome-baseball-cards/", "https://www.tcdb.com/ViewSet.cfm/sid/449989/2024-Bowman-Chrome"],
  ["https://www.beckett.com/news/2025-topps-chrome-black-baseball-cards/", "https://www.tcdb.com/ViewSet.cfm/sid/503092/2025-Topps-Chrome-Black"],
  ["https://www.beckett.com/news/2024-score-football-cards/", "https://www.tcdb.com/ViewSet.cfm/sid/438365/2024-Score"],

  ["https://www.topps.com/pages/topps-uefa-club-competitions", "https://www.tcdb.com/ViewSet.cfm/sid/467821/2024-25-Topps-UEFA-Club-Competitions"],
  ["https://www.topps.com/pages/series-1", "https://www.tcdb.com/ViewSet.cfm/sid/585448/2026-Topps"],
]);

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

async function fetchReplacement(url, init) {
  try {
    const response = await nativeFetch(url, init);
    if (response.ok) return response;
  } catch {
    // The original source remains available as a fail-closed fallback path.
  }
  return null;
}

globalThis.fetch = async function remainingSourceFallbackFetch(input, init = {}) {
  const originalUrl = requestUrl(input);
  const replacement = COMPLETE_SOURCE_REPLACEMENTS.get(originalUrl);
  if (replacement) {
    const response = await fetchReplacement(replacement, init);
    if (response) return response;
  }
  return nativeFetch(input, init);
};

export { COMPLETE_SOURCE_REPLACEMENTS };
