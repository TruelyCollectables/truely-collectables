const nativeFetch = globalThis.fetch.bind(globalThis);

// Exact public replacements for legacy URLs that repeatedly fail from GitHub
// runners or return a dynamic shell without deterministic checklist rows. These
// remain reference fallbacks only: every row still passes the normal parser,
// conflict checks, minimum-row contract, archive and Registry validation.
const VERIFIED_SOURCE_FALLBACKS = new Map([
  ["https://www.sportscardradio.com/2011-panini-gridiron-gear-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/59899/2011-Panini-Gridiron-Gear"],
  ["https://www.sportscardradio.com/2010-11-upper-deck-black-diamond-hockey-checklist/", "https://www.cardboardconnection.com/2010-11-upper-deck-black-diamond-hockey"],
  ["https://www.sportscardradio.com/2010-panini-donruss-rated-rookie-rc-football-box-set/", "https://www.tcdb.com/ViewSet.cfm/sid/34067/2010-Donruss-Rated-Rookies"],
  ["https://www.sportscardradio.com/2010-topps-platinum-wwe-wrestling-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/67357/2010-Topps-Platinum-WWE"],
  ["https://www.sportscardradio.com/2011-topps-mlb-baseball-sticker-collection-checklist/", "https://baseballcardpedia.com/index.php/2011_Topps_Stickers"],
  ["https://www.sportscardradio.com/2011-panini-limited-football-checklist/", "https://www.tcdb.com/Checklist.cfm/sid/60398/2011-Panini-Limited"],
  ["https://www.sportscardradio.com/2003-upper-deck-sp-authentic-football-box-checklist/", "https://www.tcdb.com/Checklist.cfm/sid/4622/2003-SP-Authentic"],
  ["https://www.sportscardradio.com/2010-panini-adrenalyn-xl-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/61988/2010-Panini-Adrenalyn-XL"],
  ["https://www.sportscardradio.com/2010-topps-attax-nfl-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/63488/2010-Topps-Attax"],
  ["https://www.sportscardradio.com/2010-topps-wwe-slam-attax-mayhem-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/67359/2010-Topps-Slam-Attax-WWE-Mayhem"],
  ["https://www.sportscardradio.com/2011-topps-update-series-baseball-checklist/", "https://baseballcardpedia.com/index.php/2011_Topps_Update"],
  ["https://www.sportscardradio.com/2011-panini-plates-a-patches-football-checklist/", "https://www.tcdb.com/Checklist.cfm/sid/61503/2011-Panini-Plates-%26-Patches"],
  ["https://www.baseballcardpedia.com/index.php/2010_Topps_Sterling", "https://www.tcdb.com/ViewSet.cfm/sid/22006/2010-Topps-Sterling"],
  ["https://www.sportscardradio.com/2011-panini-prime-signatures-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/62692/2011-Panini-Prime-Signatures"],
  ["https://www.sportscardradio.com/2011-topps-wwe-classic-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/60180/2011-Topps-WWE-Classic"],
  ["https://www.sportscardradio.com/2010-panini-classics-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/10101/2010-Panini-Classics"],
  ["https://www.sportscardradio.com/2010-topps-finest-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/10358/2010-Finest"],
  ["https://www.sportscardradio.com/2010-11-score-rookie-a-traded-hockey-checklist/", "https://www.comc.com/Cards/Hockey/2010-11/Score_Rookies__Traded_-_Base%2CvText"],
  ["https://www.sportscardradio.com/2011-leaf-metal-draft-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/56530/2011-Leaf-Metal-Draft"],
  ["https://www.sportscardradio.com/2011-panini-rookies-and-stars-longevity-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/59901/2011-PaniniRookies%26StarsLongevity"],
  ["https://www.sportscardradio.com/2010-11-panini-elite-black-box-basketball-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/58060/2010-11-Panini-Elite-Black-Box"],
  ["https://www.sportscardradio.com/2010-topps-5-five-star-football-box-checklist/", "https://www.tcdb.com/Checklist.cfm/sid/48390/2010-Topps-Five-Star"],
  ["https://www.sportscardradio.com/2010-11-upper-deck-ud-hockey-series-2-checklist/", "https://www.cardboardconnection.com/2010-11-upper-deck-series-2-hockey"],
  ["https://www.sportscardradio.com/2011-panini-adrenalyn-nfl-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/61908/2011-Panini-Adrenalyn-XL"],
  ["https://www.sportscardradio.com/2011-panini-contenders-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/61902/2011-Playoff-Contenders"],
  ["https://www.sportscardradio.com/2010-11-panini-prestige-basketball-box-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/10407/2010-11-Panini-Prestige"],
  ["https://www.sportscardradio.com/2011-panini-certified-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/59800/2011-Panini-Certified"],
  ["https://www.sportscardradio.com/2011-topps-prime-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/58176/2011-Topps-Prime"],
  ["https://www.sportscardradio.com/10-11-panini-threads-basketball-box-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/25445/2010-11-Panini-Threads"],
  ["https://www.sportscardradio.com/2010-panini-plates-a-patches-football-box-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/48165/2010-Panini-Plates-%26-Patches"],
  ["https://www.sportscardradio.com/2011-playoff-prime-cuts-baseball-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/72871/2011-Panini-Prime-Cuts"],
  ["https://www.sportscardradio.com/2011-panini-crown-royale-football-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/59550/2011-Panini-Crown-Royale"],

  ["https://www.beckett.com/baseball/2000/sp-authentic/", "https://www.tcdb.com/ViewSet.cfm/sid/1407/2000-SP-Authentic"],
  ["https://www.beckett.com/baseball/2001/sp-authentic/", "https://www.tcdb.com/ViewSet.cfm/sid/1478/2001-SP-Authentic"],
  ["https://www.beckett.com/baseball/2002/sp-authentic/", "https://www.tcdb.com/ViewSet.cfm/sid/1559/2002-SP-Authentic"],
  ["https://www.beckett.com/baseball/2003/sp-authentic/", "https://www.tcdb.com/ViewSet.cfm/sid/1637/2003-SP-Authentic"],
  ["https://www.beckett.com/baseball/2005/sp-authentic/", "https://www.baseballcardpedia.com/index.php/2005_SP_Authentic"],
  ["https://www.beckett.com/baseball/2006/sp-authentic/", "https://www.tcdb.com/ViewSet.cfm/sid/1927/2006-SP-Authentic"],
  ["https://www.keymancollectibles.com/baseballcards/upperdeck/2004spbaseballcardchecklist.htm", "https://www.tcdb.com/ViewSet.cfm/sid/1722/2004-SP-Authentic"],
  ["https://www.keymancollectibles.com/baseballcards/upperdeck/2007spbaseballcardchecklist.htm", "https://www.tcdb.com/ViewSet.cfm/sid/6587/2007-SP-Authentic"],
  ["https://www.beckett.com/football/2011/upper-deck/", "https://www.tcdb.com/ViewSet.cfm/sid/56581/2011-Upper-Deck"],
  ["https://www.beckett.com/wrestling/2011/topps-wwe/", "https://www.tcdb.com/ViewSet.cfm/sid/58098/2011-Topps-WWE"],
  ["https://gogts.net/2024-donruss-nfl-football-cards-checklist/", "https://www.tcdb.com/ViewSet.cfm/sid/462124/2024-Donruss"],
]);

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url || String(input || "");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isSectionLabel(value) {
  const text = stripTags(value);
  if (!text || text.length > 180 || /^#?\s*[A-Z]{0,10}-?\d{1,4}\b/.test(text)) {
    return false;
  }
  return /(?:checklist|base set|base cards|autographs?|signatures?|relics?|memorabilia|patches?|inserts?|parallels?|variations?|short prints?|rookies?|prospects?)/i.test(text);
}

