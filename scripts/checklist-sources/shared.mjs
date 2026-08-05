import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

export const SOURCE = String(process.env.CHECKLIST_SOURCE || "").trim().toLowerCase();
export const ROOT = resolve(process.cwd(), process.env.CHECKLIST_OUTPUT_ROOT || `.public-checklist-source-archive/${SOURCE}`);
export const ITEMS = resolve(ROOT, "items");
export const MAX_ITEMS = Number(process.env.CHECKLIST_MAX_ITEMS || 10000);
export const MAX_DISCOVERY_PAGES = Number(process.env.CHECKLIST_MAX_DISCOVERY_PAGES || 500);
export const MAX_DOWNLOAD_BYTES = Number(process.env.CHECKLIST_MAX_DOWNLOAD_BYTES || 50_000_000);
export const UA = "Mozilla/5.0 (compatible; TCOS-Public-Checklist-Collector/1.0; public factual checklist archive)";

const MAKERS = [
  "Panini America", "Panini", "Topps", "Upper Deck", "Fleer", "Donruss", "Score", "Leaf",
  "Bowman", "Pinnacle", "Pacific", "Playoff", "O-Pee-Chee", "Parkhurst", "Pro Set", "SkyBox",
  "Star", "Press Pass", "SAGE", "Wild Card", "Classic", "Sportflics", "Hostess", "Kellogg's",
  "Post", "Exhibit", "Goudey", "Allen & Ginter", "Goodwin", "Philadelphia", "Merlin", "Select",
];

const SPORTS = [
  ["baseball", /\b(baseball|mlb)\b/i],
  ["basketball", /\b(basketball|nba|wnba)\b/i],
  ["football", /\b(football|nfl|xfl|usfl)\b/i],
  ["hockey", /\b(hockey|nhl)\b/i],
  ["soccer", /\b(soccer|fifa|uefa|world cup|premier league)\b/i],
  ["racing", /\b(racing|nascar|indycar|formula one|formula 1|f1)\b/i],
  ["wrestling", /\b(wrestling|wwe|aew|mlw)\b/i],
  ["mma", /\b(mma|ufc|pfl|mixed martial arts)\b/i],
  ["boxing", /\bboxing\b/i],
  ["golf", /\b(golf|pga|lpga)\b/i],
  ["tennis", /\btennis\b/i],
];

export function slug(value, max = 160) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, max) || "unknown";
}

