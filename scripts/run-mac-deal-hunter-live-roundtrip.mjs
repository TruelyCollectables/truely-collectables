import fs from "node:fs";
import path from "node:path";

const productionEnvFile = process.env.PRODUCTION_ENV_FILE;
const evidenceDir = process.env.EVIDENCE_DIR || ".audit/mac-deal-hunter-live-roundtrip";
if (!productionEnvFile || !fs.existsSync(productionEnvFile)) throw new Error("Production env file missing.");
fs.mkdirSync(evidenceDir, { recursive: true });

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
const macUrl = /^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configuredMacUrl)
  ? configuredMacUrl
  : canonicalMacUrl;
const tunnelSource = macUrl === configuredMacUrl ? "production_env" : "audited_canonical_fallback";
const macKey = String(env.INSTACOMP_AI_LOCAL_KEY || "").trim();
const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!macKey) throw new Error("Production Mac shared key is missing.");
if (!/^https:\/\//.test(supabaseUrl) || !serviceKey) throw new Error("Production Supabase service access is missing.");

const macHeaders = { "X-InstaComp-AI-Key": macKey, Accept: "application/json" };
const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Prefer: "count=exact", Range: "0-0" };

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

async function countRows(table, filters = "") {
  const url = `${supabaseUrl}/rest/v1/${table}?select=id&limit=1${filters}`;
  const response = await fetch(url, { headers: dbHeaders });
  const text = await response.text();
  if (!response.ok && response.status !== 206) throw new Error(`Supabase REST count for ${table} failed HTTP ${response.status}: ${text.slice(0, 500)}`);
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") throw new Error(`Supabase REST count for ${table} did not return an exact total: ${range}`);
  return Number(match[1]);
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

const beforeObservations = await countRows("tcos_card_market_observations");
const beforeIdentities = await countRows("tcos_card_market_identities");
const proofStartedAt = new Date().toISOString();
let trigger = { accepted: false, transportTimedOut: false, payload: null };

if (beforeStatus?.running === true) {
  for (let i = 0; i < 80; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15000));
    const current = await status();
    if (current?.running !== true) break;
    if (i === 79) throw new Error("Existing physical Mac Deal Hunter run did not finish inside the bounded proof window.");
  }
}

const immediatelyBefore = await status();
const priorStarted = String(immediatelyBefore?.last_started_at || "");
try {
  const result = await jsonFetch(`${macUrl}/v1/deal-hunter/run`, { method: "POST", headers: macHeaders }, "physical Mac manual Deal Hunter run", 95000);
  trigger = { accepted: result.payload?.accepted === true, transportTimedOut: false, payload: result.payload };
  if (result.payload?.accepted !== true) throw new Error(`Physical Mac rejected manual run: ${JSON.stringify(result.payload).slice(0, 1000)}`);
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
  await new Promise((resolve) => setTimeout(resolve, 15000));
  if (i === 99) throw new Error("Physical Mac manual Deal Hunter run did not reach a completed durable state inside the proof window.");
}
if (!manualStarted) throw new Error("No new physical Mac Deal Hunter run was observed after the manual trigger.");

const recentRuns = (await jsonFetch(`${macUrl}/v1/deal-hunter/runs?limit=5`, { headers: macHeaders }, "physical Mac run receipts", 30000)).payload?.runs || [];
const newestRun = Array.isArray(recentRuns) ? recentRuns[0] || null : null;
if (!newestRun) throw new Error("Physical Mac produced no durable Deal Hunter run receipt.");
if (String(newestRun.status || "") !== "completed") throw new Error(`Physical Mac Deal Hunter run finished non-successfully: ${String(newestRun.status || "unknown")} ${String(newestRun.error_message || "").slice(0, 800)}`);

const afterObservations = await countRows("tcos_card_market_observations");
const afterIdentities = await countRows("tcos_card_market_identities");
const since = encodeURIComponent(proofStartedAt);
const newAsk = await countRows("tcos_card_market_observations", `&created_at=gte.${since}&observation_kind=eq.ASK`);
const newSold = await countRows("tcos_card_market_observations", `&created_at=gte.${since}&observation_kind=eq.SOLD`);
const observationDelta = afterObservations - beforeObservations;
if (observationDelta <= 0) {
  throw new Error(`Physical Mac run completed but produced no new trusted Production market-history observations (before=${beforeObservations}, after=${afterObservations}, evaluated=${Number(newestRun.evaluated_count || 0)}, failures=${Number(newestRun.failure_count || 0)}).`);
}

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
  trigger: {
    acceptedDirectly: trigger.accepted,
    tunnelRequestTimedOutButDurableRunObserved: trigger.transportTimedOut && manualStarted,
  },
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
    identitiesBefore: beforeIdentities,
    identitiesAfter: afterIdentities,
    asksCreatedSinceProofStart: newAsk,
    soldCreatedSinceProofStart: newSold,
    trustedRegistryGateInference: "History writer blocks unconfirmed Registry identities; positive observation delta proves at least one Registry-confirmed evaluation persisted.",
  },
};
fs.writeFileSync(path.join(evidenceDir, "mac-live-roundtrip-receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
