import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  countChecklistRows,
  decodeHtml,
  extractChecklistFromHtml,
  saveItem,
  slug,
} from "./checklist-sources/shared.mjs";

const TARGETS_PATH = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_TARGETS || "data/checklist-recovery-targets.json");
const STATE_ROOT = resolve(process.cwd(), process.env.CHECKLIST_RECOVERY_STATE || ".checklist-recovery-state");
const OUTPUT_ROOT = resolve(process.cwd(), process.env.CHECKLIST_OUTPUT_ROOT || ".checklist-recovery-source-archive/recovery");
const PROGRESS_PATH = resolve(STATE_ROOT, "progress.json");
const CHECKPOINT_PATH = resolve(STATE_ROOT, "checkpoint.json");
const LEADS_PATH = resolve(STATE_ROOT, "community-and-discovery-leads.json");
const SUMMARY_PATH = process.env.GITHUB_STEP_SUMMARY || null;
const MAX_TARGETS = Math.max(1, Number(process.env.CHECKLIST_RECOVERY_MAX_TARGETS || 75));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_RECOVERY_MAX_ATTEMPTS || 5));
const SEARCH_DELAY_MS = Math.max(250, Number(process.env.CHECKLIST_RECOVERY_SEARCH_DELAY_MS || 1200));
const CHECKPOINT_INTERVAL_MS = Math.max(60_000, Number(process.env.CHECKLIST_RECOVERY_PROGRESS_INTERVAL_MS || 300_000));
const ENABLE_GOOGLE = process.env.CHECKLIST_ENABLE_GOOGLE !== "false";
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const UA = "Mozilla/5.0 (compatible; TCOS-Checklist-Recovery/1.0; +https://totallycollectibles.com)";
const MAX_BYTES = Math.max(1_000_000, Number(process.env.CHECKLIST_MAX_DOWNLOAD_BYTES || 50_000_000));

process.env.CHECKLIST_SOURCE = "recovery";
process.env.CHECKLIST_OUTPUT_ROOT = OUTPUT_ROOT;

const TRUST = new Map([
  ["topps.com", 100], ["www.topps.com", 100], ["upperdeck.com", 100], ["www.upperdeck.com", 100],
  ["paniniamerica.net", 100], ["www.paniniamerica.net", 100], ["leaftradingcards.com", 95],
  ["baseballcardpedia.com", 92], ["www.baseballcardpedia.com", 92], ["beckett.com", 90], ["www.beckett.com", 90],
  ["cardboardconnection.com", 86], ["www.cardboardconnection.com", 86], ["breakninja.com", 84], ["www.breakninja.com", 84],
  ["gogts.net", 82], ["www.gogts.net", 82], ["cardboardchecklist.com", 80], ["www.cardboardchecklist.com", 80],
  ["keymancollectibles.com", 78], ["www.keymancollectibles.com", 78], ["sportscardradio.com", 75],
  ["archive.org", 72], ["web.archive.org", 72],
]);
const COMMUNITY_HOSTS = new Set([
  "reddit.com", "www.reddit.com", "old.reddit.com", "blowoutforums.com", "www.blowoutforums.com",
  "tradingcarddb.com", "www.tcdb.com", "docs.google.com", "drive.google.com",
]);
const REJECT_HOSTS = new Set([
  "ebay.com", "www.ebay.com", "amazon.com", "www.amazon.com", "pinterest.com", "www.pinterest.com",
  "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "youtube.com", "www.youtube.com",
]);
const FILE_EXT = /\.(pdf|xlsx?|csv|tsv|txt)(?:\?|$)/i;

function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
function now() { return new Date().toISOString(); }
function normalizeText(value) { return decodeHtml(String(value || "")).replace(/\s+/g, " ").trim(); }
function tokens(value) {
  return slug(value).split("-").filter((part) => part.length > 1 && !["cards", "card", "checklist", "set", "edition", "hobby"].includes(part));
}
function atomicJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}
function loadJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function urlHost(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } }
function uniqueByUrl(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const url = String(row.url || "").replace(/#.*$/, "");
    if (!url || seen.has(url)) return false;
    seen.add(url);
    row.url = url;
    return true;
  });
}
function targetLabel(target) { return `${target.season} ${target.manufacturer} ${target.product} ${target.sport}`.replace(/\s+/g, " ").trim(); }

