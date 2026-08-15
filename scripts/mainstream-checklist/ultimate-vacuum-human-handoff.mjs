#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const eventsPath = resolve(process.env.VACUUM_EVENTS || 'tmp/ultimate-vacuum-all-events.ndjson');
const outputPath = resolve(process.env.VACUUM_HUMAN_HANDOFF_OUTPUT || 'ops/checklists/ultimate-vacuum-human-handoff-20260815.json');

function readEvents(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) return JSON.parse(raw);
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return String(url || '');
  }
}

const humanAction = {
  captcha: {
    lane: 'human-captcha',
    priority: 100,
    action: 'Open this public page in your normal browser and complete the CAPTCHA yourself. If it reveals a checklist file or final public checklist URL, download the file or copy that public URL and provide it back to the checklist pipeline. Do not share cookies, session tokens, passwords, or CAPTCHA-solving credentials.'
  },
  login_wall: {
    lane: 'authorized-manual-download',
    priority: 80,
    action: 'Only if you already have legitimate authorized access: sign in normally, manually download the checklist, and provide the downloaded file to the checklist pipeline. Do not share account passwords, cookies, session tokens, or authentication headers.'
  },
  paywall: {
    lane: 'authorized-manual-download',
    priority: 70,
    action: 'Only if you already have legitimate paid/authorized access: manually download the checklist and provide the file. If you do not have access, skip this source. Do not bypass the paywall or share credentials/session data.'
  },
  robots_blocked: {
    lane: 'skip-no-bypass',
    priority: 0,
    action: 'Do not bypass the site restriction. Search for the same checklist on another public source.'
  }
};

const byUrl = new Map();
for (const event of readEvents(eventsPath)) {
  const outcome = String(event.outcome || '');
  const rule = humanAction[outcome];
  if (!rule) continue;
  const url = canonical(event.url);
  if (!url) continue;
  const current = byUrl.get(url);
  const item = {
    url,
    host: event.host || (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
    outcome,
    lane: rule.lane,
    priority: rule.priority,
    action: rule.action,
    detail: event.detail || null,
    firstSeenAt: current?.firstSeenAt || event.at || null,
    lastSeenAt: event.at || current?.lastSeenAt || null,
    occurrences: Number(current?.occurrences || 0) + 1
  };
  if (!current || item.priority > current.priority || item.lastSeenAt > current.lastSeenAt) byUrl.set(url, item);
  else current.occurrences = item.occurrences;
}

const all = [...byUrl.values()].sort((a, b) => b.priority - a.priority || a.host.localeCompare(b.host) || a.url.localeCompare(b.url));
const actionable = all.filter((x) => x.lane === 'human-captcha' || x.lane === 'authorized-manual-download');
const skip = all.filter((x) => x.lane === 'skip-no-bypass');
const counts = Object.fromEntries([...new Set(all.map((x) => x.lane))].sort().map((lane) => [lane, all.filter((x) => x.lane === lane).length]));

const doc = {
  schema: 'tcos.checklist.ultimateVacuumHumanHandoff.v1',
  generatedAt: new Date().toISOString(),
  totalBlockedUrls: all.length,
  actionableCount: actionable.length,
  skipCount: skip.length,
  counts,
  instructions: {
    safestReturnPath: 'For CAPTCHA: return the final public URL or downloaded checklist file. For an authorized login/paywall: return only the downloaded checklist file. Never send passwords, cookies, session tokens, auth headers, or CAPTCHA-solving tokens.',
    validation: 'Every returned file or URL still goes through exact-set validation before Production persistence.'
  },
  actionable,
  skip
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({ totalBlockedUrls: all.length, actionableCount: actionable.length, skipCount: skip.length, counts }));
