#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const policyPath = resolve(process.env.VACUUM_POLICY || 'ops/checklists/ultimate-vacuum-source-policy-20260815.json');
const outPath = resolve(process.env.VACUUM_DISCOVERY_OUTPUT || 'tmp/ultimate-vacuum-discovery.json');
const eventsPath = resolve(process.env.VACUUM_EVENTS_OUTPUT || 'tmp/ultimate-vacuum-events.ndjson');
const shardIndex = Number(process.env.VACUUM_SHARD_INDEX || 0);
const shardCount = Math.max(1, Number(process.env.VACUUM_SHARD_COUNT || 1));
const maxPages = Math.max(1, Number(process.env.VACUUM_MAX_PAGES || 250));
const maxSitemapsPerHost = Math.max(1, Number(process.env.VACUUM_MAX_SITEMAPS_PER_HOST || 25));
const requestTimeoutMs = Math.max(1000, Number(process.env.VACUUM_REQUEST_TIMEOUT_MS || 12000));
const userAgent = 'TCOS Ultimate Vacuum Checklist Discovery/1.0';
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

const candidateMap = new Map();
const events = [];
const hostLastRequest = new Map();
const stats = { shardIndex, shardCount, hosts: 0, sitemapUrls: 0, pagesAttempted: 0, pagesOk: 0, assetsFound: 0, pageLeadsFound: 0, dead: 0, blocked: 0, rateLimited: 0, timeouts: 0 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanText = s => String(s || '').replace(/&amp;/g, '&');
function shardFor(value) {
  const h = createHash('sha1').update(String(value)).digest();
  return h.readUInt32BE(0) % shardCount;
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
function addEvent(url, outcome, detail = null, sourceFound = false) {
  events.push({ at: new Date().toISOString(), url, host: hostOf(url), outcome, detail, sourceFound });
}
function addCandidate(url, sourceId, kind, parentUrl = null, extra = {}) {
  try {
    const u = new URL(url);
    u.hash = '';
    const normalized = u.href;
    const key = `${kind}|${normalized}`;
    if (!candidateMap.has(key)) candidateMap.set(key, { url: normalized, host: u.hostname.toLowerCase(), sourceId, kind, parentUrl, ...extra });
  } catch {}
}
async function throttle(host, rps) {
  const gap = Math.max(0, 1000 / Math.max(0.1, Number(rps || 1)));
  const last = hostLastRequest.get(host) || 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  hostLastRequest.set(host, Date.now());
}
async function fetchText(url, source) {
  const host = hostOf(url);
  await throttle(host, source.maxRequestsPerSecondPerHost || policy.defaults?.maxRequestsPerSecondPerHost || 1);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': userAgent, accept: 'text/html,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5' } });
    clearTimeout(timer);
    const text = await r.text().catch(() => '');
    if (r.status === 404 || r.status === 410) { stats.dead++; addEvent(url, 'dead_url', `HTTP ${r.status}`); return { ok: false, status: r.status, text }; }
    if (r.status === 401 || r.status === 403) { stats.blocked++; addEvent(url, 'robots_blocked', `HTTP ${r.status}`); return { ok: false, status: r.status, text }; }
    if (r.status === 429) { stats.rateLimited++; addEvent(url, 'http_429', 'HTTP 429'); return { ok: false, status: r.status, text }; }
    if (!r.ok) { addEvent(url, 'bunk_content', `HTTP ${r.status}`); return { ok: false, status: r.status, text }; }
    return { ok: true, status: r.status, text, contentType: r.headers.get('content-type') || '' };
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') { stats.timeouts++; addEvent(url, 'timeout', 'request timeout'); }
    else addEvent(url, 'bunk_content', String(e?.message || e));
    return { ok: false, status: 0, text: '' };
  }
}
function xmlLocs(xml) {
  return [...String(xml || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m => cleanText(m[1].trim()));
}
function htmlLinks(html, base) {
  const out = new Set();
  for (const m of String(html || '').matchAll(/(?:href|data-href)=["']([^"']+)["']/gi)) {
    try { out.add(new URL(cleanText(m[1]), base).href); } catch {}
  }
  return [...out];
}
function looksLikeChecklistPage(url, html = '') {
  return /checklist|check-list|card-list|set-list|product-reviews/i.test(url) || /\bchecklist\b/i.test(String(html).slice(0, 200000));
}
function isAsset(url) { return /\.(?:xlsx?|csv|pdf)(?:\?|$)/i.test(url); }
function usefulPageLink(url, host) {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== host) return false;
    return /checklist|check-list|product-review|set-review|archive|cards|trading|sport|baseball|basketball|football|hockey|soccer|ufc|wwe/i.test(u.pathname + u.search);
  } catch { return false; }
}

