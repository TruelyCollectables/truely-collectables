import { createClient } from "@supabase/supabase-js";

const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) throw new Error("Production Supabase URL and service-role key are required.");

const MAX_READ_ATTEMPTS = Math.max(1, Math.min(12, Number(process.env.REGISTRY_READ_RETRY_ATTEMPTS || 8)));
const BASE_DELAY_MS = Math.max(100, Math.min(10_000, Number(process.env.REGISTRY_READ_RETRY_BASE_MS || 750)));
const STABLE_ROUNDS = Math.max(2, Math.min(3, Number(process.env.REGISTRY_STABLE_READ_ROUNDS || 2)));

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "X-Client-Info": "tcos-checklist-registry-contract-probe-v3" } },
});

const requiredTables = [
  "checklist_source_catalog",
  "checklist_releases",
  "checklist_source_files",
  "checklist_versions",
  "checklist_sets",
  "checklist_cards",
  "checklist_card_identities",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error) {
  return String(error?.message || error || "").trim();
}

function isTransientReadError(error) {
  const message = messageOf(error);
  return /schema cache|retrying|timed? out|timeout|too many connections|connection.*database|fetch failed|network|gateway|temporar|connection reset|socket|5\d\d/i.test(message);
}

async function retryBoundedRead(label, operation) {
  const failures = [];
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    const result = await operation();
    if (!result?.error) return { result, attempt, failures };

    const message = messageOf(result.error);
    failures.push({ attempt, message: message.slice(0, 300) });
    if (!isTransientReadError(result.error) || attempt === MAX_READ_ATTEMPTS) {
      throw new Error(`${label} failed after ${attempt} attempt(s): ${message || "unknown error"}`);
    }

    const delay = Math.min(15_000, BASE_DELAY_MS * 2 ** (attempt - 1));
    await sleep(delay);
  }
  throw new Error(`${label} exhausted bounded retries.`);
}

const stableRounds = [];
for (let round = 1; round <= STABLE_ROUNDS; round += 1) {
  const tableChecks = [];
  for (const table of requiredTables) {
    // One bounded row read proves PostgREST/table access without asking Production
    // to count or scan a large Registry table. Only transient READ failures retry.
    const probe = await retryBoundedRead(`Registry table ${table} read`, () => db
      .from(table)
      .select("*")
      .limit(1));
    tableChecks.push({
      table,
      readable: true,
      boundedRead: true,
      attempts: probe.attempt,
      transientFailures: probe.failures,
    });
  }
  stableRounds.push({ round, tables: tableChecks });
  if (round < STABLE_ROUNDS) await sleep(Math.min(5_000, BASE_DELAY_MS));
}

// This call is intentionally rejected by the writer's FIRST pre-write guard.
// It proves the exact Production RPC exists and is executing the expected
// fail-closed contract without inserting/updating/deleting any Registry row.
const invalidPlan = {
  schema: "tcos.checklist.import-plan.v1",
  validation: { status: "contract_probe_must_fail" },
  source: {
    privateArchiveRequired: true,
    normalizedFactsInternalOnly: true,
  },
  release: {},
  sets: [],
  cards: [],
  parallels: [],
  identities: [],
};

const rpcFailures = [];
let rpcVerified = false;
let rpcAttempt = 0;
for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
  rpcAttempt = attempt;
  const { data: rpcData, error: rpcError } = await db.rpc("tcos_apply_checklist_import_plan", {
    p_plan: invalidPlan,
    p_original_filename: "contract-probe.txt",
    p_mime_type: "text/plain",
    p_size_bytes: 0,
    p_sha256: "0".repeat(64),
    p_storage_bucket: "contract-probe",
    p_storage_object_path: "contract-probe",
  });

  if (rpcData) throw new Error("Registry writer contract probe unexpectedly returned data instead of failing closed.");
  const rpcMessage = messageOf(rpcError);
  if (/Checklist import plan requires validation before persistence/i.test(rpcMessage)) {
    rpcVerified = true;
    break;
  }

  rpcFailures.push({ attempt, message: rpcMessage.slice(0, 300) });
  if (!isTransientReadError(rpcError) || attempt === MAX_READ_ATTEMPTS) {
    throw new Error(`Registry writer contract probe failed at the wrong guard after ${attempt} attempt(s): ${rpcMessage || "no error returned"}`);
  }
  const delay = Math.min(15_000, BASE_DELAY_MS * 2 ** (attempt - 1));
  await sleep(delay);
}

if (!rpcVerified) throw new Error("Registry writer pre-write guard was not verified.");

console.log(JSON.stringify({
  schema: "tcos.checklist.productionRegistryContract.v3",
  checkedAt: new Date().toISOString(),
  ok: true,
  readPolicy: {
    maxAttempts: MAX_READ_ATTEMPTS,
    stableRoundsRequired: STABLE_ROUNDS,
    stableRoundsCompleted: stableRounds.length,
    transientOnly: true,
  },
  stableRounds,
  writer: {
    function: "tcos_apply_checklist_import_plan",
    exists: true,
    preWriteGuardVerified: true,
    attempts: rpcAttempt,
    transientFailures: rpcFailures,
    expectedFailure: "Checklist import plan requires validation before persistence",
  },
}, null, 2));
