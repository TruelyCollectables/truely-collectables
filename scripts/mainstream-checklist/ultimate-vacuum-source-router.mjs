#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const policyPath = resolve(process.env.VACUUM_POLICY || 'ops/checklists/ultimate-vacuum-source-policy-20260815.json');
const statePath = resolve(process.env.VACUUM_STATE || 'ops/checklists/ultimate-vacuum-source-state-20260815.json');
const eventsPath = process.env.VACUUM_EVENTS ? resolve(process.env.VACUUM_EVENTS) : null;
const candidatesPath = process.env.VACUUM_CANDIDATES ? resolve(process.env.VACUUM_CANDIDATES) : null;
const outputPath = resolve(process.env.VACUUM_OUTPUT || 'tmp/ultimate-vacuum-ranked-candidates.json');
const now = new Date();

function readJson(path, fallback) {
  if (!path || !existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isoAfterHours(hours) {
  return new Date(now.getTime() + Number(hours || 0) * 3600_000).toISOString();
}

const policy = readJson(policyPath, null);
if (!policy?.sources) throw new Error(`Invalid vacuum source policy: ${policyPath}`);

const sourceByHost = new Map();
for (const source of policy.sources) {
  for (const host of source.hosts || []) sourceByHost.set(String(host).toLowerCase(), source);
}

const state = readJson(statePath, {
  schema: 'tcos.checklist.ultimateVacuumSourceState.v1',
  updatedAt: null,
  hosts: {},
  negativeCache: {},
  totals: { events: 0 }
});
state.hosts ||= {};
state.negativeCache ||= {};
state.totals ||= { events: 0 };

function hostState(host) {
  const s = state.hosts[host] ||= {
    attempts: 0,
    sourcesFound: 0,
    validated: 0,
    netNew: 0,
    idempotent: 0,
    deadUrl: 0,
    bunkContent: 0,
    noChecklist: 0,
    accessBlocked: 0,
    rateLimited: 0,
    timeouts: 0,
    lastOutcome: null,
    lastSeenAt: null
  };
  return s;
}

function applyEvent(event) {
  const url = String(event.url || '');
  const host = String(event.host || hostOf(url));
  const outcome = String(event.outcome || 'unknown');
  if (!host) return;
  const hs = hostState(host);
  hs.attempts++;
  hs.lastOutcome = outcome;
  hs.lastSeenAt = event.at || now.toISOString();
  state.totals.events = Number(state.totals.events || 0) + 1;

  if (event.sourceFound) hs.sourcesFound++;
  switch (outcome) {
    case 'net_new': hs.netNew++; hs.validated++; break;
    case 'idempotent': hs.idempotent++; hs.validated++; break;
    case 'validated': hs.validated++; break;
    case 'dead_url': hs.deadUrl++; break;
    case 'bunk_content': hs.bunkContent++; break;
    case 'no_checklist': hs.noChecklist++; break;
    case 'login_wall':
    case 'paywall':
    case 'captcha':
    case 'robots_blocked': hs.accessBlocked++; break;
    case 'http_429': hs.rateLimited++; break;
    case 'timeout': hs.timeouts++; break;
  }

  const cacheable = new Set(['dead_url', 'bunk_content', 'no_checklist', 'login_wall', 'paywall', 'captcha', 'robots_blocked']);
  if (url && cacheable.has(outcome)) {
    const defaultHours = Number(policy.defaults?.negativeCacheHours || 168);
    const hours = Number(event.negativeCacheHours || (outcome === 'no_checklist' ? 24 : defaultHours));
    state.negativeCache[url] = {
      outcome,
      host,
      firstSeenAt: state.negativeCache[url]?.firstSeenAt || hs.lastSeenAt,
      lastSeenAt: hs.lastSeenAt,
      expiresAt: isoAfterHours(hours),
      detail: event.detail || null
    };
  }
}

if (eventsPath && existsSync(eventsPath)) {
  const raw = readFileSync(eventsPath, 'utf8').trim();
  if (raw) {
    if (raw.startsWith('[')) {
      for (const event of JSON.parse(raw)) applyEvent(event);
    } else {
      for (const line of raw.split(/\r?\n/)) if (line.trim()) applyEvent(JSON.parse(line));
    }
  }
}

for (const [url, entry] of Object.entries(state.negativeCache)) {
  if (!entry?.expiresAt || new Date(entry.expiresAt) <= now) delete state.negativeCache[url];
}

function reputationFor(host) {
  const source = sourceByHost.get(host);
  const hs = state.hosts[host] || {};
  const d = policy.defaults || {};
  const seed = Number(source?.seedScore ?? d.unknownHostScore ?? 40);
  const attempts = Math.max(1, Number(hs.attempts || 0));
  const dynamic = (
    Number(hs.netNew || 0) * Number(d.netNewProductionReward || 35) +
    Number(hs.validated || 0) * Number(d.validatedChecklistReward || 20) +
    Number(hs.idempotent || 0) * Number(d.idempotentProductionReward || 8) -
    Number(hs.deadUrl || 0) * Number(d.deadUrlPenalty || 25) -
    Number(hs.bunkContent || 0) * Number(d.bunkContentPenalty || 20) -
    Number(hs.noChecklist || 0) * Number(d.noChecklistPenalty || 8) -
    Number(hs.accessBlocked || 0) * 30 -
    Number(hs.rateLimited || 0) * 10 -
    Number(hs.timeouts || 0) * 4
  ) / Math.sqrt(attempts);
  return Math.max(0, Math.min(150, Math.round((seed + dynamic) * 100) / 100));
}

const candidatesDoc = readJson(candidatesPath, { candidates: [] });
const candidates = Array.isArray(candidatesDoc) ? candidatesDoc : (candidatesDoc.candidates || candidatesDoc.targets || []);
const ranked = [];
const skipped = [];

for (const candidate of candidates) {
  const url = String(candidate.url || candidate.sourceUrl || candidate.articleUrl || '');
  const host = hostOf(url);
  if (!url || !host) {
    skipped.push({ ...candidate, skipReason: 'invalid_url' });
    continue;
  }
  const negative = state.negativeCache[url];
  if (negative && new Date(negative.expiresAt) > now) {
    skipped.push({ ...candidate, host, skipReason: `negative_cache:${negative.outcome}`, retryAfter: negative.expiresAt });
    continue;
  }
  const source = sourceByHost.get(host);
  if (source?.mode === 'lead-only-public-pages' && candidate.requiresLogin === true) {
    skipped.push({ ...candidate, host, skipReason: 'access_controlled' });
    continue;
  }
  const score = reputationFor(host);
  const leadPenalty = String(source?.mode || '').startsWith('lead-only') ? 12 : 0;
  ranked.push({
    ...candidate,
    url,
    host,
    sourceId: source?.id || 'unknown',
    sourceMode: source?.mode || 'unknown',
    reputationScore: Math.max(0, score - leadPenalty),
    maxConcurrentPerHost: Number(source?.maxConcurrentPerHost || policy.defaults?.maxConcurrentPerHost || 3),
    maxRequestsPerSecondPerHost: Number(source?.maxRequestsPerSecondPerHost || policy.defaults?.maxRequestsPerSecondPerHost || 1)
  });
}
ranked.sort((a, b) => b.reputationScore - a.reputationScore || a.host.localeCompare(b.host));

state.updatedAt = now.toISOString();
state.hostScores = Object.fromEntries([...new Set([...sourceByHost.keys(), ...Object.keys(state.hosts)])].sort().map(host => [host, reputationFor(host)]));
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({
  schema: 'tcos.checklist.ultimateVacuumRankedCandidates.v1',
  generatedAt: now.toISOString(),
  candidateCount: candidates.length,
  rankedCount: ranked.length,
  skippedCount: skipped.length,
  ranked,
  skipped
}, null, 2) + '\n');

console.log(JSON.stringify({
  policySources: policy.sources.length,
  hostStateCount: Object.keys(state.hosts).length,
  negativeCacheCount: Object.keys(state.negativeCache).length,
  candidateCount: candidates.length,
  rankedCount: ranked.length,
  skippedCount: skipped.length,
  topHosts: Object.entries(state.hostScores).sort((a,b) => b[1]-a[1]).slice(0,10)
}));