for (const source of policy.sources || []) {
  if (source.mode === 'lead-only-public-pages' && source.id === 'beckett-public') continue;
  for (const configuredHost of source.hosts || []) {
    const host = String(configuredHost).toLowerCase();
    if (host.startsWith('www.') && (source.hosts || []).includes(host.slice(4))) continue;
    stats.hosts++;
    const schemeHost = `https://${host}`;
    const sitemapSeeds = new Set([`${schemeHost}/sitemap.xml`, `${schemeHost}/sitemap_index.xml`]);
    const robots = await fetchText(`${schemeHost}/robots.txt`, source);
    if (robots.ok) {
      for (const m of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) sitemapSeeds.add(cleanText(m[1]));
    }
    const sitemapQueue = [...sitemapSeeds];
    const seenSitemaps = new Set();
    const discoveredUrls = new Set();
    while (sitemapQueue.length && seenSitemaps.size < maxSitemapsPerHost) {
      const sm = sitemapQueue.shift();
      if (!sm || seenSitemaps.has(sm)) continue;
      seenSitemaps.add(sm);
      const fetched = await fetchText(sm, source);
      if (!fetched.ok) continue;
      for (const loc of xmlLocs(fetched.text)) {
        if (/\.xml(?:\.gz)?(?:\?|$)/i.test(loc)) {
          if (sitemapQueue.length + seenSitemaps.size < maxSitemapsPerHost * 3) sitemapQueue.push(loc);
        } else if (looksLikeChecklistPage(loc)) {
          discoveredUrls.add(loc);
        }
      }
    }
    stats.sitemapUrls += discoveredUrls.size;

    for (const p of source.seedPaths || []) discoveredUrls.add(new URL(p, schemeHost).href);
    for (const p of source.seedPathPrefixes || []) discoveredUrls.add(new URL(p, schemeHost).href);
    if (source.id === 'cardboard-connection') {
      for (let i = 1; i <= 40; i++) discoveredUrls.add(`${schemeHost}/page/${i}`);
    }
    if (source.id === 'blowout-forums') {
      discoveredUrls.add(`${schemeHost}/index.php`);
    }

    const queue = [...discoveredUrls].filter(url => shardFor(url) === shardIndex);
    const seen = new Set();
    while (queue.length && stats.pagesAttempted < maxPages) {
      const url = queue.shift();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      stats.pagesAttempted++;
      if (isAsset(url)) { addCandidate(url, source.id, 'asset'); stats.assetsFound++; continue; }
      const fetched = await fetchText(url, source);
      if (!fetched.ok) continue;
      stats.pagesOk++;
      const textLower = fetched.text.toLowerCase();
      if (/captcha|verify you are human|cloudflare challenge/.test(textLower)) { stats.blocked++; addEvent(url, 'captcha', 'challenge page'); continue; }
      if (/please login|log in to continue|subscribe to access|sign in to continue/.test(textLower) && source.mode !== 'authoritative-harvest') { stats.blocked++; addEvent(url, 'login_wall', 'access wall'); continue; }
      const links = htmlLinks(fetched.text, url);
      let found = false;
      for (const link of links) {
        if (isAsset(link) && /checklist|check-list|card|set/i.test(link)) {
          addCandidate(link, source.id, 'asset', url);
          stats.assetsFound++;
          found = true;
        } else if (source.mode === 'lead-only' && hostOf(link) !== host && isAsset(link)) {
          addCandidate(link, source.id, 'outbound-asset-lead', url);
          stats.assetsFound++;
          found = true;
        } else if (usefulPageLink(link, host) && seen.size + queue.length < maxPages * 3) {
          if (shardFor(link) === shardIndex) queue.push(link);
        }
      }
      if (looksLikeChecklistPage(url, fetched.text)) {
        addCandidate(url, source.id, source.mode === 'lead-only' ? 'page-lead' : 'checklist-page');
        stats.pageLeadsFound++;
        found = true;
      }
      addEvent(url, found ? 'validated' : 'no_checklist', found ? 'checklist lead/source detected' : 'no checklist lead detected', found);
    }
  }
}

const candidates = [...candidateMap.values()];
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ schema: 'tcos.checklist.ultimateVacuumDiscovery.v1', generatedAt: new Date().toISOString(), shardIndex, shardCount, stats, count: candidates.length, candidates }, null, 2) + '\n');
mkdirSync(dirname(eventsPath), { recursive: true });
writeFileSync(eventsPath, events.map(x => JSON.stringify(x)).join('\n') + (events.length ? '\n' : ''));
console.log(JSON.stringify({ ...stats, candidates: candidates.length, events: events.length }));