function headingRow(level, body) {
  return `<tr data-tcos-heading="${level}"><td>## ${body}</td></tr>`;
}

function checklistHeadingBody(body) {
  const text = stripTags(body);
  if (/^cards$/i.test(text)) return "Base Set Checklist";
  return body;
}

export function transformChecklistHtml(html) {
  let value = String(html || "");

  value = value.replace(
    /<(?:p|div|section)\b[^>]*>\s*<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>\s*<\/(?:p|div|section)>/gi,
    (whole, body) => (isSectionLabel(body) ? headingRow(3, body) : whole),
  );

  value = value.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (whole, level, body) => headingRow(level, checklistHeadingBody(body)),
  );

  value = value.replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi, (whole, attributes, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cells.length !== 1 || !isSectionLabel(cells[0][1])) return whole;
    const text = stripTags(cells[0][1]);
    if (text.startsWith("## ")) return whole;
    return headingRow(4, cells[0][1]);
  });

  return value;
}

export function transformReaderText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => {
      const normalized = line.replace(/^\s*#{1,6}\s+/, "## ");
      if (/^##\s+Cards\s*$/i.test(normalized)) return "## Base Set Checklist";
      if (normalized.startsWith("## ")) return normalized;
      return isSectionLabel(normalized) && !normalized.includes("|")
        ? `## ${normalized.trim()}`
        : normalized;
    })
    .join("\n");
}

