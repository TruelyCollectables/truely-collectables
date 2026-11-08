import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const SEEDS_PATH = resolve(process.cwd(), 'data/overnight-checklist-harvest-seeds.json');
const STATE_PATH = resolve(process.cwd(), 'data/overnight-checklist-harvest-state.json');
const OUTPUT_ROOT = resolve(process.cwd(), '.overnight-checklist-harvest/current');
const RECEIPT_PATH = resolve(OUTPUT_ROOT, 'receipt.json');
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT || '';
const RUN_ID = process.env.GITHUB_RUN_ID || null;
const MIN_INTERVAL_MS = 5 * 60 * 1000;
const DISCOVERY_DELAY_MS = 3_000;
const USER_AGENT = 'TCOS-Checklist-Harvest/1.0 (+source-only archive; contact sales@truelycollectables.com)';

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const nowIso = () => new Date().toISOString();
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const safe = (value) => String(value || 'source').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 110) || 'source';

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function setOutput(name, value) {
  if (!GITHUB_OUTPUT) return;
  writeFileSync(GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, { flag: 'a' });
}

function canonical(value, base) {
  const url = new URL(value, base);
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function stripTags(value) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsedDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function publishedAtFromBlock(block) {
  const datetime = block.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i)?.[1];
  const parsedDatetime = parsedDate(datetime);
  if (parsedDatetime) return parsedDatetime.toISOString();
  const text = stripTags(block);
  const human = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i)?.[0];
  const parsedHuman = parsedDate(human);
  return parsedHuman ? parsedHuman.toISOString() : null;
}

function sourceStartYearHint(sourceUrl) {
  try {
    const slug = new URL(sourceUrl).pathname.toLowerCase();
    const season = slug.match(/(?:^|[^0-9])(20\d{2})-(?:20)?\d{2}(?:[^0-9]|$)/);
    if (season) return Number(season[1]);
    const year = slug.match(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/);
    return year ? Number(year[1]) : null;
  } catch {
    return null;
  }
}

function checklistUrlFromBlock(block, base) {
  for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = canonical(match[1], base);
      const parsed = new URL(url);
      if (!/(^|\.)upperdeck\.com$/i.test(parsed.hostname)) continue;
      if (/^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) return url;
    } catch {}
  }
  return null;
}

function categoryEntries(html, base, categoryPage) {
  const entries = new Map();
  for (const article of html.matchAll(/<article\b[\s\S]*?<\/article>/gi)) {
    const block = article[0];
    const sourceUrl = checklistUrlFromBlock(block, base);
    if (!sourceUrl) continue;
    entries.set(sourceUrl, { sourceUrl, publishedAt: publishedAtFromBlock(block), categoryPage });
  }
  if (entries.size) return [...entries.values()];

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try {
      const sourceUrl = canonical(match[1], base);
      const parsed = new URL(sourceUrl);
      if (!/(^|\.)upperdeck\.com$/i.test(parsed.hostname)) continue;
      if (!/^\/checklist\/[^/]+\/$/i.test(parsed.pathname)) continue;
      const index = match.index || 0;
      const nearby = html.slice(Math.max(0, index - 3_000), Math.min(html.length, index + 3_000));
      entries.set(sourceUrl, { sourceUrl, publishedAt: publishedAtFromBlock(nearby), categoryPage });
    } catch {}
  }
  return [...entries.values()];
}