export function decodeHtml(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|tr|div|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&#039;|&apos;|&rsquo;|&#8217;/gi, "'")
    .replace(/&ndash;|&#8211;|&mdash;|&#8212;/gi, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function stripWiki(input) {
  return String(input || "")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/<ref[^>]*>[^]*?<\/ref>/gi, " ")
    .replace(/<ref[^/>]*\/>/gi, " ")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[(https?:\/\/\S+)\s+([^\]]+)\]/g, "$2")
    .replace(/'{2,5}/g, "")
    .replace(/^\s*[#*:;]+\s?/gm, "")
    .replace(/==+\s*(.*?)\s*==+/g, "\n$1\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchResponse(url, accept = "text/html,application/xhtml+xml,application/json,application/xml,text/xml,*/*") {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response;
}

export async function fetchText(url, accept) {
  const response = await fetchResponse(url, accept);
  return { text: await response.text(), finalUrl: response.url, headers: response.headers };
}

export async function fetchJson(url) {
  return JSON.parse((await fetchText(url, "application/json,*/*")).text);
}

export function titleFromHtml(html, fallback) {
  return decodeHtml(
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      || fallback,
  ).replace(/\s*[-|]\s*(?:BaseballCardPedia|KeyMan Collectibles|Sports Card Radio).*$/i, "").trim();
}

export function extractSeason(title) {
  const range = String(title).match(/\b((?:18|19|20)\d{2})\s*[-–—\/]\s*((?:18|19|20)?\d{2})\b/);
  if (range) return `${range[1]}-${range[2].length === 2 ? range[2] : range[2].slice(2)}`;
  return String(title).match(/\b((?:18|19|20)\d{2})\b/)?.[1] || null;
}

export function extractMaker(title, categories = [], url = "") {
  const haystack = `${title}\n${categories.join("\n")}\n${url}`;
  for (const maker of MAKERS) {
    const escaped = maker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(haystack)) return maker === "Panini America" ? "Panini" : maker;
  }
  return categories.find((value) => /^(?:Topps|Upper Deck|Fleer|Donruss|Score|Leaf|Bowman|Pinnacle|Pacific|Playoff|O-Pee-Chee|Parkhurst|Pro Set|SkyBox|Star)$/i.test(value)) || null;
}

export function extractSport(title, categories = [], fallback = null) {
  const haystack = `${title}\n${categories.join("\n")}`;
  const matches = SPORTS.filter(([, pattern]) => pattern.test(haystack)).map(([sport]) => sport);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return "multi-sport";
  return fallback;
}

export function extractProduct(title, maker, sport) {
  const escapedMaker = String(maker || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSport = String(sport || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let product = String(title)
    .replace(/\s*[-|]\s*(?:BaseballCardPedia|KeyMan Collectibles|Sports Card Radio).*$/i, "")
    .replace(/\b(?:18|19|20)\d{2}\s*[-–—\/]\s*(?:18|19|20)?\d{2}\b/g, " ")
    .replace(/\b(?:18|19|20)\d{2}\b/g, " ")
    .replace(new RegExp(`\\b${escapedMaker}\\b`, "ig"), " ")
    .replace(new RegExp(`\\b${escapedSport}\\b`, "ig"), " ")
    .replace(/\b(?:baseball|basketball|football|hockey|soccer|racing|wrestling|mma|boxing|golf|tennis|cards?|checklists?|complete|printable|set information|release date|guide|review)\b/gi, " ")
    .replace(/[,:|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!product && maker) product = maker;
  return product || null;
}

export function countChecklistRows(text) {
  return String(text).split(/\n/).filter((line) => /^\s*(?:[A-Z]{0,8}[- ]?)?\d{1,5}[A-Z]?(?:[- ]|\.|\)|\t|\|)/.test(line)).length;
}

export function trimFooter(text) {
  const markers = [
    "Shop Boxes", "Shop Cards", "Related Topics", "Site search", "Important Links", "Subscribe to the Newsletter",
    "Hot Off the Presses", "Written by", "Previous ", "Next ", "© Copyright", "KeyManCollectibles.com",
    "Retrieved from", "Categories:", "This page was last edited",
  ];
  let end = text.length;
  for (const marker of markers) {
    const index = text.indexOf(`\n${marker}`, 300);
    if (index >= 0 && index < end) end = index;
  }
  return text.slice(0, end).replace(/\n{3,}/g, "\n\n").trim();
}

export function extractChecklistFromHtml(html) {
  const headings = [...String(html).matchAll(/<h([1-6])[^>]*>[\s\S]{0,500}?(?:checklist|base set|base cards)[\s\S]{0,200}?<\/h\1>/gi)];
  if (headings.length) {
    const text = trimFooter(decodeHtml(String(html).slice(headings[0].index)));
    if (countChecklistRows(text) >= 3 || /\bchecklist\b/i.test(text.slice(0, 400))) return text;
  }
  const plain = decodeHtml(html);
  const marker = plain.search(/(?:^|\n)(?:complete\s+)?(?:baseball\s+card\s+)?checklist(?:\s+index)?\b/i);
  if (marker >= 0) {
    const text = trimFooter(plain.slice(marker));
    if (countChecklistRows(text) >= 3) return text;
  }
  return "";
}

export function extractChecklistFromWiki(wikitext) {
  const match = String(wikitext).match(/^==\s*Checklist\s*==\s*$([\s\S]*?)(?=^==[^=]|\z)/im);
  return match ? trimFooter(stripWiki(match[1])) : "";
}

export function normalizeUrl(value, origin) {
  try {
    const url = new URL(String(value).replace(/&amp;/gi, "&"), origin);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function hrefs(html, base) {
  const out = new Set();
  for (const match of String(html).matchAll(/href=["']([^"'#]+)["']/gi)) {
    const url = normalizeUrl(match[1], base);
    if (url) out.add(url);
  }
  return [...out];
}

export function fileLinks(html, base) {
  return hrefs(html, base).filter((url) => /\.(?:pdf|xlsx?|csv|tsv|html?)(?:\?|$)/i.test(url));
}

export function xmlLocs(xml) {
  return [...String(xml).matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) => decodeHtml(match[1]).trim()).filter(Boolean);
}

export function saveItem(item, downloads = []) {
  const id = item.id || `${createHash("sha256").update(item.url).digest("hex").slice(0, 12)}--${slug(item.title, 140)}`;
  const dir = resolve(ITEMS, id);
  mkdirSync(dir, { recursive: true });
  const files = [];
  if (item.checklist) {
    const payload = `${item.checklist.trim()}\n`;
    writeFileSync(resolve(dir, "checklist.txt"), payload);
    files.push({ name: "checklist.txt", role: "checklist-text", bytes: Buffer.byteLength(payload), sha256: createHash("sha256").update(payload).digest("hex") });
  }
  for (const download of downloads) {
    writeFileSync(resolve(dir, download.name), download.bytes);
    files.push({ name: download.name, role: "source-download", sourceUrl: download.url, bytes: download.bytes.length, sha256: createHash("sha256").update(download.bytes).digest("hex") });
  }
  const metadata = {
    schema: "tcos.publicChecklistSourceItem.v1",
    id,
    source: SOURCE,
    sourceUrl: item.url,
    title: item.title,
    sport: item.sport || null,
    season: item.season || null,
    manufacturer: item.manufacturer || null,
    product: item.product || null,
    sourceRevision: item.sourceRevision || null,
    sourceCategories: item.categories || [],
    status: item.checklist ? "checklist-saved" : "set-index-only",
    checklistRows: item.checklist ? countChecklistRows(item.checklist) : 0,
    retrievedAt: new Date().toISOString(),
    files,
    policy: "Public pages only. Factual checklist/set data is archived with source attribution; no login, paywall, CAPTCHA, or access-control bypass.",
  };
  writeFileSync(resolve(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

export async function downloadPublicFiles(urls, allowedHosts) {
  const out = [];
  for (const url of [...new Set(urls)]) {
    try {
      const parsed = new URL(url);
      if (!allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) continue;
      const response = await fetchResponse(url, "application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/html,*/*");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) continue;
      const extension = (basename(new URL(response.url).pathname).match(/\.(pdf|xlsx?|csv|tsv|html?)$/i)?.[0] || ".bin").toLowerCase();
      const name = `${String(out.length + 1).padStart(3, "0")}--${slug(basename(new URL(response.url).pathname, extension), 120)}${extension}`;
      out.push({ url: response.url, name, bytes });
    } catch {
      // Page text remains the primary checklist record when an optional file fails.
    }
  }
  return out;
}

export function finishSource(result) {
  mkdirSync(ROOT, { recursive: true });
  const uniqueSetKeys = new Set(result.items.map((item) => [item.sport, item.season, item.manufacturer, item.product].map((value) => slug(value)).join("|")));
  const totals = {
    source: SOURCE,
    discoveredCandidates: result.discovered,
    archivedItems: result.items.length,
    checklistItems: result.items.filter((item) => item.status === "checklist-saved").length,
    setIndexOnlyItems: result.items.filter((item) => item.status === "set-index-only").length,
    uniqueExactSetKeys: uniqueSetKeys.size,
    unresolvedSport: result.items.filter((item) => !item.sport).length,
    unresolvedSeason: result.items.filter((item) => !item.season).length,
    unresolvedManufacturer: result.items.filter((item) => !item.manufacturer).length,
    unresolvedProduct: result.items.filter((item) => !item.product).length,
    failures: result.failures.length,
    discoveryFailures: result.discoveryFailures.length,
  };
  const manifest = {
    schema: "tcos.publicChecklistSourceArchive.v1",
    source: SOURCE,
    generatedAt: new Date().toISOString(),
    policy: "Public pages only. No authentication, paywall, CAPTCHA, rate-limit, or access-control bypass.",
    totals,
    items: result.items,
    failures: result.failures,
    discoveryFailures: result.discoveryFailures,
  };
  writeFileSync(resolve(ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(ROOT, "README.txt"), [
    `TCOS public checklist source archive: ${SOURCE}`,
    "",
    "Every item has metadata.json. Extractable factual checklists are checklist.txt; public source downloads are retained when available.",
    "Uncertain sport/year/manufacturer/product values remain null for fail-closed sorting.",
    "",
    JSON.stringify(totals, null, 2),
    "",
  ].join("\n"));
  console.log(JSON.stringify(totals));
  if (!result.items.length) process.exitCode = 1;
}