function proxyUrl(originalUrl) {
  try {
    const parsed = new URL(originalUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (parsed.hostname === "r.jina.ai") return null;
    return `https://r.jina.ai/${parsed.toString()}`;
  } catch {
    return null;
  }
}

async function transformedResponse(response, { reader = false } = {}) {
  const mime = String(response.headers.get("content-type") || "").toLowerCase();
  const isHtml = mime.includes("text/html") || mime.includes("application/xhtml+xml");
  const isText = reader || mime.includes("text/plain") || mime.includes("text/markdown");
  if (!response.ok || (!isHtml && !isText)) return response;

  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (isHtml && !reader) {
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(transformChecklistHtml(body), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(transformReaderText(body), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function proxyInit(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "text/plain,text/markdown;q=0.9,*/*;q=0.1");
  return {
    ...init,
    headers,
    signal: AbortSignal.timeout(90_000),
  };
}

async function tryReader(url, init) {
  const readerUrl = proxyUrl(url);
  if (!readerUrl) return null;
  try {
    const response = await nativeFetch(readerUrl, proxyInit(init));
    if (response.ok) return transformedResponse(response, { reader: true });
  } catch {
    // Caller continues to the next verified source.
  }
  return null;
}

async function tryDirect(url, init) {
  try {
    const response = await nativeFetch(url, init);
    if (response.ok) return transformedResponse(response);
  } catch {
    // Caller continues to reader/fallback.
  }
  return null;
}

globalThis.fetch = async function patchedChecklistFetch(input, init = {}) {
  const originalUrl = requestUrl(input);
  const fallbackUrl = VERIFIED_SOURCE_FALLBACKS.get(originalUrl);

  // For explicitly verified replacements, use the deterministic public source
  // first. This also repairs sources that return HTTP 200 but only expose a
  // client-rendered shell with no row-level checklist data.
  if (fallbackUrl) {
    const fallbackDirect = await tryDirect(fallbackUrl, init);
    if (fallbackDirect) return fallbackDirect;
    const fallbackReader = await tryReader(fallbackUrl, init);
    if (fallbackReader) return fallbackReader;
  }

  let directResponse = null;
  let directError = null;
  try {
    directResponse = await nativeFetch(input, init);
    if (directResponse.ok) return transformedResponse(directResponse);
  } catch (error) {
    directError = error;
  }

  const reader = await tryReader(originalUrl, init);
  if (reader) return reader;

  if (directResponse) return directResponse;
  throw directError || new Error(`Checklist source fetch failed: ${originalUrl}`);
};
