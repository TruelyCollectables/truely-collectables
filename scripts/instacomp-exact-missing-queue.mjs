import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { downloadAndParse, slug } from "./mainstream-checklist/source-tools.mjs";
import {
  assertPlanComplexity,
  buildPlan,
  dbClient,
  limitedIssues,
} from "./mainstream-checklist/registry-tools.mjs";

const MANIFEST_PATH = resolve(process.env.EXACT_QUEUE_MANIFEST || "data/instacomp/exact-missing-queue-wave1.json");
const RECEIPT_PATH = resolve(process.env.EXACT_QUEUE_RECEIPT || "exact-missing-queue-wave1-receipt.json");
const MAX_TARGETS = Math.max(1, Number(process.env.EXACT_QUEUE_MAX_TARGETS || 12));
const CARD_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_CARD_CHUNK || 100));
const PARALLEL_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_PARALLEL_CHUNK || 150));
const IDENTITY_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_IDENTITY_CHUNK || 200));
const SET_CHUNK = Math.max(25, Number(process.env.CHECKLIST_REGISTRY_SET_CHUNK || 100));
const RPC_ATTEMPTS = Math.max(1, Number(process.env.CHECKLIST_REGISTRY_RPC_ATTEMPTS || 4));
const BLOCKED_AUTO_DOMAINS = new Set(["beckett.com", "www.beckett.com"]);
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function lower(value) { return String(value || "").trim().toLowerCase(); }
function host(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } }
function chunks(values, size) {
  const rows = Array.isArray(values) ? values : [];
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
function transient(message) {
  return /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|fetch failed|network|\b52[125]\b|\b544\b/i.test(String(message || ""));
}
async function rpc(db, name, args, label) {
  let last;
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    try {
      const { data, error } = await db.rpc(name, args);
      if (!error) return data;
      last = new Error(error.message || String(error));
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
    console.warn(`${label} attempt ${attempt}/${RPC_ATTEMPTS}: ${last.message}`);
    if (attempt >= RPC_ATTEMPTS || !transient(last.message)) break;
    await sleep(Math.min(15_000, 1500 * (2 ** (attempt - 1))));
  }
  throw last || new Error(`${label} failed`);
}
async function uploadRegistrySource(db, plan, bytes) {
  const s = plan?.source?.storage;
  if (!s?.bucket || !s?.objectPath) throw new Error("Registry source storage metadata missing");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const uploaded = await db.storage.from(s.bucket).upload(s.objectPath, bytes, {
      contentType: s.mimeType,
      cacheControl: "0",
      upsert: false,
    });
    if (!uploaded.error || /already exists|duplicate|409/i.test(uploaded.error.message || "")) return;
    if (attempt >= 4 || !transient(uploaded.error.message)) throw new Error(`Registry source upload failed: ${uploaded.error.message}`);
    await sleep(1500 * attempt);
  }
}
async function persistPlanStaged(db, plan, bytes) {
  if (plan?.validation?.status !== "passed") throw new Error(`Plan is not passed: ${plan?.validation?.status || "missing"}`);
  await uploadRegistrySource(db, plan, bytes);
  const s = plan.source.storage;
  const begin = await rpc(db, "tcos_begin_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: s.originalFilename,
    p_mime_type: s.mimeType,
    p_size_bytes: s.sizeBytes,
    p_sha256: s.sha256,
    p_storage_bucket: s.bucket,
    p_storage_object_path: s.objectPath,
  }, "staged begin");
  if (!begin?.ok) throw new Error(`Staged begin refused: ${JSON.stringify(begin)}`);
  if (begin.complete) return { ...begin, staged: true };
  const versionId = begin.versionId;
  if (!versionId) throw new Error("Staged begin returned no versionId");
  const append = async (payload, label) => rpc(db, "tcos_append_checklist_import_chunk", {
    p_version_id: versionId,
    p_sets: payload.sets || [],
    p_cards: payload.cards || [],
    p_parallels: payload.parallels || [],
    p_identities: payload.identities || [],
  }, label);
  for (const [i, part] of chunks(plan.sets, SET_CHUNK).entries()) await append({ sets: part }, `sets ${i + 1}`);
  for (const [i, part] of chunks(plan.cards, CARD_CHUNK).entries()) await append({ cards: part }, `cards ${i + 1}`);
  for (const [i, part] of chunks(plan.parallels, PARALLEL_CHUNK).entries()) await append({ parallels: part }, `parallels ${i + 1}`);
  for (const [i, part] of chunks(plan.identities, IDENTITY_CHUNK).entries()) await append({ identities: part }, `identities ${i + 1}`);
  const c = plan.validation.counts || {};
  const final = await rpc(db, "tcos_finalize_checklist_import_plan", {
    p_version_id: versionId,
    p_expected_sets: Number(c.sets || 0),
    p_expected_cards: Number(c.cards || 0),
    p_expected_parallels: Number(c.parallels || 0),
    p_expected_identities: Number(c.identities || 0),
    p_validation_issues: Array.isArray(plan.validation.issues) ? plan.validation.issues : [],
  }, "staged finalize");
  if (!final?.ok || final?.status !== "live") throw new Error(`Staged finalize refused: ${JSON.stringify(final)}`);
  return { ...final, staged: true };
}
async function allRows(db, table, columns, apply = (q) => q) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let q = db.from(table).select(columns).range(offset, offset + 999);
    q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} census failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}
