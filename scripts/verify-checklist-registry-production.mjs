import { createClient } from "@supabase/supabase-js";
import { runRegistryReadWithRetry } from "./checklist-registry-read-retry.mjs";

const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) throw new Error("Production Supabase URL and service-role key are required.");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "X-Client-Info": "tcos-checklist-registry-contract-probe-v3" } },
});

const readRetryAttempts = process.env.CHECKLIST_REGISTRY_READ_RETRY_ATTEMPTS || "6";
const readRetryBaseMs = process.env.CHECKLIST_REGISTRY_READ_RETRY_BASE_MS || "750";
const readAttemptTimeoutMs = process.env.CHECKLIST_REGISTRY_READ_ATTEMPT_TIMEOUT_MS || "10000";

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
  // immediate hard failures. Each read also receives an AbortSignal so a hung
  // transport attempt cannot consume the entire Production workflow timeout.
  const result = await runRegistryReadWithRetry(
    (signal) => db.from(table).select("*").limit(1).abortSignal(signal),
    {
      attempts: readRetryAttempts,
      baseMs: readRetryBaseMs,
      attemptTimeoutMs: readAttemptTimeoutMs,
    },
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
    attemptTimeoutMs: result.attemptTimeoutMs,
  });
}

// This call is intentionally rejected by the writer's FIRST pre-write guard.
// It proves the exact Production RPC exists and is executing the expected
// fail-closed contract without inserting/updating/deleting any Registry row.
// The RPC itself is deliberately NOT retried and is not routed through the
// read timeout helper: only idempotent table reads get retry/abort treatment.
const invalidPlan = {
  schema: "tcos.checklist.importPlan.v1",
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
const rpcMessage = String(rpcError?.message || "");
if (!/Checklist import plan requires validation before persistence/i.test(rpcMessage)) {
  throw new Error(`Registry writer contract probe failed at the wrong guard: ${rpcMessage || "no error returned"}`);
}

console.log(JSON.stringify({
  schema: "tcos.checklist.productionRegistryContract.v3",
  checkedAt: new Date().toISOString(),
  ok: true,
  readRetryPolicy: {
    attempts: Number.parseInt(readRetryAttempts, 10),
    baseMs: Number.parseInt(readRetryBaseMs, 10),
    attemptTimeoutMs: Number.parseInt(readAttemptTimeoutMs, 10),
    scope: "bounded_table_reads_only",
    abortSignalApplied: true,
  },
  tables: tableChecks,
  writer: {
    function: "tcos_apply_checklist_import_plan",
    exists: true,
    preWriteGuardVerified: true,
    expectedFailure: "Checklist import plan requires validation before persistence",
    retried: false,
  },
}, null, 2));
