import fs from "node:fs";
import path from "node:path";

const productionEnvFile = process.env.PRODUCTION_ENV_FILE;
const accessToken = String(process.env.GH_SUPABASE_ACCESS_TOKEN || "").trim();
const evidenceDir = process.env.EVIDENCE_DIR || ".audit/mac-deal-hunter-live-roundtrip";
if (!productionEnvFile || !fs.existsSync(productionEnvFile)) throw new Error("Production env file missing.");
if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is unavailable for sanitized Production readback.");
fs.mkdirSync(evidenceDir, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseEnv(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const env = parseEnv(productionEnvFile);
const configuredMacUrl = String(env.INSTACOMP_AI_LOCAL_URL || "").replace(/\/+$/, "");
const canonicalMacUrl = "https://instacomp.truelycollectables.com";
const macUrl = /^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configuredMacUrl) ? configuredMacUrl : canonicalMacUrl;
const tunnelSource = macUrl === configuredMacUrl ? "production_env" : "audited_canonical_fallback";
const macKey = String(env.INSTACOMP_AI_LOCAL_KEY || "").trim();
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
if (!macKey) throw new Error("Production Mac shared key is missing.");
if (!/^https:\/\//.test(supabaseUrl)) throw new Error("Production Supabase URL is missing.");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const dbEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const macHeaders = { "X-InstaComp-AI-Key": macKey, Accept: "application/json" };

async function jsonFetch(url, options = {}, label = "request", timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 500) }; }
    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
}

function transient(status, text) {
  return status === 429 || status === 524 || status === 544 || status >= 500 || /timeout|temporar|connection terminated/i.test(text);
}
async function dbQuery(sql, label, attempts = 12) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(dbEndpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql, parameters: [], read_only: true }),
      });
      const text = await response.text();
      if (response.ok) return text ? JSON.parse(text) : [];
      const error = new Error(`${label} attempt ${attempt}/${attempts}: HTTP ${response.status}: ${text.slice(0, 600)}`);
      if (!transient(response.status, text) || attempt === attempts) throw error;
      last = error;
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      if (attempt === attempts || !/timeout|fetch failed|connection|HTTP (?:429|5\d\d)/i.test(last.message)) throw last;
    }
    await sleep(Math.min(15000, attempt * 2000));
  }
  throw last || new Error(`${label} failed`);
}
async function historyCounts(sinceIso = null) {
  const sinceClause = sinceIso ? `where created_at >= '${String(sinceIso).replace(/'/g, "''")}'::timestamptz` : "";
  const rows = await dbQuery(`select json_build_object(
    'observations',(select count(*) from public.tcos_card_market_observations),
    'identities',(select count(*) from public.tcos_card_market_identities),
    'asksSince',(select count(*) from public.tcos_card_market_observations ${sinceClause} ${sinceClause ? "and" : "where"} observation_kind='ASK'),
    'soldSince',(select count(*) from public.tcos_card_market_observations ${sinceClause} ${sinceClause ? "and" : "where"} observation_kind='SOLD')
  ) counts;`, "Production history count readback");
  return rows?.[0]?.counts || {};
}
async function status() {
  return (await jsonFetch(`${macUrl}/v1/deal-hunter/status`, { headers: macHeaders }, "Mac Deal Hunter status", 30000)).payload;
}

const health = (await jsonFetch(`${macUrl}/health`, {}, "physical Mac health", 30000)).payload;
if (health?.ok !== true) throw new Error("Physical Mac health endpoint is not ready.");
const runtimeIdentity = (await jsonFetch(`${macUrl}/v1/runtime-identity`, {}, "physical Mac runtime identity", 30000)).payload;
const beforeStatus = await status();
if (beforeStatus?.enabled !== true) throw new Error("Physical Mac Deal Hunter scheduler is disabled.");
if (beforeStatus?.mac_evaluation_key_configured !== true) throw new Error("Physical Mac Deal Hunter evaluation key is not configured.");

const beforeCounts = await historyCounts();
const proofStartedAt = new Date().toISOString();
let trigger = { accepted: false, transportTimedOut: false };

