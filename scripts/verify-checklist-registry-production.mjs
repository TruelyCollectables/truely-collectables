import { createClient } from "@supabase/supabase-js";

const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!url || !key) throw new Error("Production Supabase URL and service-role key are required.");

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "X-Client-Info": "tcos-checklist-registry-contract-probe-v1" } },
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

const tableChecks = [];
for (const table of requiredTables) {
  const { error, count } = await db
    .from(table)
    .select("*", { head: true, count: "exact" })
    .limit(1);
  if (error) throw new Error(`Registry table ${table} is not readable: ${error.message}`);
  tableChecks.push({ table, readable: true, count: Number.isFinite(count) ? count : null });
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
  schema: "tcos.checklist.productionRegistryContract.v1",
  checkedAt: new Date().toISOString(),
  ok: true,
  tables: tableChecks,
  writer: {
    function: "tcos_apply_checklist_import_plan",
    exists: true,
    preWriteGuardVerified: true,
    expectedFailure: "Checklist import plan requires validation before persistence",
  },
}, null, 2));