const targetsDoc = loadJson(TARGETS_PATH, null);
if (!targetsDoc || !Array.isArray(targetsDoc.targets)) throw new Error(`Invalid recovery target file: ${TARGETS_PATH}`);
const targets = targetsDoc.targets;
mkdirSync(STATE_ROOT, { recursive: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });
mkdirSync(resolve(OUTPUT_ROOT, "items"), { recursive: true });

const state = loadJson(CHECKPOINT_PATH, {
  schema: "tcos.checklistRecoveryCheckpoint.v1",
  runId: RUN_ID,
  createdAt: now(),
  updatedAt: now(),
  targets: {},
  discovery: { cursor: 0, leads: [] },
});
state.runId = RUN_ID;
const leads = loadJson(LEADS_PATH, { schema: "tcos.checklistRecoveryLeads.v1", updatedAt: now(), leads: [] });
let currentTarget = null;
let stopped = false;
let processedThisRun = 0;
let lastSummaryAt = 0;

function totals() {
  const rows = targets.map((target) => state.targets[target.id] || {});
  const recovered = rows.filter((row) => row.status === "recovered").length;
  const exhausted = rows.filter((row) => row.status === "exhausted").length;
  const attempted = rows.filter((row) => Number(row.attempts || 0) > 0).length;
  const pending = targets.length - recovered - exhausted;
  return {
    targetTotal: targets.length,
    recovered,
    exhausted,
    attempted,
    pending,
    percentRecovered: targets.length ? Number(((recovered / targets.length) * 100).toFixed(2)) : 100,
    processedThisRun,
    currentTarget: currentTarget ? targetLabel(currentTarget) : null,
  };
}
function writeProgress(reason = "checkpoint") {
  state.updatedAt = now();
  const payload = {
    schema: "tcos.checklistRecoveryProgress.v1",
    runId: RUN_ID,
    updatedAt: state.updatedAt,
    reason,
    freezeProtection: {
      atomicCheckpoint: true,
      signalCheckpoint: true,
      resumeEnabled: true,
      progressIntervalMinutes: Math.round(CHECKPOINT_INTERVAL_MS / 60000),
      perRequestTimeoutSeconds: 45,
      maxAttemptsPerTarget: MAX_ATTEMPTS,
    },
    totals: totals(),
  };
  atomicJson(CHECKPOINT_PATH, state);
  atomicJson(PROGRESS_PATH, payload);
  leads.updatedAt = state.updatedAt;
  atomicJson(LEADS_PATH, leads);

  if (SUMMARY_PATH && Date.now() - lastSummaryAt > 30_000) {
    const t = payload.totals;
    const line = [
      `### Checklist recovery — ${payload.updatedAt}`,
      "",
      `**${t.percentRecovered}% recovered** — ${t.recovered}/${t.targetTotal} targets; ${t.pending} pending; ${t.exhausted} exhausted after retries.`,
      t.currentTarget ? `Current target: ${t.currentTarget}` : "Current target: none",
      `Freeze protection: checkpointed (${reason}); automatic resume enabled.`,
      "",
    ].join("\n");
    writeFileSync(SUMMARY_PATH, line, { flag: "a" });
    lastSummaryAt = Date.now();
  }
  console.log(JSON.stringify(payload));
}
function stopHandler(signal) {
  if (stopped) return;
  stopped = true;
  writeProgress(`signal-${signal}`);
  process.exitCode = signal === "SIGTERM" ? 143 : 130;
}
process.on("SIGTERM", () => stopHandler("SIGTERM"));
process.on("SIGINT", () => stopHandler("SIGINT"));
process.on("uncaughtException", (error) => {
  console.error(error);
  writeProgress("uncaught-exception");
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  writeProgress("unhandled-rejection");
  process.exit(1);
});
const checkpointTimer = setInterval(() => writeProgress("five-minute-interval"), CHECKPOINT_INTERVAL_MS);
checkpointTimer.unref();

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/xml,text/xml,application/json,*/*", ...(options.headers || {}) },
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
      });
      if ([429, 500, 502, 503, 504].includes(response.status) && attempt < attempts) {
        await sleep(attempt * 1500);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1500);
    }
  }
  throw lastError;
}

function googleLinks(html) {
  const out = [];
  for (const match of String(html).matchAll(/href="\/url\?q=([^&"]+)/g)) {
    try { out.push({ url: decodeURIComponent(match[1]), title: "Google result", provider: "google" }); } catch {}
  }
  for (const match of String(html).matchAll(/href="(https?:\/\/[^"&]+)"/g)) {
    out.push({ url: decodeHtml(match[1]), title: "Google result", provider: "google" });
  }
  return out;
}
function rssLinks(xml, provider) {
  const out = [];
  const items = String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const title = normalizeText(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]);
    const url = normalizeText(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]);
    if (url) out.push({ url, title, provider });
  }
  return out;
}
async function searchBing(query) {
  const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  try { return rssLinks(await (await fetchWithRetry(url)).text(), "bing"); } catch (error) { return [{ error: String(error), provider: "bing" }]; }
}
async function searchGoogle(query) {
  if (!ENABLE_GOOGLE) return [];
  const url = `https://www.google.com/search?num=20&filter=0&q=${encodeURIComponent(query)}`;
  try { return googleLinks(await (await fetchWithRetry(url)).text()); } catch (error) { return [{ error: String(error), provider: "google" }]; }
}
async function searchReddit(query) {
  const url = `https://www.reddit.com/search.json?sort=relevance&t=all&limit=25&q=${encodeURIComponent(query)}`;
  try {
    const json = await (await fetchWithRetry(url, { headers: { accept: "application/json" } })).json();
    return (json?.data?.children || []).map(({ data }) => ({
      url: data.url_overridden_by_dest || `https://www.reddit.com${data.permalink}`,
      title: data.title,
      provider: "reddit",
      community: true,
    }));
  } catch (error) { return [{ error: String(error), provider: "reddit" }]; }
}
async function searchArchive(query) {
  const fields = "identifier,title,description,mediatype";
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=${encodeURIComponent(fields)}&rows=25&page=1&output=json`;
  try {
    const json = await (await fetchWithRetry(url, { headers: { accept: "application/json" } })).json();
    return (json?.response?.docs || []).map((doc) => ({
      url: `https://archive.org/details/${doc.identifier}`,
      title: normalizeText(doc.title || doc.description || doc.identifier),
      provider: "internet-archive",
    }));
  } catch (error) { return [{ error: String(error), provider: "internet-archive" }]; }
}

function scoreCandidate(target, candidate) {
  if (!candidate?.url) return -1000;
  const host = urlHost(candidate.url);
  if (REJECT_HOSTS.has(host)) return -1000;
  const haystack = slug(`${candidate.title || ""} ${candidate.url}`);
  const yearTokens = new Set([String(target.year), slug(target.season)]);
  const makerTokens = tokens(target.manufacturer);
  const productTokens = tokens(target.product);
  let score = TRUST.get(host) || 0;
  if (COMMUNITY_HOSTS.has(host)) score += 15;
  for (const token of yearTokens) if (token && haystack.includes(token)) score += 18;
  for (const token of makerTokens) if (haystack.includes(token)) score += 10;
  let productMatches = 0;
  for (const token of productTokens) if (haystack.includes(token)) { score += 8; productMatches += 1; }
  if (productTokens.length && productMatches / productTokens.length >= 0.6) score += 25;
  if (/checklist|check-list|card-list|set-list|download/.test(haystack)) score += 18;
  if (FILE_EXT.test(candidate.url)) score += 20;
  if (/news|preview|review|box-break|odds/.test(haystack) && !/checklist/.test(haystack)) score -= 15;
  return score;
}

async function collectCandidates(target) {
  const exact = `"${target.season}" "${target.manufacturer}" "${target.product}" ${target.sport} checklist`;
  const fileQuery = `"${target.season}" "${target.manufacturer}" "${target.product}" (filetype:pdf OR filetype:xlsx OR filetype:csv) checklist`;
  const siteQueries = [
    "site:topps.com", "site:upperdeck.com", "site:paniniamerica.net", "site:baseballcardpedia.com",
    "site:beckett.com", "site:cardboardconnection.com", "site:breakninja.com", "site:gogts.net",
    "site:blowoutforums.com", "site:reddit.com", "site:archive.org",
  ].map((site) => `${site} ${exact}`);
  const candidates = [];
  if (target.knownLeadUrl) candidates.push({ url: target.knownLeadUrl, title: target.knownLeadName || targetLabel(target), provider: "seed" });

  for (const query of [exact, fileQuery, ...siteQueries]) {
    candidates.push(...await searchBing(query));
    await sleep(SEARCH_DELAY_MS);
  }
  candidates.push(...await searchGoogle(exact));
  await sleep(SEARCH_DELAY_MS);
  candidates.push(...await searchReddit(exact));
  await sleep(SEARCH_DELAY_MS);
  candidates.push(...await searchArchive(`title:(${target.season} ${target.manufacturer} ${target.product})`));

  return uniqueByUrl(candidates.filter((row) => row.url)).map((row) => ({ ...row, score: scoreCandidate(target, row) }))
    .filter((row) => row.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

function extractXlsxText(path) {
  const shared = spawnSync("unzip", ["-p", path, "xl/sharedStrings.xml"], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  const sheets = spawnSync("unzip", ["-p", path, "xl/worksheets/sheet*.xml"], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024, shell: true });
  const strings = [...String(shared.stdout || "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeHtml(match[1]));
  const rows = [...String(sheets.stdout || "").matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((match) => {
    const values = [];
    for (const cell of match[1].matchAll(/<c[^>]*?(?:t="([^"]+)")?[^>]*>[\s\S]*?<v>([\s\S]*?)<\/v>[\s\S]*?<\/c>/g)) {
      const type = cell[1];
      const raw = cell[2];
      values.push(type === "s" ? strings[Number(raw)] || raw : raw);
    }
    return values.join("\t");
  }).filter(Boolean);
  return rows.join("\n");
}
function extractPdfText(path) {
  const out = `${path}.txt`;
  const result = spawnSync("pdftotext", ["-layout", path, out], { encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0 || !existsSync(out)) return "";
  const text = readFileSync(out, "utf8");
  rmSync(out, { force: true });
  return text;
}
function genericChecklistText(html) {
  const tableRows = [];
  for (const row of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => normalizeText(cell[1]));
    if (cells.length >= 2) tableRows.push(cells.join("\t"));
  }
  const tableText = tableRows.join("\n");
  if (countChecklistRows(tableText) >= 3) return tableText;
  const plain = decodeHtml(html);
  return countChecklistRows(plain) >= 3 ? plain : "";
}

async function inspectCandidate(target, candidate) {
  const host = urlHost(candidate.url);
  const community = candidate.community || COMMUNITY_HOSTS.has(host);
  if (community) {
    leads.leads.push({
      targetId: target.id, exactSetKey: target.exactSetKey, target: targetLabel(target),
      url: candidate.url, title: candidate.title || null, provider: candidate.provider,
      score: candidate.score, status: "community-lead-needs-permission", foundAt: now(),
    });
    return null;
  }
  const response = await fetchWithRetry(candidate.url);
  const finalUrl = response.url;
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) throw new Error(`Download too large: ${contentLength}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error(`Download too large: ${bytes.length}`);

  const extension = (finalUrl.match(FILE_EXT)?.[1] || candidate.url.match(FILE_EXT)?.[1] || "").toLowerCase();
  let checklistText = "";
  let download = null;
  const tempPath = resolve(STATE_ROOT, `candidate-${target.id}-${Date.now()}.${extension || "bin"}`);
  if (extension || !contentType.includes("text/html")) {
    writeFileSync(tempPath, bytes);
    if (extension === "pdf" || contentType.includes("pdf")) checklistText = extractPdfText(tempPath);
    else if (["xlsx", "xls"].includes(extension) || contentType.includes("spreadsheet")) checklistText = extractXlsxText(tempPath);
    else checklistText = bytes.toString("utf8");
    download = { name: `source.${extension || "bin"}`, url: finalUrl, bytes };
    rmSync(tempPath, { force: true });
  } else {
    const html = bytes.toString("utf8");
    checklistText = extractChecklistFromHtml(html) || genericChecklistText(html);
  }
  checklistText = String(checklistText || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const rows = countChecklistRows(checklistText);
  const trusted = (TRUST.get(urlHost(finalUrl)) || 0) >= 72;
  if (rows < 3 && !download) return null;
  if (rows < 3 && download && !trusted) return null;

  const id = `${target.id}--${slug(targetLabel(target), 120)}`;
  const metadata = saveItem({
    id,
    url: finalUrl,
    title: targetLabel(target),
    sport: target.sport,
    season: target.season,
    manufacturer: target.manufacturer,
    product: target.product,
    checklist: rows >= 3 ? checklistText : "",
    sourceRevision: response.headers.get("last-modified") || response.headers.get("etag") || sha256(bytes).slice(0, 16),
    categories: [target.scope, candidate.provider, `candidate-score-${candidate.score}`],
  }, download ? [download] : []);
  return { metadata, rows, url: finalUrl, provider: candidate.provider, score: candidate.score, downloadedBytes: bytes.length };
}

async function processTarget(target) {
  const previous = state.targets[target.id] || {};
  const attempts = Number(previous.attempts || 0) + 1;
  state.targets[target.id] = { ...previous, status: "searching", attempts, lastAttemptAt: now(), label: targetLabel(target), exactSetKey: target.exactSetKey };
  writeProgress("target-start");
  const candidates = await collectCandidates(target);
  state.targets[target.id].candidateCount = candidates.length;
  state.targets[target.id].topCandidates = candidates.slice(0, 8).map(({ url, title, provider, score }) => ({ url, title, provider, score }));

  for (const candidate of candidates) {
    try {
      const recovered = await inspectCandidate(target, candidate);
      if (!recovered) continue;
      state.targets[target.id] = {
        ...state.targets[target.id], status: "recovered", recoveredAt: now(), sourceUrl: recovered.url,
        provider: recovered.provider, checklistRows: recovered.rows, downloadedBytes: recovered.downloadedBytes,
        sourceItemId: recovered.metadata.id,
      };
      writeProgress("target-recovered");
      return;
    } catch (error) {
      state.targets[target.id].lastCandidateError = `${candidate.url}: ${String(error)}`.slice(0, 2000);
    }
  }

  state.targets[target.id].status = attempts >= MAX_ATTEMPTS ? "exhausted" : "pending";
  state.targets[target.id].lastCompletedAt = now();
  writeProgress("target-not-found");
}

function discoveryQueries() {
  const sports = ["baseball", "basketball", "football", "hockey", "soccer", "racing", "wrestling", "boxing", "golf", "tennis"];
  const decades = [1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990];
  const out = [];
  for (const decade of decades) for (const sport of sports) out.push(`"${decade}s" ${sport} card set checklist index`);
  return out;
}
async function runDiscoveryPass(limit = 10) {
  const queries = discoveryQueries();
  for (let count = 0; count < limit && state.discovery.cursor < queries.length; count += 1) {
    const query = queries[state.discovery.cursor];
    const results = [...await searchBing(query), ...await searchGoogle(query)].filter((row) => row.url);
    for (const result of uniqueByUrl(results)) {
      const host = urlHost(result.url);
      if (!TRUST.has(host) && !COMMUNITY_HOSTS.has(host) && host !== "archive.org") continue;
      leads.leads.push({ query, url: result.url, title: result.title || null, provider: result.provider, status: "vintage-discovery-lead", foundAt: now() });
    }
    state.discovery.cursor += 1;
    writeProgress("vintage-discovery");
    await sleep(SEARCH_DELAY_MS);
  }
}

async function main() {
  writeProgress("run-start");
  const runnable = targets
    .filter((target) => {
      const row = state.targets[target.id] || {};
      return row.status !== "recovered" && row.status !== "exhausted" && Number(row.attempts || 0) < MAX_ATTEMPTS;
    })
    .sort((a, b) => {
      const aa = Number(state.targets[a.id]?.attempts || 0);
      const bb = Number(state.targets[b.id]?.attempts || 0);
      return aa - bb || a.year - b.year || targetLabel(a).localeCompare(targetLabel(b));
    })
    .slice(0, MAX_TARGETS);

  for (const target of runnable) {
    if (stopped) break;
    currentTarget = target;
    await processTarget(target);
    processedThisRun += 1;
    currentTarget = null;
    await sleep(SEARCH_DELAY_MS);
  }
  await runDiscoveryPass(10);
  currentTarget = null;
  writeProgress("run-complete");
}

await main();