if (beforeStatus?.running === true) {
  for (let i = 0; i < 80; i += 1) {
    await sleep(15000);
    if ((await status())?.running !== true) break;
    if (i === 79) throw new Error("Existing physical Mac Deal Hunter run did not finish inside the bounded proof window.");
  }
}
const immediatelyBefore = await status();
const priorStarted = String(immediatelyBefore?.last_started_at || "");
try {
  const result = await jsonFetch(`${macUrl}/v1/deal-hunter/run`, { method: "POST", headers: macHeaders }, "physical Mac manual Deal Hunter run", 95000);
  trigger.accepted = result.payload?.accepted === true;
  if (!trigger.accepted) throw new Error(`Physical Mac rejected manual run: ${JSON.stringify(result.payload).slice(0, 1000)}`);
} catch (error) {
  if (!/abort|timeout/i.test(String(error))) throw error;
  trigger.transportTimedOut = true;
}

let afterStatus = null;
let manualStarted = trigger.accepted;
for (let i = 0; i < 100; i += 1) {
  afterStatus = await status();
  const lastStarted = String(afterStatus?.last_started_at || "");
  if (lastStarted && lastStarted !== priorStarted) manualStarted = true;
  if (manualStarted && afterStatus?.running !== true && afterStatus?.last_completed_at) break;
  await sleep(15000);
  if (i === 99) throw new Error("Physical Mac manual Deal Hunter run did not reach a completed durable state inside the proof window.");
}
if (!manualStarted) throw new Error("No new physical Mac Deal Hunter run was observed after the manual trigger.");

const recentRuns = (await jsonFetch(`${macUrl}/v1/deal-hunter/runs?limit=5`, { headers: macHeaders }, "physical Mac run receipts", 30000)).payload?.runs || [];
const newestRun = Array.isArray(recentRuns) ? recentRuns[0] || null : null;
if (!newestRun) throw new Error("Physical Mac produced no durable Deal Hunter run receipt.");
if (String(newestRun.status || "") !== "completed") throw new Error(`Physical Mac Deal Hunter run finished non-successfully: ${String(newestRun.status || "unknown")} ${String(newestRun.error_message || "").slice(0, 800)}`);

const afterCounts = await historyCounts(proofStartedAt);
const beforeObservations = Number(beforeCounts.observations || 0);
const afterObservations = Number(afterCounts.observations || 0);
const observationDelta = afterObservations - beforeObservations;
if (observationDelta <= 0) throw new Error(`Physical Mac run completed but produced no new trusted Production market-history observations (before=${beforeObservations}, after=${afterObservations}, evaluated=${Number(newestRun.evaluated_count || 0)}, failures=${Number(newestRun.failure_count || 0)}).`);

const receipt = {
  ok: true,
  proofStartedAt,
  physicalMac: {
    healthOk: health?.ok === true,
    app: health?.app || null,
    version: runtimeIdentity?.version || health?.version || null,
    runtimeSourceFingerprint: runtimeIdentity?.runtime_source_fingerprint || null,
    schedulerEnabled: beforeStatus?.enabled === true,
    evaluationKeyConfigured: beforeStatus?.mac_evaluation_key_configured === true,
    tunnelSource,
  },
  trigger: { acceptedDirectly: trigger.accepted, tunnelRequestTimedOutButDurableRunObserved: trigger.transportTimedOut && manualStarted },
  run: {
    status: newestRun.status,
    trigger: newestRun.trigger || null,
    discoveryCount: Number(newestRun.discovery_count || 0),
    evaluatedCount: Number(newestRun.evaluated_count || 0),
    actionableCount: Number(newestRun.actionable_count || 0),
    manualReviewCount: Number(newestRun.manual_review_count || 0),
    failureCount: Number(newestRun.failure_count || 0),
    completedAt: newestRun.completed_at || null,
  },
  productionHistory: {
    observationsBefore: beforeObservations,
    observationsAfter: afterObservations,
    observationDelta,
    identitiesBefore: Number(beforeCounts.identities || 0),
    identitiesAfter: Number(afterCounts.identities || 0),
    asksCreatedSinceProofStart: Number(afterCounts.asksSince || 0),
    soldCreatedSinceProofStart: Number(afterCounts.soldSince || 0),
  },
};
fs.writeFileSync(path.join(evidenceDir, "mac-live-roundtrip-receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
