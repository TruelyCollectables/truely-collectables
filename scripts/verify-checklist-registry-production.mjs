import { createClient } from "@supabase/supabase-js";
import { runRegistryReadWithRetry } from "./checklist-registry-read-retry.mjs";

const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) throw new Error("Production Supabase URL and service-role key are required.");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "X-Client-Info": "tcos-checklist-registry-contract-probe-v4" } },
});

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const readRetryAttempts = boundedInteger(process.env.CHECKLIST_REGISTRY_READ_RETRY_ATTEMPTS, 6, 1, 10);
const readRetryBaseMs = boundedInteger(process.env.CHECKLIST_REGISTRY_READ_RETRY_BASE_MS, 750, 0, 5_000);
const readAttemptTimeoutMs = boundedInteger(process.env.CHECKLIST_REGISTRY_READ_TIMEOUT_MS, 12_000, 1_000, 30_000);
const writerProbeTimeoutMs = boundedInteger(process.env.CHECKLIST_REGISTRY_WRITER_PROBE_TIMEOUT_MS, 12_000, 1_000, 30_000);

const requiredTables = [
  "checklist_source_catalog",
  "checklist_releases",
  "checklist_source_files",
  "checklist_versions",
  "checklist_sets",
  "checklist_cards",
  "checklist_card_identities",
];

const tableChecks = [];
for (const table of requiredTables) {
  // One bounded row read proves PostgREST/table access without asking Production
  // to count or scan a large Registry table. Only transient read failures may be
  // retried; missing tables, permissions, and all other contract failures remain
  // immediate hard failures. Every underlying fetch also has a hard timeout so a
  // degraded PostgREST connection can never hold the Production gate indefinitely.
  const result = await runRegistryReadWithRetry(
    () => db
      .from(table)
      .select("*")
      .limit(1)
      .abortSignal(AbortSignal.timeout(readAttemptTimeoutMs)),
    { attempts: readRetryAttempts, baseMs: readRetryBaseMs },
  );
  if (result.error) {
    const retryState = result.exhausted ? " after bounded transient retries" : "";
    throw new Error(`Registry table ${table} is not readable${retryState}: ${result.error.message}`);
  }
  tableChecks.push({
    table,
    readable: true,
    boundedRead: true,
    attemptsUsed: result.attemptsUsed,
    transientRetryUsed: result.retried,
    perAttemptTimeoutMs: readAttemptTimeoutMs,
  });
}

// This call is intentionally rejected by the writer's FIRST pre-write guard.
// It proves the exact Production RPC exists and is executing the expected
// fail-closed contract without inserting/updating/deleting any Registry row.
// The RPC itself is deliberately NOT retried: only idempotent table reads get
// transport/schema-cache retry treatment in this verifier. The one-shot probe
// still has a hard network timeout and any timeout fails the gate closed.
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

const { data: rpcData, error: rpcError } = await db
  .rpc("tcos_apply_checklist_import_plan", {
    p_plan: invalidPlan,
    p_original_filename: "contract-probe.txt",
    p_mime_type: "text/plain",
    p_size_bytes: 0,
    p_sha256: "0".repeat(64),
    p_storage_bucket: "contract-probe",
    p_storage_object_path: "contract-probe",
  })
  .abortSignal(AbortSignal.timeout(writerProbeTimeoutMs));

if (rpcData) throw new Error("Registry writer contract probe unexpectedly returned data instead of failing closed.");
const rpcMessage = String(rpcError?.message || "");
if (!/Checklist import plan requires validation before persistence/i.test(rpcMessage)) {
  throw new Error(`Registry writer contract probe failed at the wrong guard: ${rpcMessage || "no error returned"}`);
}

console.log(JSON.stringify({
  schema: "tcos.checklist.productionRegistryContract.v4",
  checkedAt: new Date().toISOString(),
  ok: true,
  readRetryPolicy: {
    attempts: readRetryAttempts,
    baseMs: readRetryBaseMs,
    perAttemptTimeoutMs: readAttemptTimeoutMs,
    scope: "bounded_table_reads_only",
  },
  tables: tableChecks,
  writer: {
    function: "tcos_apply_checklist_import_plan",
    exists: true,
    preWriteGuardVerified: true,
    expectedFailure: "Checklist import plan requires validation before persistence",
    retried: false,
    timeoutMs: writerProbeTimeoutMs,
  },
}, null, 2));