function* strings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value && typeof value === "object") for (const v of Object.values(value)) yield* strings(v);
}
async function liveExactKeys(db) {
  const [manufacturers, sports, releases, versions] = await Promise.all([
    allRows(db, "checklist_manufacturers", "id,name,slug"),
    allRows(db, "checklist_sports", "id,name,slug"),
    allRows(db, "checklist_releases", "id,manufacturer_id,sport_id,product_name,release_year,season,metadata"),
    allRows(db, "checklist_versions", "release_id,status,is_active,normalized_card_count", (q) => q.eq("is_active", true).eq("status", "live").gt("normalized_card_count", 0)),
  ]);
  const man = new Map(manufacturers.map((r) => [r.id, slug(r.slug || r.name)]));
  const sport = new Map(sports.map((r) => [r.id, slug(r.slug || r.name)]));
  const liveIds = new Set(versions.map((v) => v.release_id));
  const keys = new Set();
  for (const r of releases) {
    if (!liveIds.has(r.id)) continue;
    const derived = [sport.get(r.sport_id) || "", lower(r.season || r.release_year), man.get(r.manufacturer_id) || "", slug(r.product_name)].join("|");
    keys.add(derived);
    for (const value of strings(r.metadata || {})) {
      const candidate = lower(value);
      if ((candidate.match(/\|/g) || []).length === 3) keys.add(candidate);
    }
  }
  return { keys, liveVersionCount: versions.length, liveReleaseCount: liveIds.size };
}
function canonicalMime(source) {
  const mime = lower(source.mimeType);
  if (mime.includes("html")) return "text/html";
  if (mime.includes("pdf")) return "application/pdf";
  if (mime.includes("spreadsheetml")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (mime.includes("ms-excel")) return "application/vnd.ms-excel";
  if (mime.includes("csv")) return "text/csv";
  if (mime.includes("plain")) return "text/plain";
  return source.mimeType || "application/octet-stream";
}
function entryFor(target) {
  const urls = target.sources.map((s) => s.url);
  for (const url of urls) {
    if (BLOCKED_AUTO_DOMAINS.has(host(url))) throw new Error(`Blocked automatic source domain for ${target.searchId}: ${url}`);
  }
  const primaryHost = host(urls[0]);
  const official = /(^|\.)(topps|upperdeck|leaftradingcards)\.com$/.test(primaryHost);
  return {
    id: target.searchId,
    exactSetKey: target.exactSetKey,
    sourceName: target.sources[0]?.name || primaryHost,
    sourceUrl: urls[0],
    fallbackUrls: urls.slice(1),
    authority: official ? "official_manufacturer" : "approved_reference_dataset",
    redistributionAllowed: false,
    minimumCardRows: Number(target.minimumCardRows || 3),
    release: {
      releaseYear: Number(target.year),
      season: target.season,
      manufacturer: target.manufacturer,
      brand: null,
      product: target.product,
      sport: target.sport,
      league: null,
      canonicalName: `${target.season} ${target.manufacturer} ${target.product} ${target.sport}`,
    },
  };
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
if (manifest?.schema !== "tcos.instacomp.exactMissingChecklistQueue.wave1.v1") throw new Error("Unexpected exact queue manifest schema");
const allowed = new Set((manifest.targets || []).map((t) => lower(t.exactSetKey)));
if (!allowed.size || allowed.size !== manifest.targets.length) throw new Error("Exact queue manifest keys are empty or duplicated");
const db = dbClient();
const census = await liveExactKeys(db);
console.log(JSON.stringify({ manifestTargets: allowed.size, liveVersions: census.liveVersionCount, liveReleases: census.liveReleaseCount }, null, 2));
const results = [];
let attemptedMissing = 0;
for (const target of manifest.targets) {
  const key = lower(target.exactSetKey);
  if (!allowed.has(key)) throw new Error(`Hard-lock failure for ${key}`);
  if (census.keys.has(key)) {
    results.push({ searchId: target.searchId, exactSetKey: key, status: "already_live" });
    continue;
  }
  if (attemptedMissing >= MAX_TARGETS) {
    results.push({ searchId: target.searchId, exactSetKey: key, status: "deferred_batch_limit" });
    continue;
  }
  attemptedMissing += 1;
  const entry = entryFor(target);
  console.log(`=== EXACT MISSING ${attemptedMissing}/${MAX_TARGETS}: ${target.searchId} ${key} ===`);
  try {
    const downloaded = await downloadAndParse(entry);
    const source = { ...downloaded.source, mimeType: canonicalMime(downloaded.source) };
    const plan = buildPlan(entry, downloaded.parsed, source, new Date().toISOString());
    assertPlanComplexity(plan);
    if (plan.validation.status !== "passed") {
      results.push({
        searchId: target.searchId,
        exactSetKey: key,
        status: "quarantined_validation",
        sourceUrl: source.selectedUrl || source.finalUrl || entry.sourceUrl,
        counts: plan.validation.counts,
        issues: limitedIssues(plan.validation.issues),
      });
      continue;
    }
    const tx = await persistPlanStaged(db, plan, source.bytes);
    results.push({
      searchId: target.searchId,
      exactSetKey: key,
      status: "persisted",
      sourceUrl: source.selectedUrl || source.finalUrl || entry.sourceUrl,
      counts: plan.validation.counts,
      transaction: tx,
    });
  } catch (error) {
    results.push({ searchId: target.searchId, exactSetKey: key, status: "failed", error: error instanceof Error ? error.message : String(error) });
  }
}
const persisted = results.filter((r) => r.status === "persisted");
const receipt = {
  schema: "tcos.instacomp.exactMissingChecklistQueue.wave1Receipt.v1",
  generatedAt: new Date().toISOString(),
  hardLock: "manifest target AND absent from active live Production Registry",
  manifestTargets: manifest.targets.length,
  liveRegistryBefore: { liveVersions: census.liveVersionCount, liveReleases: census.liveReleaseCount },
  attemptedMissing,
  persistedCount: persisted.length,
  alreadyLiveCount: results.filter((r) => r.status === "already_live").length,
  quarantinedCount: results.filter((r) => r.status === "quarantined_validation").length,
  failedCount: results.filter((r) => r.status === "failed").length,
  persistedCards: persisted.reduce((n, r) => n + Number(r.counts?.cards || 0), 0),
  persistedIdentities: persisted.reduce((n, r) => n + Number(r.counts?.identities || 0), 0),
  results,
};
writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ persistedCount: receipt.persistedCount, alreadyLiveCount: receipt.alreadyLiveCount, quarantinedCount: receipt.quarantinedCount, failedCount: receipt.failedCount, persistedCards: receipt.persistedCards, persistedIdentities: receipt.persistedIdentities }, null, 2));
if (receipt.failedCount > 0) process.exitCode = 2;
