import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const INPUT = resolve(process.cwd(), process.env.VACUUM_RESOLVER_INPUT || 'tmp/ultimate-vacuum-ranked.json');
const OUTPUT = resolve(process.cwd(), process.env.VACUUM_RESOLVER_OUTPUT || 'tmp/ultimate-vacuum-resolved-assets.json');
const MAX_PAGES = Math.max(1, Number(process.env.VACUUM_RESOLVER_MAX_PAGES || 500));
const MAX_PAGES_PER_HOST = Math.max(1, Number(process.env.VACUUM_RESOLVER_MAX_PAGES_PER_HOST || 250));
const MAX_ASSETS = Math.max(1, Number(process.env.VACUUM_RESOLVER_MAX_ASSETS || 500));
const MAX_DEPTH = Math.max(0, Math.min(3, Number(process.env.VACUUM_RESOLVER_MAX_DEPTH || 2)));
const WORKERS = Math.max(1, Math.min(2, Number(process.env.VACUUM_RESOLVER_WORKERS || 2)));
const RPS_CAP = Math.max(0.05, Math.min(1, Number(process.env.VACUUM_RESOLVER_RPS_CAP || 0.4)));
const FETCH_TIMEOUT_MS = Math.max(5_000, Number(process.env.VACUUM_RESOLVER_FETCH_TIMEOUT_MS || 15_000));

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const hostNextRequest = new Map();

function siteKey(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function isStructuredAsset(url) {
  try {
    return /\.(?:xlsx?|csv|pdf)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function cleanHref(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#038;', '&')
    .replaceAll('&#38;', '&')
    .replaceAll('\\/', '/');
}

function reserveHostSlot(host, rps) {
  const gap = Math.max(250, 1000 / Math.max(0.05, rps));
  const now = Date.now();
  const slot = Math.max(now, hostNextRequest.get(host) || now);
  const jitter = Math.floor(gap * (0.15 + Math.random() * 0.25));
  hostNextRequest.set(host, slot + gap + jitter);
  return Math.max(0, slot - now);
}

function pushHostBack(host, seconds) {
  const until = Date.now() + Math.max(0, Number(seconds || 0)) * 1000;
  hostNextRequest.set(host, Math.max(hostNextRequest.get(host) || 0, until));
}

async function fetchPublic(url, rps) {
  const host = new URL(url).hostname.toLowerCase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = reserveHostSlot(host, rps);
    if (wait > 0) await sleep(wait);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.5' },
      });
      if (response.status === 429) {
        pushHostBack(host, 60);
        continue;
      }
      if (!response.ok) return { ok: false, status: response.status, url: response.url || url };
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (isStructuredAsset(response.url || url) || /application\/(?:pdf|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)|text\/csv/i.test(contentType)) {
        return { ok: true, assetUrl: response.url || url, contentType };
      }
      const text = await response.text();
      return { ok: true, url: response.url || url, contentType, text };
    } catch (error) {
      if (attempt === 2) return { ok: false, status: 'fetch_error', message: error instanceof Error ? error.message : String(error), url };
      pushHostBack(host, 5 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 'exhausted', url };
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const text = String(html || '');
  const patterns = [
    /(?:href|data-href|data-url)=["']([^"']+)["']/gi,
    /https?:\\?\/\\?\/[^"'<>\s]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = cleanHref(match[1] || match[0]);
      try {
        const parsed = new URL(raw, baseUrl);
        if (!/^https?:$/.test(parsed.protocol)) continue;
        parsed.hash = '';
        links.add(parsed.href);
      } catch {}
    }
  }
  return [...links];
}

function usefulChildPage(url, parentUrl) {
  try {
    const child = new URL(url);
    const parent = new URL(parentUrl);
    if (siteKey(child.hostname) !== siteKey(parent.hostname)) return false;
    const path = child.pathname.toLowerCase();
    if (isStructuredAsset(url)) return false;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|css|js)$/i.test(path)) return false;
    if (/\/(?:tag|author|feed)(?:\/|$)/i.test(path)) return false;
    return /checklist|trading-card|cards|product|checklist-brand|\/page\/\d+/i.test(path);
  } catch {
    return false;
  }
}

