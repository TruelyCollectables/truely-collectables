import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.env.EXHAUSTIVE_CHECKLIST_ROOT || ".checklist-discovery/exhaustive-hockey-wnba");
const OUT = resolve(ROOT, "targets.json");
const CENSUS = resolve(ROOT, "census.json");
const BASE = "https://gogts.net";
const UA = "TCOS-Exhaustive-Checklist-Census/1.0 (+private Registry automation; contact sales@truelycollectables.com)";

function decode(value) {
  const named = { amp: "&", apos: "'", quot: '"', nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, entity) => {
    if (/^#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()] ?? whole;
  }).replace(/\s+/g, " ").trim();
}
function slug(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
async function fetchText(url, accept = "text/html,application/xml,text/xml,application/json") {
  const response = await fetch(url, { headers: { Accept: accept, "User-Agent": UA, "Cache-Control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
  return { text: await response.text(), headers: response.headers, finalUrl: response.url || url };
}
function locs(xml) {
  return [...String(xml || "").matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((m) => decode(m[1]));
}
async function sitemapUrls() {
  const urls = new Set();
  try {
    const index = await fetchText(`${BASE}/wp-sitemap.xml`);
    const maps = locs(index.text).filter((u) => /wp-sitemap-posts-(?:post|page)-\d+\.xml/i.test(u));
    for (const map of maps) {
      try {
        const page = await fetchText(map);
        for (const url of locs(page.text)) urls.add(url);
      } catch (error) {
        console.warn(`Sitemap failed ${map}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.warn(`Sitemap index failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return urls;
}
async function wpSearch(term) {
  const found = new Set();
  for (let page = 1; page <= 20; page += 1) {
    const url = `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(term)}&subtype=post&per_page=100&page=${page}`;
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (response.status === 400 || response.status === 404) break;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) break;
      for (const row of rows) if (row?.url) found.add(row.url);
      if (rows.length < 100) break;
    } catch (error) {
      console.warn(`WP search ${term} page ${page} failed: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }
  return found;
}
function titleFromHtml(html) {
  const h1 = String(html || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const raw = h1 || String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return decode(raw.replace(/<[^>]+>/g, " ").replace(/\s*[|–—-]\s*Go GTS.*$/i, ""));
}
function releaseToken(title) {
  const season = title.match(/\b(20\d{2}-\d{2})\b/)?.[1] || null;
  if (season) return season;
  const year = Number(title.match(/\b(20\d{2})\b/)?.[1] || 0);
  return year ? String(year) : null;
}
function requested(title) {
  if (!/checklist/i.test(title)) return false;
  const token = releaseToken(title);
  if (!token) return false;
  const start = Number(token.slice(0, 4));
  const hockey = /\b(?:hockey|nhl|pwhl|ahl|chl)\b/i.test(title) && start >= 2021;
  const wnba = /\bwnba\b/i.test(title) && start >= 2024;
  return hockey || wnba;
}
function manufacturerFor(title) {
  if (/\bUpper Deck\b/i.test(title)) return "upper-deck";
  if (/\bPanini\b/i.test(title)) return "panini";
  if (/\bLeaf\b/i.test(title)) return "leaf";
  if (/\bTopps\b/i.test(title)) return "topps";
  if (/\bIn The Game\b/i.test(title)) return "in-the-game";
  if (/\bPresident'?s Choice\b/i.test(title)) return "presidents-choice";
  if (/\b(?:O-Pee-Chee|SPx|SP Authentic|SP Game[- ]Used|Trilogy|Artifacts|Allure|Black Diamond|Credentials|Clear Cut|Extended Series|Series (?:One|Two|1|2)|MVP|Ice|Premier|Ultimate Collection|Engrained|Parkhurst|Metal Universe|PWHL|AHL|CHL)\b/i.test(title)) return "upper-deck";
  return "other";
}
function productFor(title, token, manufacturer, isWnba) {
  let value = title;
  value = value.replace(new RegExp(`\\b${token.replace("-", "[-–—]")}\\b`, "i"), " ");
  value = value.replace(/\b(?:Upper Deck|Panini|Leaf|Topps|In The Game|President'?s Choice)\b/gi, " ");
  value = value.replace(/\b(?:Trading\s+)?Cards?\s+Checklist\b/gi, " ");
  value = value.replace(/\bChecklist\b/gi, " ");
  value = value.replace(/\bBasketball\b/gi, " ");
  value = value.replace(/\bHockey\b/gi, " ");
  value = value.replace(/\bWNBA\b/gi, " ");
  const hasNhl = /\bNHL\b/i.test(value) || /\bNHL\b/i.test(title);
  value = value.replace(/\bNHL\b/gi, " ");
  let product = slug(value) || "checklist";
  if (isWnba && !product.endsWith("wnba")) product += "-wnba";
  else if (hasNhl && !product.endsWith("nhl")) product += "-nhl";
  return product;
}
function attachmentCandidates(html, baseUrl) {
  const rows = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const label = decode(match[2].replace(/<[^>]+>/g, " "));
      const url = new URL(decode(match[1]), baseUrl).toString();
      if (!/\.(?:pdf|xlsx|xls|csv)(?:$|[?#])/i.test(url) && !/\b(?:pdf|excel|xlsx|xls|spreadsheet|checklist)\b/i.test(label)) continue;
      let score = 0;
      if (/\.pdf(?:$|[?#])/i.test(url)) score += 50;
      if (/\.xlsx?(?:$|[?#])/i.test(url)) score += 40;
      if (/checklist/i.test(label)) score += 25;
      if (/complete|full/i.test(label)) score += 10;
      rows.push({ url, label, score });
    } catch { /* ignore */ }
  }
  return rows.sort((a, b) => b.score - a.score).filter((row, i, all) => all.findIndex((x) => x.url === row.url) === i);
}
async function mapLimit(values, limit, worker) {
  const out = new Array(values.length); let cursor = 0;
  async function runner() { while (true) { const i = cursor++; if (i >= values.length) return; out[i] = await worker(values[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, runner));
  return out;
}

mkdirSync(ROOT, { recursive: true });
const all = await sitemapUrls();
for (const term of ["Hockey Cards Checklist", "NHL Hockey Cards Checklist", "PWHL Cards Checklist", "WNBA Basketball Cards Checklist", "WNBA Cards Checklist"]) {
  for (const url of await wpSearch(term)) all.add(url);
}
const likely = [...all].filter((url) => /checklist/i.test(url) && /(?:hockey|nhl|pwhl|ahl|chl|wnba)/i.test(url));
console.log(`Candidate checklist pages: ${likely.length}`);
const inspected = (await mapLimit(likely, 10, async (pageUrl) => {
  try {
    const page = await fetchText(pageUrl);
    const title = titleFromHtml(page.text);
    if (!requested(title)) return null;
    const token = releaseToken(title);
    const isWnba = /\bwnba\b/i.test(title);
    const sport = isWnba ? "basketball" : "hockey";
    const manufacturer = manufacturerFor(title);
    const product = productFor(title, token, manufacturer, isWnba);
    const links = attachmentCandidates(page.text, page.finalUrl);
    const sourceUrl = links[0]?.url || page.finalUrl;
    const fallbackUrls = [page.finalUrl, ...links.slice(1, 5).map((row) => row.url)].filter((url, i, values) => url !== sourceUrl && values.indexOf(url) === i);
    const startYear = Number(token.slice(0, 4));
    return {
      exactSetKey: `${sport}|${token}|${manufacturer}|${product}`,
      year: startYear,
      sourceUrl,
      fallbackUrls,
      pageUrl: page.finalUrl,
      title,
      manufacturer,
      product,
      attachmentCount: links.length,
    };
  } catch (error) {
    return { pageUrl, error: error instanceof Error ? error.message : String(error) };
  }
})).filter(Boolean);

const requestedRows = inspected.filter((row) => row.exactSetKey);
const errors = inspected.filter((row) => !row.exactSetKey);
const byKey = new Map();
for (const row of requestedRows) {
  const existing = byKey.get(row.exactSetKey);
  if (!existing || row.attachmentCount > existing.attachmentCount) byKey.set(row.exactSetKey, row);
}
const targets = [...byKey.values()].sort((a, b) => a.exactSetKey.localeCompare(b.exactSetKey));
const hockey = targets.filter((row) => row.exactSetKey.startsWith("hockey|"));
const wnba = targets.filter((row) => row.exactSetKey.startsWith("basketball|"));
const seasonCounts = {};
for (const row of targets) seasonCounts[row.exactSetKey.split("|")[1]] = (seasonCounts[row.exactSetKey.split("|")[1]] || 0) + 1;
const census = {
  schema: "tcos.checklist.exhaustiveCensus.v1",
  generatedAt: new Date().toISOString(),
  scope: { hockey: "2021-22 and newer, including calendar-year hockey products", wnba: "2024 and newer" },
  discoveredSiteUrls: all.size,
  likelyChecklistPages: likely.length,
  requestedPageMatches: requestedRows.length,
  uniqueTargets: targets.length,
  hockeyTargets: hockey.length,
  wnbaTargets: wnba.length,
  seasonCounts,
  targets,
  inspectionErrors: errors.slice(0, 100),
};
writeFileSync(OUT, JSON.stringify(targets.map(({ exactSetKey, year, sourceUrl, fallbackUrls }) => ({ exactSetKey, year, sourceUrl, fallbackUrls })), null, 2) + "\n");
writeFileSync(CENSUS, JSON.stringify(census, null, 2) + "\n");
console.log(JSON.stringify({ uniqueTargets: targets.length, hockeyTargets: hockey.length, wnbaTargets: wnba.length, seasonCounts }, null, 2));
if (!hockey.length || !wnba.length) process.exitCode = 2;