async function fetchResponse(url, accept) {
  return fetch(url, {
    headers: {
      Accept: accept,
      'Cache-Control': 'no-cache',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(90_000),
  });
}

async function fetchDiscoveryHtml(url) {
  const response = await fetchResponse(url, 'text/html,application/xhtml+xml');
  if (response.status === 429 || response.status === 403) {
    const error = new Error(`Discovery blocked with HTTP ${response.status} at ${url}`);
    error.httpStatus = response.status;
    error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} fetching ${url}`);
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('text/html')) throw new Error(`Unexpected discovery content type ${type || 'unknown'} at ${url}`);
  const html = await response.text();
  if (html.length < 1_000) throw new Error(`Incomplete discovery HTML (${html.length} bytes) at ${url}`);
  return html;
}

function parseRetryAfter(value) {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed - Date.now()) : 0;
}

function loadState(seeds) {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  return {
    schema: 'tcos.overnightChecklistHarvestState.v1',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    scope: seeds.scope,
    runPolicy: {
      sourceDownloadsPerRun: 1,
      minimumIntervalMinutes: 5,
      parallelism: 1,
      retriesInsideRun: 0,
      on429: 'pause at least 60 minutes and honor Retry-After',
      on403: 'pause six hours',
      databaseWrites: false,
    },
    discovery: {},
    queue: [],
    lastFetchAt: null,
    globalPauseUntil: null,
  };
}

function upsertQueue(state, target, defaultStatus = 'pending') {
  const existing = state.queue.find((entry) => entry.id === target.id || entry.sourceUrl === target.sourceUrl);
  if (existing) {
    Object.assign(existing, { ...target, status: existing.status || defaultStatus });
    return existing;
  }
  const entry = {
    ...target,
    status: defaultStatus,
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
  };
  state.queue.push(entry);
  return entry;
}

function seedStaticTargets(state, seeds) {
  for (const target of seeds.directTargets || []) {
    upsertQueue(state, { ...target, priority: 10, sourceClass: 'direct' }, 'pending');
  }
  for (const target of seeds.alreadyArchivedTargets || []) {
    upsertQueue(state, { ...target, priority: 90, sourceClass: 'existing_artifact' }, 'covered_artifact');
  }
}

async function discoverUpperDeck(state, seeds) {
  const config = seeds.upperDeck;
  const boundary = new Date(seeds.scope.hockeyBoundary || '2021-07-01T00:00:00Z');
  const covered = new Set(config.knownCoveredProductionUrls || []);
  const candidates = new Map();
  const pages = [];

  for (let page = 1; page <= Number(config.maxPages || 40); page += 1) {
    const pageUrl = page === 1 ? config.categoryUrl : `${config.categoryUrl}page/${page}/`;
    let html;
    try {
      html = await fetchDiscoveryHtml(pageUrl);
    } catch (error) {
      if (page > 1 && /HTTP 404\b/i.test(error instanceof Error ? error.message : String(error))) break;
      throw error;
    }
    const entries = categoryEntries(html, pageUrl, page);
    if (!entries.length) break;
    const dated = entries.map((entry) => parsedDate(entry.publishedAt)).filter(Boolean);
    const pageClearlyOld = dated.length > 0 && dated.every((date) => date < boundary);
    const eligible = entries.filter((entry) => {
      const yearHint = sourceStartYearHint(entry.sourceUrl);
      if (yearHint !== null && yearHint < 2021) return false;
      const published = parsedDate(entry.publishedAt);
      if (published) return published >= boundary;
      return !pageClearlyOld;
    });
    for (const entry of eligible) candidates.set(entry.sourceUrl, entry);
    pages.push({ page, url: pageUrl, entryCount: entries.length, eligibleCount: eligible.length });
    if (pageClearlyOld) break;
    await sleep(DISCOVERY_DELAY_MS);
  }

  for (const candidate of candidates.values()) {
    const slugPart = new URL(candidate.sourceUrl).pathname.split('/').filter(Boolean).pop() || 'upper-deck-checklist';
    upsertQueue(state, {
      id: `upper-deck-${slugPart}`,
      sport: 'Hockey',
      league: null,
      season: null,
      manufacturer: 'Upper Deck',
      title: slugPart.replace(/-/g, ' '),
      sourceUrl: candidate.sourceUrl,
      kind: 'html',
      authority: 'official_manufacturer',
      sourceClass: 'upper_deck_page',
      categoryPage: candidate.categoryPage,
      publishedAt: candidate.publishedAt,
      priority: 20,
    }, covered.has(candidate.sourceUrl) ? 'covered_production' : 'pending');
  }

  state.discovery.upperDeck = {
    completedAt: nowIso(),
    candidateCount: candidates.size,
    pages,
    coveredProductionCount: [...candidates.keys()].filter((url) => covered.has(url)).length,
    pendingDownloadCount: [...candidates.keys()].filter((url) => !covered.has(url)).length,
  };
}

function summarize(state) {
  const counts = {};
  for (const entry of state.queue) counts[entry.status] = (counts[entry.status] || 0) + 1;
  const unresolved = state.queue.filter((entry) => !['downloaded', 'covered_production', 'covered_artifact'].includes(entry.status));
  return {
    totalTargets: state.queue.length,
    counts,
    remainingDownloadCount: unresolved.length,
    downloadedCount: counts.downloaded || 0,
    coveredProductionCount: counts.covered_production || 0,
    coveredArtifactCount: counts.covered_artifact || 0,
  };
}

function chooseTarget(state) {
  const now = Date.now();
  return state.queue
    .filter((entry) => ['pending', 'retry'].includes(entry.status))
    .filter((entry) => !entry.nextAttemptAt || Date.parse(entry.nextAttemptAt) <= now)
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || (a.attempts ?? 0) - (b.attempts ?? 0) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

function validatePayload(target, response, bytes) {
  const kind = target.kind || 'bin';
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (bytes.length < 200) throw new Error(`Source payload too small (${bytes.length} bytes)`);
  const prefix = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('utf8').toLowerCase();
  if (/captcha|too many requests|access denied|temporarily blocked/.test(prefix)) throw new Error('Source payload looks like a block/challenge page');
  if (kind === 'html') {
    if (bytes.length < 1_000 || (!type.includes('html') && !prefix.includes('<html'))) throw new Error(`Unexpected HTML source payload (${type || 'unknown'})`);
  } else if (kind === 'pdf') {
    if (bytes.length < 10_000 || bytes.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('Downloaded Topps source is not a valid PDF payload');
  } else if (kind === 'xlsx') {
    if (bytes.length < 1_000 || bytes.subarray(0, 2).toString('ascii') !== 'PK') throw new Error('Downloaded workbook is not an XLSX/ZIP payload');
  } else if (kind === 'xls') {
    if (bytes.length < 1_000) throw new Error('Downloaded XLS payload is too small');
  } else if (kind === 'csv') {
    const text = bytes.toString('utf8');
    if (text.length < 200 || !text.includes(',')) throw new Error('Downloaded CSV payload is not checklist-like');
  }
}

async function fetchOneTarget(state, target) {
  const attemptStarted = nowIso();
  target.attempts = Number(target.attempts || 0) + 1;
  target.lastAttemptAt = attemptStarted;
  state.lastFetchAt = attemptStarted;

  let response;
  try {
    response = await fetchResponse(target.sourceUrl, target.kind === 'html' ? 'text/html,application/xhtml+xml' : '*/*');
  } catch (error) {
    target.status = 'retry';
    target.lastError = error instanceof Error ? error.message : String(error);
    target.nextAttemptAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    return { ok: false, retry: true, error: target.lastError };
  }

  if (response.status === 429 || response.status === 403) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    const minimum = response.status === 429 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const pauseMs = Math.max(minimum, retryAfterMs);
    state.globalPauseUntil = new Date(Date.now() + pauseMs).toISOString();
    target.status = 'retry';
    target.lastHttpStatus = response.status;
    target.lastError = `HTTP ${response.status}; global source pause engaged`;
    target.nextAttemptAt = state.globalPauseUntil;
    return { ok: false, retry: true, blocked: true, error: target.lastError };
  }

  if (!response.ok) {
    const delayMs = response.status === 404 ? 2 * 60 * 60 * 1000 : 30 * 60 * 1000;
    target.status = 'retry';
    target.lastHttpStatus = response.status;
    target.lastError = `HTTP ${response.status} ${response.statusText}`;
    target.nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
    return { ok: false, retry: true, error: target.lastError };
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  try {
    validatePayload(target, response, bytes);
  } catch (error) {
    target.status = 'retry';
    target.lastError = error instanceof Error ? error.message : String(error);
    target.nextAttemptAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return { ok: false, retry: true, error: target.lastError };
  }

  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const extension = target.kind === 'html' ? '.html' : target.kind === 'pdf' ? '.pdf' : target.kind === 'xlsx' ? '.xlsx' : target.kind === 'xls' ? '.xls' : target.kind === 'csv' ? '.csv' : extname(new URL(response.url).pathname) || '.bin';
  const rawFilename = `${safe(target.id)}${extension}`;
  const rawPath = resolve(OUTPUT_ROOT, rawFilename);
  writeFileSync(rawPath, bytes);

  const artifactName = `overnight-checklist-source-${RUN_ID || 'local'}`;
  target.status = 'downloaded';
  target.downloadedAt = nowIso();
  target.nextAttemptAt = null;
  target.lastError = null;
  target.finalUrl = response.url;
  target.contentType = response.headers.get('content-type') || null;
  target.bytes = bytes.length;
  target.sha256 = sha256(bytes);
  target.rawFilename = rawFilename;
  target.runId = RUN_ID;
  target.artifactName = artifactName;
  return { ok: true, rawPath, rawFilename, artifactName, bytes: bytes.length, sha256: target.sha256 };
}

async function main() {
  if (!existsSync(SEEDS_PATH)) throw new Error(`Missing seed manifest: ${SEEDS_PATH}`);
  const seeds = JSON.parse(readFileSync(SEEDS_PATH, 'utf8'));
  const state = loadState(seeds);
  seedStaticTargets(state, seeds);

  let discoveryOnly = false;
  if (!state.discovery?.upperDeck?.completedAt) {
    try {
      await discoverUpperDeck(state, seeds);
      discoveryOnly = true;
    } catch (error) {
      const status = Number(error?.httpStatus || 0);
      if (status === 429 || status === 403) {
        const retryAfterMs = parseRetryAfter(error.retryAfter);
        const minimum = status === 429 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
        state.globalPauseUntil = new Date(Date.now() + Math.max(minimum, retryAfterMs)).toISOString();
      }
      state.discovery.upperDeck = {
        ...(state.discovery.upperDeck || {}),
        lastAttemptAt: nowIso(),
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const before = summarize(state);
  let action = { status: discoveryOnly ? 'discovery_only' : 'no_op' };

  const pauseUntil = state.globalPauseUntil ? Date.parse(state.globalPauseUntil) : 0;
  if (!discoveryOnly && pauseUntil && pauseUntil > Date.now()) {
    action = { status: 'paused', until: state.globalPauseUntil };
  } else if (!discoveryOnly && state.lastFetchAt && Date.now() - Date.parse(state.lastFetchAt) < MIN_INTERVAL_MS) {
    action = { status: 'rate_limited_locally', nextAllowedAt: new Date(Date.parse(state.lastFetchAt) + MIN_INTERVAL_MS).toISOString() };
  } else if (!discoveryOnly) {
    if (pauseUntil && pauseUntil <= Date.now()) state.globalPauseUntil = null;
    const target = chooseTarget(state);
    if (target) {
      const result = await fetchOneTarget(state, target);
      action = { status: result.ok ? 'downloaded' : result.blocked ? 'blocked_paused' : 'retry_scheduled', targetId: target.id, sourceUrl: target.sourceUrl, ...result };
    } else {
      action = before.remainingDownloadCount === 0 ? { status: 'complete' } : { status: 'waiting_for_retry_window' };
    }
  }

  state.updatedAt = nowIso();
  const after = summarize(state);
  state.summary = after;
  writeJson(STATE_PATH, state);
  writeJson(RECEIPT_PATH, {
    schema: 'tcos.overnightChecklistHarvestReceipt.v1',
    runId: RUN_ID,
    generatedAt: nowIso(),
    scope: state.scope,
    action,
    before,
    after,
    globalPauseUntil: state.globalPauseUntil,
    databaseWrites: false,
  });

  setOutput('artifact_name', action.artifactName || `overnight-checklist-receipt-${RUN_ID || 'local'}`);
  setOutput('downloaded', action.status === 'downloaded' ? 'true' : 'false');
  setOutput('complete', after.remainingDownloadCount === 0 ? 'true' : 'false');
  setOutput('remaining', String(after.remainingDownloadCount));
  console.log(JSON.stringify({ action, summary: after, globalPauseUntil: state.globalPauseUntil }, null, 2));
}

main().catch((error) => {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  writeJson(RECEIPT_PATH, {
    schema: 'tcos.overnightChecklistHarvestReceipt.v1',
    runId: RUN_ID,
    generatedAt: nowIso(),
    status: 'fatal',
    error: error instanceof Error ? error.stack || error.message : String(error),
    databaseWrites: false,
  });
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