function candidateEligible(candidate) {
  const mode = String(candidate?.sourceMode || '');
  const score = Number(candidate?.reputationScore || 0);
  if (mode.startsWith('lead-only')) return false;
  if (score < 75) return false;
  try {
    const host = new URL(String(candidate?.url || '')).hostname.toLowerCase();
    if (['beckett.com', 'www.beckett.com'].includes(host)) return false;
  } catch {
    return false;
  }
  return true;
}

async function main() {
  const input = JSON.parse(readFileSync(INPUT, 'utf8'));
  const ranked = Array.isArray(input) ? input : (input.ranked || input.candidates || []);
  const seeds = ranked.filter(candidateEligible).sort((a, b) => Number(b.reputationScore || 0) - Number(a.reputationScore || 0));
  const pageQueue = [];
  const queuedPages = new Set();
  const seenPages = new Set();
  const hostPages = new Map();
  const assets = new Map();
  const failures = [];
  let pagesFetched = 0;

  function addAsset(url, parentUrl, seed) {
    if (!isStructuredAsset(url) || assets.has(url) || assets.size >= MAX_ASSETS) return;
    assets.set(url, {
      url,
      host: new URL(url).hostname.toLowerCase(),
      sourceId: seed.sourceId || null,
      kind: 'asset',
      parentUrl: parentUrl || seed.parentUrl || null,
      sourceMode: seed.sourceMode || 'harvest',
      reputationScore: Number(seed.reputationScore || 0),
      maxConcurrentPerHost: Math.min(2, Number(seed.maxConcurrentPerHost || 2)),
      maxRequestsPerSecondPerHost: Math.min(RPS_CAP, Number(seed.maxRequestsPerSecondPerHost || RPS_CAP)),
    });
  }

  function enqueuePage(url, seed, depth) {
    if (depth > MAX_DEPTH || queuedPages.has(url) || seenPages.has(url)) return;
    queuedPages.add(url);
    pageQueue.push({ url, seed, depth });
  }

  for (const seed of seeds) {
    const url = String(seed.url || '');
    if (!url) continue;
    if (isStructuredAsset(url)) addAsset(url, seed.parentUrl || null, seed);
    else enqueuePage(url, seed, 0);
  }

  async function worker(workerId) {
    while (pageQueue.length && pagesFetched < MAX_PAGES && assets.size < MAX_ASSETS) {
      const item = pageQueue.shift();
      if (!item) return;
      queuedPages.delete(item.url);
      if (seenPages.has(item.url)) continue;
      const host = new URL(item.url).hostname.toLowerCase();
      const used = hostPages.get(host) || 0;
      if (used >= MAX_PAGES_PER_HOST) continue;
      hostPages.set(host, used + 1);
      seenPages.add(item.url);
      pagesFetched++;
      const rps = Math.min(RPS_CAP, Math.max(0.05, Number(item.seed.maxRequestsPerSecondPerHost || RPS_CAP)));
      const fetched = await fetchPublic(item.url, rps);
      if (!fetched.ok) {
        failures.push({ url: item.url, workerId, status: fetched.status || 'failed', message: fetched.message || null });
        continue;
      }
      if (fetched.assetUrl) {
        addAsset(fetched.assetUrl, item.url, item.seed);
        continue;
      }
      for (const link of extractLinks(fetched.text, fetched.url || item.url)) {
        if (isStructuredAsset(link)) addAsset(link, fetched.url || item.url, item.seed);
        else if (item.depth < MAX_DEPTH && usefulChildPage(link, fetched.url || item.url)) enqueuePage(link, item.seed, item.depth + 1);
      }
    }
  }

  await Promise.all(Array.from({ length: WORKERS }, (_, index) => worker(index + 1)));

  const candidates = [...assets.values()].sort((a, b) => Number(b.reputationScore || 0) - Number(a.reputationScore || 0) || a.url.localeCompare(b.url));
  const output = {
    schema: 'tcos.checklist.ultimateVacuumResolvedAssets.v1',
    generatedAt: new Date().toISOString(),
    inputCount: ranked.length,
    eligibleSeedCount: seeds.length,
    pagesFetched,
    hostPages: Object.fromEntries([...hostPages.entries()].sort()),
    assetCount: candidates.length,
    failureCount: failures.length,
    failures: failures.slice(0, 200),
    ranked: candidates,
  };
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ inputCount: output.inputCount, eligibleSeedCount: output.eligibleSeedCount, pagesFetched: output.pagesFetched, assetCount: output.assetCount, failureCount: output.failureCount }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
